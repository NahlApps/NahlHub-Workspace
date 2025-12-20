// pages/api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy + OTP Sender (GreenAPI)
// ==================================================================
//
// Actions used by frontend + backend (proxied to Apps Script):
//   - sendOtp / auth.requestOtp      (Local: GreenAPI + otp.store in Apps Script)
//   - verifyOtp / auth.verifyOtp     (Forward to Apps Script)
//   - auth.me                        (Forward)
//   - auth.logout                    (Forward)
//   - workspace.*                    (Forward)
//   - marketplace.*                  (Forward)
//   - health                         (Local healthcheck)

import crypto from "crypto";

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

// GreenAPI
const GREEN_API_URL = process.env.GREEN_API_URL || "https://api.green-api.com";
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

// HMAC secret shared with Apps Script Script Properties
const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET;

// OTP settings
const OTP_LENGTH = Number(process.env.OTP_LENGTH || 4);
const OTP_TTL_MIN = Number(process.env.OTP_TTL_MIN || 10);

function errorJson(message, statusCode = 500, extra = {}) {
  return { success: false, statusCode, error: message, ...extra };
}

function normalizeMobile(mobileRaw = "") {
  const d = String(mobileRaw).trim().replace(/[^\d]/g, "");
  // Saudi common formats:
  // 9665XXXXXXXX -> 5XXXXXXXX
  // 05XXXXXXXX   -> 5XXXXXXXX
  if (d.length === 12 && d.startsWith("966")) return d.slice(3);
  if (d.length === 10 && d.startsWith("0")) return d.slice(1);
  return d;
}

function generateOtp(len = 4) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/**
 * Call Apps Script backend (JSON POST).
 * Automatically injects default appId if missing.
 */
async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) {
    throw new Error("HUB_BACKEND_URL is not configured in Vercel environment.");
  }

  const finalPayload = { ...(payload || {}) };

  // Normalize appId / appid
  if (!finalPayload.appId && !finalPayload.appid && HUB_APP_ID) {
    finalPayload.appId = HUB_APP_ID;
  }

  const res = await fetch(HUB_BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(finalPayload),
  });

  const text = await res.text();

  // Apps Script sometimes returns HTML (auth page / stacktrace). Detect early.
  const maybeHtml = /<!doctype html>|<html/i.test(text || "");
  if (maybeHtml) {
    throw new Error(
      `Apps Script returned HTML (HTTP ${res.status}). Check deployment: Web App access must be "Anyone".`
    );
  }

  let data;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    throw new Error(
      `Apps Script returned non-JSON response (HTTP ${res.status}): ${String(text).slice(
        0,
        200
      )}`
    );
  }

  // If HTTP not ok OR body says success=false => treat as error
  if (!res.ok || data?.success === false) {
    const msg =
      data?.error ||
      data?.message ||
      `Apps Script error (HTTP ${res.status})`;
    throw new Error(msg);
  }

  return data;
}

async function greenSendMessage(chatId, message) {
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    throw new Error("GREEN_API_INSTANCE_ID / GREEN_API_TOKEN are missing.");
  }

  const url = `${GREEN_API_URL}/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    throw new Error(
      `GreenAPI returned non-JSON (HTTP ${res.status}): ${String(text).slice(
        0,
        200
      )}`
    );
  }

  if (!res.ok) {
    throw new Error(data?.message || `GreenAPI HTTP ${res.status}`);
  }

  return data;
}

function signOtpStore({ appId, mobile, otp, ts }) {
  if (!OTP_HMAC_SECRET) {
    throw new Error("OTP_HMAC_SECRET is missing in Vercel env.");
  }
  const msg = `${appId}|${mobile}|${otp}|${ts}`;
  return crypto.createHmac("sha256", OTP_HMAC_SECRET).update(msg).digest("hex");
}

export default async function handler(req, res) {
  // Basic CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res
      .status(405)
      .json(errorJson("Method not allowed. Use GET or POST.", 405));
  }

  try {
    // Build payload from request
    const payload =
      req.method === "GET"
        ? { ...(req.query || {}) }
        : typeof req.body === "object" && req.body !== null
        ? req.body
        : {};

    const action = String(payload.action || "").trim();
    if (!action) {
      return res.status(400).json(errorJson("Missing action parameter", 400));
    }

    // --------------------------------------------------------------
    // Local health check (DO NOT forward to Apps Script)
    // --------------------------------------------------------------
    if (action === "health") {
      return res.status(200).json({
        success: true,
        ok: true,
        service: "NahlHub",
        appId: HUB_APP_ID || "HUB",
        hasBackendUrl: !!HUB_BACKEND_URL,
        hasGreenApi: !!(GREEN_API_INSTANCE_ID && GREEN_API_TOKEN),
        hasHmac: !!OTP_HMAC_SECRET,
        otpLength: OTP_LENGTH,
        otpTtlMin: OTP_TTL_MIN,
      });
    }

    // --------------------------------------------------------------
    // Local OTP sender: GreenAPI + otp.store (Apps Script)
    // --------------------------------------------------------------
    if (action === "sendOtp" || action === "auth.requestOtp") {
      const mobile = normalizeMobile(payload.mobile || "");
      if (!mobile) {
        return res.status(400).json(errorJson("Mobile is required.", 400));
      }

      const appId = String(
        payload.appId || payload.appid || HUB_APP_ID || "HUB"
      ).trim();

      // Generate OTP
      const otp = generateOtp(OTP_LENGTH);

      // 1) Send WhatsApp OTP (GreenAPI)
      const chatId = `${mobile}@c.us`;
      const message = `رمز التحقق: ${otp}\nصالح لمدة ${OTP_TTL_MIN} دقائق.`;
      const green = await greenSendMessage(chatId, message);

      // 2) Store OTP in Apps Script with signature
      const ts = Date.now();
      const sig = signOtpStore({ appId, mobile, otp, ts });

      await callHubBackend({
        action: "otp.store",
        appId,
        mobile,
        otp,
        ts,
        sig,
      });

      return res.status(200).json({
        success: true,
        sent: true,
        idMessage: green?.idMessage || "",
      });
    }

    // --------------------------------------------------------------
    // Forward all other actions to Apps Script
    // --------------------------------------------------------------
    const backendResponse = await callHubBackend(payload);
    return res.status(200).json(backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);

    // Always return JSON (never crash UI)
    const msg = err?.message || "Unexpected server error";
    return res.status(500).json(errorJson(msg, 500));
  }
}
