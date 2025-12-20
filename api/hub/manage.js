// pages/api/hub/manage.js
// NahlHub – Vercel API → WhatsApp OTP (GreenAPI) + Apps Script (store/verify)
// ========================================================================
//
// Frontend actions:
//   - sendOtp        -> Vercel generates OTP, sends via GreenAPI, stores via Apps Script otp.store
//   - verifyOtp      -> proxied to Apps Script verifyOtp
//   - workspace.*    -> proxied to Apps Script
//   - marketplace.*  -> proxied to Apps Script
//   - health         -> local health + optional Apps Script forward

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL; // Apps Script /exec
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET; // optional (security signature)
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE || "966").replace(/\D/g, "");

// ------------------------------
// Helpers
// ------------------------------

function errorJson(message, statusCode = 500, extra = {}) {
  return { success: false, statusCode, error: message, ...extra };
}

function okJson(extra = {}) {
  return { success: true, ...extra };
}

function normalizeMobile(input) {
  let s = String(input || "").trim();
  if (!s) return "";

  // keep digits + leading +
  s = s.replace(/[^\d+]/g, "");

  // +9665xxxxxxx -> 9665xxxxxxx
  if (s.startsWith("+")) s = s.slice(1);

  // 009665xxxxxxx -> 9665xxxxxxx
  if (s.startsWith("00")) s = s.slice(2);

  // If starts with 0 (local), remove leading 0
  if (s.startsWith("0")) s = s.slice(1);

  // If number is local KSA format like 5XXXXXXXX, add 966
  if (s.startsWith("5") && s.length === 9 && DEFAULT_COUNTRY_CODE) {
    s = DEFAULT_COUNTRY_CODE + s;
  }

  return s.replace(/\D/g, "");
}

function toChatIdE164(mobileDigits) {
  // Green API expects chatId format: "<E164>@c.us" (commonly)
  // e.g. 9665xxxxxxx@c.us
  return `${mobileDigits}@c.us`;
}

function generateOtp(length = 4) {
  let otp = "";
  for (let i = 0; i < length; i++) otp += Math.floor(Math.random() * 10);
  return otp;
}

function isoInMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function hmacSha256Hex(secret, message) {
  // optional signature to prove otp.store came from Vercel
  // Uses WebCrypto available in modern runtimes. If not available, skip gracefully.
  return (async () => {
    if (!secret || !globalThis.crypto?.subtle) return "";
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
    return Buffer.from(sig).toString("hex");
  })();
}

/**
 * Call Apps Script backend (JSON POST).
 * Auto inject appId if missing.
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

/**
 * Send WhatsApp OTP via Green API.
 */
async function sendOtpViaGreenApi({ mobileDigits, otp }) {
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    throw new Error("Missing GREEN_API_INSTANCE_ID or GREEN_API_TOKEN in Vercel env.");
  }

  const chatId = toChatIdE164(mobileDigits);

  // Green API common endpoint format:
  // POST https://api.green-api.com/waInstance{instanceId}/sendMessage/{token}
  const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

  const message = `رمز الدخول (NahlHub): ${otp}\n⏳ صالح لمدة ${OTP_TTL_MINUTES} دقائق`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId,
      message,
    }),
  });

  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw text
  }

  if (!resp.ok) {
    throw new Error(`Green API failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }

  return { ok: true, green: data || { raw: text } };
}

// ------------------------------
// Handler
// ------------------------------

export default async function handler(req, res) {
  // CORS
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

    const action = String(payload.action || "").trim();
    if (!action) return res.status(400).json(errorJson("Missing action parameter", 400));

    // Local health
    if (action === "health") {
      return res.status(200).json(
        okJson({
          service: "NahlHub",
          hasGreenApi: !!(GREEN_API_INSTANCE_ID && GREEN_API_TOKEN),
          hasBackend: !!HUB_BACKEND_URL,
          appId: HUB_APP_ID,
        })
      );
    }

    // ✅ sendOtp handled in Vercel
    if (action === "sendOtp" || action === "auth.requestOtp") {
      const rawMobile = String(payload.mobile || "").trim();
      if (!rawMobile) return res.status(400).json(errorJson("Mobile is required.", 400));

      const mobileDigits = normalizeMobile(rawMobile);
      if (!mobileDigits || mobileDigits.length < 9) {
        return res.status(400).json(errorJson("Invalid mobile format.", 400, { mobile: rawMobile }));
      }

      const otp = generateOtp(4);
      const expiresAt = isoInMinutes(OTP_TTL_MINUTES);

      // 1) Send via WhatsApp Green API
      const greenRes = await sendOtpViaGreenApi({ mobileDigits, otp });

      // 2) Store OTP in Apps Script
      // Optional signature: `${appId}.${mobile}.${otp}.${expiresAt}`
      const appId = String(payload.appId || payload.appid || HUB_APP_ID || "HUB");
      const sigMsg = `${appId}.${mobileDigits}.${otp}.${expiresAt}`;
      const sig = await hmacSha256Hex(OTP_HMAC_SECRET, sigMsg);

      const storeRes = await callHubBackend({
        action: "otp.store",
        appId,
        mobile: rawMobile, // keep same as UI input (Apps Script matches this)
        otp,
        expiresAt,
        sig, // optional, ignored if Apps Script doesn't check it
      });

      if (!storeRes?.success) {
        return res.status(500).json(
          errorJson("OTP sent but failed to store OTP in backend.", 500, {
            storeRes,
          })
        );
      }

      return res.status(200).json(
        okJson({
          message: "OTP sent via WhatsApp and stored.",
          expiresAt,
          green: greenRes.green,
        })
      );
    }

    // Everything else → proxy to Apps Script
    const backendResponse = await callHubBackend(payload);
    return res.status(200).json(backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);
    return res.status(500).json(errorJson(err?.message || "Unexpected server error", 500));
  }
}
