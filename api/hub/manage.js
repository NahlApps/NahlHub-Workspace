// pages/api/hub/manage.js
// NahlHub – Vercel API → OTP (local) + Apps Script proxy
// ==================================================================
//
// ✅ OTP workflow is handled here (Vercel):
//   - sendOtp / auth.requestOtp
//   - verifyOtp / auth.verifyOtp
//
// ✅ After OTP verify, we call Apps Script:
//   - auth.createSession
//
// Other actions are proxied to Apps Script unchanged.

import crypto from "crypto";

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

// Green API
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

// OTP settings
const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET; // required for OTP
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS || 600); // default 10 min
const OTP_LENGTH = Number(process.env.OTP_LENGTH || 4);

// Optional: protect auth.createSession call to Apps Script
const HUB_PROXY_SECRET = process.env.HUB_PROXY_SECRET || "";

// ------------------------------------------------------------------
// Safe fetch (Node 18+ has global fetch; fallback for older runtime)
// ------------------------------------------------------------------
async function fetchAny(url, options) {
  if (globalThis.fetch) return globalThis.fetch(url, options);
  const mod = await import("node-fetch");
  return mod.default(url, options);
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function errorJson(message, statusCode = 500, extra = {}) {
  return { success: false, statusCode, error: message, ...extra };
}

function normalizeMobileToChatId(mobile) {
  let num = String(mobile || "").trim();
  if (!num) return null;
  if (num.startsWith("+")) num = num.slice(1);
  if (num.startsWith("00")) num = num.slice(2);
  if (num.startsWith("966")) return `${num}@c.us`;
  if (num.startsWith("5") && num.length >= 8) return `966${num}@c.us`;
  return `${num}@c.us`;
}

function requireOtpConfig() {
  if (!OTP_HMAC_SECRET) {
    throw new Error("OTP_HMAC_SECRET is missing in Vercel environment.");
  }
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    throw new Error("Green API is not configured (GREEN_API_INSTANCE_ID / GREEN_API_TOKEN).");
  }
}

function timeStepNow() {
  return Math.floor(Date.now() / (OTP_TTL_SECONDS * 1000));
}

function computeOtpForStep(mobile, step) {
  // Deterministic OTP per (mobile, step). No storage required.
  // OTP = HMAC(secret, `${mobile}|${step}`) => integer => mod 10^len
  const msg = `${String(mobile).trim()}|${step}`;
  const h = crypto.createHmac("sha256", OTP_HMAC_SECRET).update(msg).digest();
  // Use first 4 bytes as uint32
  const codeInt = h.readUInt32BE(0);
  const mod = 10 ** OTP_LENGTH;
  const otp = String(codeInt % mod).padStart(OTP_LENGTH, "0");
  return otp;
}

async function sendOtpViaGreenApi(mobile, otp) {
  const chatId = normalizeMobileToChatId(mobile);
  if (!chatId) throw new Error("Invalid mobile number.");

  const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
  const msg = `رمز الدخول إلى NahlHub هو: ${otp}\n\nThis is your NahlHub login code: ${otp}`;

  const res = await fetchAny(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message: msg }),
  });

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {}

  if (!res.ok) {
    throw new Error(`Green API failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  return { ok: true, greenApi: data || text };
}

/**
 * Call Apps Script backend (JSON POST).
 * Automatically injects default appId if missing.
 */
async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) {
    throw new Error("HUB_BACKEND_URL is not configured in environment.");
  }

  const finalPayload = { ...(payload || {}) };

  if (!finalPayload.appId && !finalPayload.appid && HUB_APP_ID) {
    finalPayload.appId = HUB_APP_ID;
  }

  const res = await fetchAny(HUB_BACKEND_URL, {
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
    const backendError =
      (data && (data.error || data.message)) || "Unknown Apps Script error";
    throw new Error(`Apps Script error (HTTP ${res.status}): ${backendError}`);
  }

  return data;
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------
export default async function handler(req, res) {
  // Basic CORS
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

    // Local health response (matches what you posted)
    if (action === "health") {
      res.status(200).json({
        ok: true,
        service: "NahlHub",
        info: "Hub backend is running.",
        hasGreenApi: !!(GREEN_API_INSTANCE_ID && GREEN_API_TOKEN),
      });
      return;
    }

    // -----------------------------
    // OTP (handled locally in Vercel)
    // -----------------------------
    if (action === "sendOtp" || action === "auth.requestOtp") {
      const mobile = String(payload.mobile || "").trim();
      if (!mobile) {
        res.status(400).json(errorJson("Mobile is required.", 400));
        return;
      }

      requireOtpConfig();

      const step = timeStepNow();
      const otp = computeOtpForStep(mobile, step);

      await sendOtpViaGreenApi(mobile, otp);

      res.status(200).json({
        success: true,
        message: "OTP sent via WhatsApp.",
        ttlSeconds: OTP_TTL_SECONDS,
      });
      return;
    }

    if (action === "verifyOtp" || action === "auth.verifyOtp") {
      const mobile = String(payload.mobile || "").trim();
      const otp = String(payload.otp || "").trim();

      if (!mobile) {
        res.status(400).json(errorJson("Mobile is required.", 400));
        return;
      }
      if (!otp) {
        res.status(400).json(errorJson("OTP is required.", 400));
        return;
      }

      requireOtpConfig();

      // Allow current step + previous step (small clock drift)
      const nowStep = timeStepNow();
      const expectedNow = computeOtpForStep(mobile, nowStep);
      const expectedPrev = computeOtpForStep(mobile, nowStep - 1);

      const ok = otp === expectedNow || otp === expectedPrev;
      if (!ok) {
        res.status(200).json({ success: false, error: "Invalid or expired OTP." });
        return;
      }

      // OTP verified -> ask Apps Script to create session
      const backendResponse = await callHubBackend({
        action: "auth.createSession",
        mobile,
        proxySecret: HUB_PROXY_SECRET || undefined,
      });

      res.status(200).json(backendResponse);
      return;
    }

    // -----------------------------
    // Proxy all other actions
    // -----------------------------
    const backendResponse = await callHubBackend(payload);
    res.status(200).json(backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);
    res.status(500).json(errorJson(err.message || "Unexpected server error", 500));
  }
}
