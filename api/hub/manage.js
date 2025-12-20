// pages/api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy + OTP Sender (GreenAPI)
// ==================================================================
//
// Local actions:
//   - sendOtp / auth.requestOtp  => GreenAPI send + Apps Script otp.store (HMAC signed)
//   - health                     => local health response
//
// Forwarded actions (to Apps Script):
//   - verifyOtp / auth.verifyOtp
//   - auth.me
//   - auth.logout
//   - workspace.*
//   - marketplace.*

import crypto from "crypto";

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

// GreenAPI
const GREEN_API_URL = process.env.GREEN_API_URL || "https://api.green-api.com";
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

// HMAC secret (must match Apps Script Script Properties)
const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET;

// OTP settings
const OTP_LENGTH = Number(process.env.OTP_LENGTH || 4);
const OTP_TTL_MIN = Number(process.env.OTP_TTL_MIN || 10);

function errorJson(message, statusCode = 500, extra = {}) {
  return { success: false, statusCode, error: message, ...extra };
}

/**
 * Returns local mobile format used in Sheets:
 * - "9665XXXXXXXX" -> "5XXXXXXXX"
 * - "05XXXXXXXX"   -> "5XXXXXXXX"
 * - "+9665..."     -> "5XXXXXXXX"
 */
function normalizeMobileLocal(mobileRaw = "") {
  const d = String(mobileRaw).trim().replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.length === 12 && d.startsWith("966")) return d.slice(3); // 966XXXXXXXXX -> 5XXXXXXXX
  if (d.length === 10 && d.startsWith("0")) return d.slice(1);   // 05XXXXXXXX -> 5XXXXXXXX
  return d; // if already "5XXXXXXXX" keep it
}

/**
 * GreenAPI usually needs international chatId:
 * - local "5XXXXXXXX" => "9665XXXXXXXX@c.us"
 * - already "9665..." => "9665...@c.us"
 */
function toGreenChatId(mobileLocalOrIntl = "") {
  const d = String(mobileLocalOrIntl).trim().replace(/[^\d]/g, "");
  if (!d) return "";

  // if already intl starting 966 and length 12 (Saudi mobile)
  if (d.startsWith("966") && d.length === 12) return `${d}@c.us`;

  // if local 9 digits starting 5 => make it 966 + local
  if (d.length === 9 && d.startsWith("5")) return `966${d}@c.us`;

  // fallback: try as-is
  return `${d}@c.us`;
}

function generateOtp(len = 4) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/**
 * Call Apps Script backend (JSON POST).
 */
async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) {
    throw new Error("HUB_BACKEND_URL is not configured in Vercel environment.");
  }

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

  // Apps Script may return HTML if not deployed correctly
  if (/<!doctype html>|<html/i.test(text || "")) {
    throw new Error(
      `Apps Script returned HTML (HTTP ${res.status}). Ensure Web App access: "Anyone".`
    );
  }

  let data;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    throw new Error(
      `Apps Script returned non-JSON (HTTP ${res.status}): ${String(text).slice(0, 200)}`
    );
  }

  if (!res.ok || data?.success === false) {
    const msg = data?.error || data?.message || `Apps Script HTTP ${res.status}`;
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
      `GreenAPI returned non-JSON (HTTP ${res.status}): ${String(text).slice(0, 200)}`
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
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json(errorJson("Method not allowed. Use GET or POST.", 405));
  }

  try {
    const payload =
      req.method === "GET"
        ? { ...(req.query || {}) }
        : typeof req.body === "object" && req.body !== null
        ? req.body
        : {};

    const action = String(payload.action || "").trim();
    if (!action) return res.status(400).json(errorJson("Missing action parameter", 400));

    // Local health
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

    // Local sendOtp
    if (action === "sendOtp" || action === "auth.requestOtp") {
      const mobileLocal = normalizeMobileLocal(payload.mobile || "");
      if (!mobileLocal) {
        return res.status(400).json(errorJson("Mobile is required.", 400));
      }

      const appId = String(payload.appId || payload.appid || HUB_APP_ID || "HUB").trim();
      const otp = generateOtp(OTP_LENGTH);

      // IMPORTANT: WhatsApp uses international
      const chatId = toGreenChatId(mobileLocal);
      const message = `رمز التحقق: ${otp}\nصالح لمدة ${OTP_TTL_MIN} دقائق.`;

      // Stage: GreenAPI
      let green;
      try {
        green = await greenSendMessage(chatId, message);
      } catch (e) {
        return res.status(500).json(
          errorJson(e?.message || "GreenAPI send failed", 500, {
            stage: "greenapi.send",
            chatId,
          })
        );
      }

      // Stage: Apps Script otp.store
      const ts = Date.now();
      const sig = signOtpStore({ appId, mobile: mobileLocal, otp, ts });

      try {
        await callHubBackend({
          action: "otp.store",
          appId,
          mobile: mobileLocal, // store local format to match verifyOtp normalization
          otp,
          ts,
          sig,
        });
      } catch (e) {
        return res.status(500).json(
          errorJson(e?.message || "Apps Script otp.store failed", 500, {
            stage: "backend.otp.store",
          })
        );
      }

      return res.status(200).json({
        success: true,
        sent: true,
        idMessage: green?.idMessage || "",
      });
    }

    // Forward everything else
    try {
      const backendResponse = await callHubBackend(payload);
      return res.status(200).json(backendResponse);
    } catch (e) {
      return res.status(500).json(
        errorJson(e?.message || "Apps Script call failed", 500, {
          stage: "backend.forward",
          action,
        })
      );
    }
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);
    return res.status(500).json(errorJson(err?.message || "Unexpected server error", 500));
  }
}
