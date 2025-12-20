// api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy + OTP (Vercel) + WhatsApp (Green API)

import crypto from "crypto";
import { kv } from "@vercel/kv";

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const OTP_SECRET = process.env.OTP_SECRET;

// OTP policy
const OTP_LENGTH = 4;
const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

function errorJson(message, statusCode = 500, extra = {}) {
  return { success: false, statusCode, error: message, ...extra };
}

function normalizeMobileToChatId(mobile) {
  let num = String(mobile || "").trim();
  if (!num) return null;

  if (num.startsWith("+")) num = num.slice(1);
  if (num.startsWith("00")) num = num.slice(2);

  // Saudi common cases
  if (num.startsWith("966")) return `${num}@c.us`;
  if (num.startsWith("5") && num.length >= 8) return `966${num}@c.us`;

  // fallback
  return `${num}@c.us`;
}

function generateOtp() {
  const min = Math.pow(10, OTP_LENGTH - 1); // 1000
  const max = 9 * min;                     // 9000
  return String(Math.floor(min + Math.random() * max)).slice(0, OTP_LENGTH);
}

function hashOtp(otp) {
  if (!OTP_SECRET) throw new Error("OTP_SECRET is not configured.");
  return crypto.createHash("sha256").update(`${OTP_SECRET}:${otp}`).digest("hex");
}

async function sendWhatsAppGreenApi(mobile, message) {
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    throw new Error("Green API credentials are missing (GREEN_API_INSTANCE_ID / GREEN_API_TOKEN).");
  }

  const chatId = normalizeMobileToChatId(mobile);
  if (!chatId) throw new Error("Invalid mobile.");

  const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });

  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Green API sendMessage failed (HTTP ${r.status}): ${text.slice(0, 250)}`);
  }
  return true;
}

/**
 * Call Apps Script backend (JSON POST).
 * Automatically injects default appId if missing.
 */
async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) throw new Error("HUB_BACKEND_URL is not configured in environment.");

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
  } catch {
    throw new Error(`Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const backendError = (data && (data.error || data.message)) || "Unknown Apps Script error";
    throw new Error(`Apps Script error (HTTP ${res.status}): ${backendError}`);
  }

  return data;
}

function otpKey(appId, mobile) {
  return `otp:${appId}:${mobile}`;
}
function otpAttemptsKey(appId, mobile) {
  return `otp_attempts:${appId}:${mobile}`;
}

async function handleSendOtpVercel({ appId, mobile }) {
  if (!appId) return errorJson("Missing appId", 400);
  if (!mobile) return errorJson("Mobile is required.", 400);

  const otp = generateOtp();
  const otpHash = hashOtp(otp);

  // Store OTP hash with TTL
  await kv.set(otpKey(appId, mobile), JSON.stringify({ otpHash, createdAt: Date.now() }), {
    ex: OTP_TTL_SECONDS,
  });

  // Reset attempts counter with same TTL
  await kv.set(otpAttemptsKey(appId, mobile), 0, { ex: OTP_TTL_SECONDS });

  // Send via WhatsApp Green API
  const msg = `رمز الدخول إلى NahlHub هو: ${otp}\n\nYour NahlHub login code: ${otp}`;
  await sendWhatsAppGreenApi(mobile, msg);

  return { success: true, message: "OTP generated and sent via WhatsApp." };
}

async function handleVerifyOtpVercel({ appId, mobile, otp }) {
  if (!appId) return errorJson("Missing appId", 400);
  if (!mobile) return errorJson("Mobile is required.", 400);
  if (!otp) return errorJson("OTP is required.", 400);

  // Fetch stored OTP
  const raw = await kv.get(otpKey(appId, mobile));
  if (!raw) return errorJson("Invalid or expired OTP.", 401);

  let stored;
  try {
    stored = JSON.parse(raw);
  } catch {
    return errorJson("OTP storage corrupted.", 500);
  }

  // Attempts
  const attempts = Number((await kv.get(otpAttemptsKey(appId, mobile))) || 0);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    return errorJson("Too many attempts. Please request a new OTP.", 429);
  }

  const incomingHash = hashOtp(String(otp).trim());
  const ok = incomingHash === stored.otpHash;

  if (!ok) {
    await kv.incr(otpAttemptsKey(appId, mobile));
    return errorJson("Invalid or expired OTP.", 401);
  }

  // OTP valid → delete OTP key (one-time)
  await kv.del(otpKey(appId, mobile));
  await kv.del(otpAttemptsKey(appId, mobile));

  // Now call Apps Script ONLY to create session/user response
  // IMPORTANT: Apps Script action must exist: auth.createSessionForMobile
  const backendResponse = await callHubBackend({
    action: "auth.createSessionForMobile",
    appId,
    mobile,
  });

  return backendResponse;
}

export default async function handler(req, res) {
  // Basic CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

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

    if (!payload.appId && !payload.appid) payload.appId = HUB_APP_ID;

    const action = String(payload.action || "").trim();
    if (!action) return res.status(400).json(errorJson("Missing action parameter", 400));

    // ✅ OTP handled in Vercel (GitHub + Vercel)
    if (action === "sendOtp" || action === "auth.requestOtp") {
      const result = await handleSendOtpVercel({
        appId: String(payload.appId || payload.appid || "").trim(),
        mobile: String(payload.mobile || "").trim(),
      });
      return res.status(result.success ? 200 : (result.statusCode || 500)).json(result);
    }

    if (action === "verifyOtp" || action === "auth.verifyOtp") {
      const result = await handleVerifyOtpVercel({
        appId: String(payload.appId || payload.appid || "").trim(),
        mobile: String(payload.mobile || "").trim(),
        otp: String(payload.otp || "").trim(),
      });
      return res.status(result.success ? 200 : (result.statusCode || 500)).json(result);
    }

    // Everything else → proxy to Apps Script
    const backendResponse = await callHubBackend(payload);
    return res.status(200).json(backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);
    return res.status(500).json(errorJson(err.message || "Unexpected server error", 500));
  }
}
