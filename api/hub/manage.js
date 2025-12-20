// pages/api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy (+ WhatsApp OTP via Green API)
// ======================================================================

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL; // Apps Script /exec
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

// Green API (WhatsApp)
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
// Optional (defaults to official Green API host)
const GREEN_API_BASE_URL = process.env.GREEN_API_BASE_URL || "https://api.green-api.com";

// Optional security secret (not required for basic flow)
const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || "";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function errorJson(message, statusCode = 500, extra = {}) {
  return { success: false, statusCode, error: message, ...extra };
}

function okJson(extra = {}) {
  return { success: true, ...extra };
}

function normalizeMobileForWhatsApp(mobileRaw) {
  // Frontend sends: 5XXXXXXXX (Saudi local) OR maybe already international
  const m = String(mobileRaw || "").trim().replace(/\s+/g, "");
  if (!m) return { mobileRaw: "", mobileIntl: "", chatId: "" };

  // Keep raw for Sheets matching (as user typed)
  let mobileIntl = m;

  // If user typed 5XXXXXXXX => add 966
  if (/^5\d{8}$/.test(m)) mobileIntl = "966" + m;

  // If user typed 05XXXXXXXX => remove 0 and add 966
  if (/^05\d{8}$/.test(m)) mobileIntl = "966" + m.slice(1);

  // If includes +, remove +
  mobileIntl = mobileIntl.replace(/^\+/, "");

  // WhatsApp chatId format
  const chatId = mobileIntl ? `${mobileIntl}@c.us` : "";

  return { mobileRaw: m, mobileIntl, chatId };
}

function genOtp4() {
  // 0000–9999 => 4 digits padded
  const n = Math.floor(Math.random() * 10000);
  return String(n).padStart(4, "0");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Call Apps Script backend (JSON POST).
 * Automatically injects default appId if missing.
 */
async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) throw new Error("HUB_BACKEND_URL is not configured.");

  const finalPayload = { ...(payload || {}) };

  if (!finalPayload.appId && !finalPayload.appid && HUB_APP_ID) {
    finalPayload.appId = HUB_APP_ID;
  }

  const res = await fetchWithTimeout(
    HUB_BACKEND_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalPayload),
    },
    20000
  );

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Apps Script sometimes returns HTML on errors
    return errorJson("Apps Script returned non-JSON response.", 502, {
      httpStatus: res.status,
      sample: text.slice(0, 200),
    });
  }

  if (!res.ok) {
    return errorJson(
      (data && (data.error || data.message)) || "Apps Script error",
      res.status || 502,
      { backend: data }
    );
  }

  return data;
}

/**
 * Send WhatsApp OTP using Green API.
 */
async function sendWhatsAppOtp({ chatId, message }) {
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    return errorJson("Green API env vars are missing (GREEN_API_INSTANCE_ID / GREEN_API_TOKEN).", 500);
  }
  if (!chatId) return errorJson("Invalid WhatsApp chatId.", 400);

  const url = `${GREEN_API_BASE_URL}/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message }),
    },
    15000
  );

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // keep text
  }

  if (!res.ok) {
    return errorJson("Green API sendMessage failed.", 502, {
      httpStatus: res.status,
      response: data || text.slice(0, 200),
    });
  }

  // Green API success often includes idMessage / etc.
  return okJson({ greenApi: data || { ok: true } });
}

/**
 * sendOtp action:
 * 1) generate otp
 * 2) send via WhatsApp (Green API)
 * 3) store OTP in Apps Script via action: otp.store
 */
async function handleSendOtp(payload) {
  const mobile = String(payload.mobile || "").trim();
  if (!mobile) return errorJson("Mobile is required.", 400);

  const { mobileRaw, chatId } = normalizeMobileForWhatsApp(mobile);
  if (!chatId) return errorJson("Mobile format is invalid.", 400);

  const otp = genOtp4();

  // Message text (keep it simple)
  const message = `رمز الدخول إلى NahlHub: ${otp}\nصلاحية الرمز: 10 دقائق`;

  // 1) WhatsApp send
  const waRes = await sendWhatsAppOtp({ chatId, message });
  if (!waRes.success) return waRes;

  // 2) Store in Sheets via Apps Script
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const storeRes = await callHubBackend({
    action: "otp.store",
    mobile: mobileRaw,
    otp,
    expiresAt,
  });

  if (!storeRes || storeRes.success !== true) {
    return errorJson("OTP sent, but failed to store OTP in backend.", 502, {
      storeRes,
    });
  }

  return okJson({
    message: "OTP sent",
    // You may hide these in production:
    // otp,
    expiresAt,
  });
}

// ------------------------------------------------------------------
// Next.js API route handler
// ------------------------------------------------------------------

export default async function handler(req, res) {
  // CORS
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

    // Local health (fast)
    if (action === "health") {
      res.status(200).json({
        ok: true,
        service: "NahlHub",
        info: "Hub backend is running.",
        hasGreenApi: !!(GREEN_API_INSTANCE_ID && GREEN_API_TOKEN),
        hasBackendUrl: !!HUB_BACKEND_URL,
        hasOtpHmacSecret: !!OTP_HMAC_SECRET,
        appId: HUB_APP_ID,
      });
      return;
    }

    // IMPORTANT: Intercept sendOtp here (do not forward to Apps Script)
    if (action === "sendOtp" || action === "auth.requestOtp") {
      const out = await handleSendOtp(payload);
      // return 200 even for expected failures so frontend shows res.error
      res.status(200).json(out);
      return;
    }

    // Forward all other actions to Apps Script
    const backendResponse = await callHubBackend(payload);
    res.status(200).json(backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);
    res.status(200).json(errorJson(err.message || "Unexpected server error", 500));
  }
}
