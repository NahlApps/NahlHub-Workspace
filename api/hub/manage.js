// pages/api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy + OTP via Green API (Vercel-side)
// ========================================================================
//
// Required env vars:
// - HUB_BACKEND_URL            (Apps Script /exec URL)
// - HUB_APP_ID                (default "HUB")
// - GREEN_API_INSTANCE_ID
// - GREEN_API_TOKEN
// - OTP_HMAC_SECRET           (used to create otpRef so verify endpoint is protected)
//
// Optional:
// - OTP_TTL_SECONDS           (default 600)
// - OTP_LENGTH                (default 4)

import crypto from "crypto";

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET;
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS || 600);
const OTP_LENGTH = Number(process.env.OTP_LENGTH || 4);

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function errorJson(message, statusCode = 500, extra = {}) {
  return {
    success: false,
    statusCode,
    error: message,
    ...extra,
  };
}

function requireConfigured(value, name) {
  if (!value) throw new Error(`${name} is not configured in Vercel environment.`);
}

function normalizeMobileToChatId(mobileRaw) {
  let num = String(mobileRaw || "").trim();
  if (!num) return null;

  if (num.startsWith("+")) num = num.slice(1);
  if (num.startsWith("00")) num = num.slice(2);

  if (num.startsWith("966")) return `${num}@c.us`;
  if (num.startsWith("5") && num.length >= 8) return `966${num}@c.us`;

  return `${num}@c.us`;
}

function randomNumericOtp(length) {
  const min = Math.pow(10, Math.max(1, length) - 1);
  const max = 9 * min;
  const otp = String(Math.floor(min + Math.random() * max));
  return otp.slice(0, length);
}

function buildOtpRef({ appId, mobile, otp, expiresAtIso }) {
  requireConfigured(OTP_HMAC_SECRET, "OTP_HMAC_SECRET");
  const payload = `${appId}|${mobile}|${otp}|${expiresAtIso}`;
  const sig = crypto.createHmac("sha256", OTP_HMAC_SECRET).update(payload).digest("base64url");
  return sig;
}

async function sendGreenApiMessage({ chatId, message }) {
  requireConfigured(GREEN_API_INSTANCE_ID, "GREEN_API_INSTANCE_ID");
  requireConfigured(GREEN_API_TOKEN, "GREEN_API_TOKEN");

  const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    // ignore
  }

  if (!res.ok) {
    throw new Error(
      `Green API failed (HTTP ${res.status}): ${text?.slice(0, 200) || "Unknown error"}`
    );
  }
  return data || { ok: true };
}

/**
 * Call Apps Script backend (JSON POST).
 * Automatically injects default appId if missing.
 */
