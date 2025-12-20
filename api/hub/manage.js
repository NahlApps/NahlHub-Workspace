// pages/api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy (with WhatsApp OTP via Green API)

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL; // Apps Script /exec
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const OTP_LENGTH = Number(process.env.OTP_LENGTH || 4);
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function json(res, code, obj) {
  res.status(code).json(obj);
}

function errorJson(message, statusCode = 500, extra = {}) {
  return { success: false, statusCode, error: message, ...extra };
}

function mustHaveBackend() {
  if (!HUB_BACKEND_URL) {
    throw new Error("HUB_BACKEND_URL is not configured in Vercel env.");
  }
}

function mustHaveGreenApi() {
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    throw new Error("GREEN_API_INSTANCE_ID / GREEN_API_TOKEN are missing in Vercel env.");
  }
}

function makeOtp(length) {
  // 4 digits, allow leading zeros
  const max = Math.pow(10, length) - 1;
  const n = Math.floor(Math.random() * (max + 1));
  return String(n).padStart(length, "0");
}

function normalizeChatId({ mobileRaw, countryCodeRaw }) {
  let m = String(mobileRaw || "").trim();
  let cc = String(countryCodeRaw || "").trim();

  // Remove spaces, +, non-digits for processing
  const digits = (s) => String(s || "").replace(/\D/g, "");

  const mDigits = digits(m);
  const ccDigits = digits(cc);

  // If already looks like full international without country code passed
  // Example: 9665xxxxxxx
  let full = mDigits;

  if (ccDigits) {
    // If mobile includes country code already, avoid doubling
    if (!full.startsWith(ccDigits)) full = ccDigits + full.replace(/^0+/, "");
  } else {
    // Default KSA if user enters 5xxxxxxx / 05xxxxxxx
    if (full.length === 9 && full.startsWith("5")) full = "966" + full;
    if (full.length === 10 && full.startsWith("05")) full = "966" + full.substring(1);
  }

  if (!full || full.length < 10) return null;
  return `${full}@c.us`;
}

async function callHubBackend(payload) {
  mustHaveBackend();

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
    throw new Error(
      `Apps Script returned non-JSON (HTTP ${res.status}). First 200 chars: ${text.slice(0, 200)}`
    );
  }

  if (!res.ok) {
    const backendError = (data && (data.error || data.message)) || "Unknown Apps Script error";
    throw new Error(`Apps Script error (HTTP ${res.status}): ${backendError}`);
  }

  return data;
}

async function greenApiSendMessage({ chatId, message }) {
  mustHaveGreenApi();

  const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
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
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`Green API sendMessage failed (HTTP ${res.status}): ${text.slice(0, 250)}`);
  }

  return data;
}

// ------------------------------------------------------------
// Handler
// ------------------------------------------------------------
export default async function handler(req, res) {
  // Basic CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, errorJson("Method not allowed. Use GET or POST.", 405));
  }

  try {
    const payload =
      req.method === "GET"
        ? { ...(req.query || {}) }
        : typeof req.body === "object" && req.body !== null
        ? req.body
        : {};

    const action = String(payload.action || "").trim();
    if (!action) return json(res, 400, errorJson("Missing action parameter", 400));

    // Local health (very useful for debugging)
    if (action === "health") {
      return json(res, 200, {
        ok: true,
        service: "NahlHub",
        info: "Hub backend is running.",
        hasGreenApi: !!(GREEN_API_INSTANCE_ID && GREEN_API_TOKEN),
        hasBackend: !!HUB_BACKEND_URL,
      });
    }

    // Debug Apps Script connectivity
    if (action === "debug.backend") {
      try {
        const r = await callHubBackend({ action: "health" });
        return json(res, 200, { success: true, backend: r });
      } catch (e) {
        return json(res, 200, { success: false, error: String(e.message || e) });
      }
    }

    // ✅ OTP: handled in Vercel + Green API
    if (action === "sendOtp" || action === "auth.requestOtp") {
      const mobile = String(payload.mobile || "").trim();
      const countryCode = String(payload.countryCode || "").trim();
      const appId = String(payload.appId || payload.appid || HUB_APP_ID).trim();

      if (!mobile) return json(res, 400, errorJson("Mobile is required.", 400));

      const chatId = normalizeChatId({ mobileRaw: mobile, countryCodeRaw: countryCode });
      if (!chatId) return json(res, 400, errorJson("Invalid mobile/countryCode format.", 400));

      const otp = makeOtp(OTP_LENGTH);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

      const msg =
        `رمز الدخول إلى NahlHub هو: ${otp}\n` +
        `ينتهي خلال ${OTP_EXPIRY_MINUTES} دقائق.\n\n` +
        `NahlHub Login code: ${otp} (expires in ${OTP_EXPIRY_MINUTES} min)`;

      // 1) Send WhatsApp OTP
      await greenApiSendMessage({ chatId, message: msg });

      // 2) Store OTP in Apps Script
      try {
        await callHubBackend({
          action: "otp.store",
          appId,
          mobile,
          otp,
          expiresAt,
        });
      } catch (e) {
        // OTP was sent, but store failed -> still return clear message
        return json(res, 502, errorJson("OTP sent, but failed to store OTP in backend.", 502, {
          backendError: String(e.message || e),
        }));
      }

      return json(res, 200, { success: true, message: "OTP sent via WhatsApp." });
    }

    // Everything else: forward to Apps Script
    const backendResponse = await callHubBackend(payload);
    return json(res, 200, backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);
    return json(res, 500, errorJson(err.message || "Unexpected server error", 500));
  }
}
