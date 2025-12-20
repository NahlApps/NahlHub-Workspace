// pages/api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy + OTP Sender (GreenAPI)
// ==================================================================
/**
 * ✅ Updates in this version:
 * 1) Better structured errors (no silent 500)
 * 2) Optional GET health/info: ?action=health
 * 3) GreenAPI phone normalization + fallback chatId formats
 * 4) OTP store flow is SAFER: store first, then send (or send first if you prefer)
 * 5) Forwarding supports both POST/GET payloads consistently
 * 6) Adds basic request tracing via x-request-id
 */

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

// Behavior flags (optional)
const OTP_SEND_FIRST = String(process.env.OTP_SEND_FIRST || "true").toLowerCase() === "true";
// true  => send WhatsApp first then store
// false => store first then send WhatsApp

function errorJson(message, statusCode = 500, extra = {}) {
  return { success: false, statusCode, error: message, ...extra };
}

function getRequestId(req) {
  // Prefer incoming id from client, otherwise create
  const h = req.headers["x-request-id"];
  return String(h || crypto.randomUUID());
}

function normalizeMobile(mobileRaw = "") {
  const d = String(mobileRaw).trim().replace(/[^\d]/g, "");
  // KSA patterns
  if (d.length === 12 && d.startsWith("966")) return d.slice(3);
  if (d.length === 10 && d.startsWith("0")) return d.slice(1);
  return d;
}

function generateOtp(len = 4) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function maskMobile(m) {
  const s = String(m || "");
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}******${s.slice(-2)}`;
}

async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) throw new Error("HUB_BACKEND_URL is not configured.");

  const finalPayload = { ...(payload || {}) };

  // Ensure appId always present
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
    // Apps Script sometimes returns HTML error pages — surface it clearly
    throw new Error(`Apps Script non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  // If Apps Script responds success:false or HTTP not ok
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
    data = JSON.parse(text);
  } catch {
    throw new Error(`GreenAPI non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    // GreenAPI error payloads vary; show best message we can
    throw new Error(data?.message || data?.error || `GreenAPI HTTP ${res.status}`);
  }

  return data;
}

function signOtpStore({ appId, mobile, otp, ts }) {
  if (!OTP_HMAC_SECRET) throw new Error("OTP_HMAC_SECRET is missing in Vercel env.");
  const msg = `${appId}|${mobile}|${otp}|${ts}`;
  return crypto.createHmac("sha256", OTP_HMAC_SECRET).update(msg).digest("hex");
}

/**
 * Some accounts require different chatId formats.
 * We'll try a primary one and optional fallbacks if it fails.
 */
async function greenSendWithFallbacks(mobile, message) {
  const candidates = [
    `${mobile}@c.us`,
    // fallback if your GreenAPI expects full country format already:
    // `${"966" + mobile}@c.us`,
  ];

  let lastErr = null;
  for (const chatId of candidates) {
    try {
      const r = await greenSendMessage(chatId, message);
      return { ok: true, chatId, r };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Failed to send WhatsApp message.");
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Request-Id");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json(errorJson("Method not allowed. Use GET or POST.", 405));
  }

  const requestId = getRequestId(req);

  try {
    const payload =
      req.method === "GET"
        ? { ...(req.query || {}) }
        : typeof req.body === "object" && req.body !== null
        ? req.body
        : {};

    const action = String(payload.action || "").trim();
    if (!action) {
      return res.status(400).json(errorJson("Missing action parameter", 400, { requestId }));
    }

    // Basic health that won't hit Apps Script unless you want it
    if (action === "health") {
      return res.status(200).json({
        ok: true,
        service: "NahlHub",
        info: "Hub backend is running.",
        hasGreenApi: !!(GREEN_API_INSTANCE_ID && GREEN_API_TOKEN),
        hasHubBackendUrl: !!HUB_BACKEND_URL,
        requestId,
      });
    }

    // --- Local OTP sender ---
    if (action === "sendOtp" || action === "auth.requestOtp") {
      const mobile = normalizeMobile(payload.mobile || "");
      if (!mobile) return res.status(400).json(errorJson("Mobile is required.", 400, { requestId }));

      const appId = String(payload.appId || payload.appid || HUB_APP_ID || "HUB").trim();
      const otp = generateOtp(OTP_LENGTH);

      const ts = Date.now();
      const sig = signOtpStore({ appId, mobile, otp, ts });

      // message (can be localized later)
      const message = `رمز التحقق: ${otp}\nصالح لمدة ${OTP_TTL_MIN} دقائق.`;

      // Option A: send first then store (default)
      if (OTP_SEND_FIRST) {
        const green = await greenSendWithFallbacks(mobile, message);

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
          idMessage: green?.r?.idMessage || "",
          chatId: green?.chatId || "",
          requestId,
        });
      }

      // Option B: store first then send (safer if you want "OTP exists" guarantee)
      await callHubBackend({
        action: "otp.store",
        appId,
        mobile,
        otp,
        ts,
        sig,
      });

      const green = await greenSendWithFallbacks(mobile, message);

      return res.status(200).json({
        success: true,
        sent: true,
        idMessage: green?.r?.idMessage || "",
        chatId: green?.chatId || "",
        requestId,
      });
    }

    // --- Forward all other actions to Apps Script ---
    const backendResponse = await callHubBackend(payload);
    return res.status(200).json({ ...backendResponse, requestId });
  } catch (err) {
    console.error("❌ /api/hub/manage error:", {
      requestId,
      message: err?.message,
      stack: err?.stack,
    });

    // Make error message visible + include requestId for debugging
    return res.status(500).json(
      errorJson(err?.message || "Unexpected server error", 500, {
        requestId,
      })
    );
  }
}