async function callHubBackend(payload) {
  requireConfigured(HUB_BACKEND_URL, "HUB_BACKEND_URL");

  const finalPayload = { ...(payload || {}) };

  if (!finalPayload.appId && !finalPayload.appid && HUB_APP_ID) {
    finalPayload.appId = HUB_APP_ID;
  }

  const res = await fetch(HUB_BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(finalPayload),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Apps Script returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`
    );
  }

  if (!res.ok) {
    const backendError = (data && (data.error || data.message)) || "Unknown Apps Script error";
    throw new Error(`Apps Script error (HTTP ${res.status}): ${backendError}`);
  }

  return data;
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json(errorJson("Method not allowed. Use GET or POST.", 405));
    return;
  }

  try {
    const payload =
      req.method === "GET"
        ? { ...(req.query || {}) }
        : typeof req.body === "object" && req.body !== null
        ? req.body
        : {};

    const action = String(payload.action || "").trim();
    if (!action) {
      res.status(400).json(errorJson("Missing action parameter", 400));
      return;
    }

    // Health handled locally
    if (action === "health") {
      res.status(200).json({
        ok: true,
        service: "NahlHub",
        info: "Hub backend is running.",
        hasGreenApi: !!(GREEN_API_INSTANCE_ID && GREEN_API_TOKEN),
        hasOtpSecret: !!OTP_HMAC_SECRET,
        otpTtlSeconds: OTP_TTL_SECONDS,
        otpLength: OTP_LENGTH,
      });
      return;
    }

    // ------------------- OTP: sendOtp handled in Vercel -------------------
    if (action === "sendOtp" || action === "auth.requestOtp") {
      requireConfigured(OTP_HMAC_SECRET, "OTP_HMAC_SECRET");
      requireConfigured(GREEN_API_INSTANCE_ID, "GREEN_API_INSTANCE_ID");
      requireConfigured(GREEN_API_TOKEN, "GREEN_API_TOKEN");
      requireConfigured(HUB_BACKEND_URL, "HUB_BACKEND_URL");

      const mobile = String(payload.mobile || "").trim();
      if (!mobile) {
        res.status(400).json(errorJson("Mobile is required.", 400));
        return;
      }

      const appId = String(payload.appId || payload.appid || HUB_APP_ID || "HUB").trim();
      const otp = randomNumericOtp(OTP_LENGTH);

      const now = Date.now();
      const expiresAtIso = new Date(now + OTP_TTL_SECONDS * 1000).toISOString();
      const otpRef = buildOtpRef({ appId, mobile, otp, expiresAtIso });

      // 1) Store OTP in Apps Script (sheet)
      const storeRes = await callHubBackend({
        action: "otp.store",
        appId,
        mobile,
        otp,
        expiresAt: expiresAtIso,
      });

      if (!storeRes || storeRes.success !== true) {
        throw new Error(storeRes?.error || "Failed to store OTP in backend.");
      }

      // 2) Send via Green API
      const chatId = normalizeMobileToChatId(mobile);
      if (!chatId) {
        res.status(400).json(errorJson("Invalid mobile format.", 400));
        return;
      }

      const message =
        `رمز الدخول إلى NahlHub هو: ${otp}\n\n` +
        `This is your NahlHub login code: ${otp}`;

      await sendGreenApiMessage({ chatId, message });

      // 3) Return otpRef (client must send it back in verifyOtp)
      res.status(200).json({
        success: true,
        message: "OTP sent via WhatsApp.",
        otpRef,
        expiresAt: expiresAtIso,
      });
      return;
    }

    // ------------------- OTP: verifyOtp check otpRef then forward -------------------
    if (action === "verifyOtp" || action === "auth.verifyOtp") {
      const mobile = String(payload.mobile || "").trim();
      const otp = String(payload.otp || "").trim();
      const otpRef = String(payload.otpRef || "").trim();
      const expiresAt = String(payload.expiresAt || "").trim(); // optional if you want, but we don’t require

      if (!mobile || !otp) {
        res.status(400).json(errorJson("mobile and otp are required.", 400));
        return;
      }
      if (!otpRef) {
        res.status(400).json(errorJson("otpRef is required.", 400));
        return;
      }

      // Validate otpRef
      // If expiresAt not provided, we validate without it (we recommend passing expiresAt from sendOtp).
      const appId = String(payload.appId || payload.appid || HUB_APP_ID || "HUB").trim();
      const refToCompare = buildOtpRef({
        appId,
        mobile,
        otp,
        expiresAtIso: expiresAt || "", // if empty, mismatch => require expiresAt in client
      });

      if (!expiresAt) {
        res.status(400).json(errorJson("expiresAt is required for otpRef validation.", 400));
        return;
      }

      if (otpRef !== refToCompare) {
        res.status(403).json(errorJson("Invalid otpRef.", 403));
        return;
      }

      // Forward to Apps Script for actual OTP check + session creation
      const backendResponse = await callHubBackend(payload);
      res.status(200).json(backendResponse);
      return;
    }

    // Default: proxy everything else to Apps Script
    const backendResponse = await callHubBackend(payload);
    res.status(200).json(backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);

    const message = err?.message || "Unexpected server error";
    const extra =
      process.env.NODE_ENV !== "production"
        ? { stack: err?.stack || null }
        : {};

    res.status(500).json(errorJson(message, 500, extra));
  }
}
