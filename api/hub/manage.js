// api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy + GreenAPI OTP sender
// ==================================================================
// Env variables (Vercel → Project Settings → Environment Variables):
//   HUB_BACKEND_URL        = <Apps Script Web App URL> (ends with /exec)
//   GREEN_API_INSTANCE_ID  = <Green API instance id, e.g. 1100123456>
//   GREEN_API_TOKEN        = <Green API token>
//   GREEN_API_BASE_URL     = https://api.green-api.com   (optional; default)
//   OTP_SENDER_COUNTRY_CODE = 966   (optional; default SA)
//
// Frontend calls this endpoint at:  /api/hub/manage
// Actions handled:
//   - sendOtp               → Apps Script generates OTP, GreenAPI sends it
//   - verifyOtp             → proxied to Apps Script
//   - hub.loadState         → proxied to Apps Script
//   - workspace.create      → proxied to Apps Script
//   - workspace.listForUser → proxied to Apps Script
//   - marketplace.listTemplates
//   - marketplace.installTemplate
//   - marketplace.listWorkspaceApps
//
// All responses are JSON.

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_API_BASE_URL =
  process.env.GREEN_API_BASE_URL || "https://api.green-api.com";
const OTP_SENDER_COUNTRY_CODE =
  process.env.OTP_SENDER_COUNTRY_CODE || "966"; // default: Saudi

// Small helper to build a standard error JSON
function errorJson(message, statusCode = 500, extra = {}) {
  return {
    ok: false,
    statusCode,
    error: message,
    ...extra,
  };
}

// Normalize mobile to WhatsApp chatId format.
// - Expects digits only; will prepend country code if needed.
// - Returns e.g. "9665xxxxxxx@c.us".
function buildWhatsAppChatId(rawMobile) {
  if (!rawMobile) return null;

  // Remove non-digits
  let digits = String(rawMobile).replace(/\D/g, "");

  // If it starts with a leading zero, drop it.
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // If it does not start with country code, prepend default country code.
  if (!digits.startsWith(OTP_SENDER_COUNTRY_CODE)) {
    digits = OTP_SENDER_COUNTRY_CODE + digits;
  }

  return `${digits}@c.us`;
}

// Call Apps Script backend
async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) {
    throw new Error("HUB_BACKEND_URL is not configured in environment.");
  }

  const res = await fetch(HUB_BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Apps Script returned non-JSON response (status ${res.status}): ${text.slice(
        0,
        200
      )}`
    );
  }

  if (!res.ok) {
    throw new Error(
      `Apps Script error (HTTP ${res.status}): ${
        data && data.error ? data.error : "Unknown error"
      }`
    );
  }

  return data;
}

// Send WhatsApp message via Green API using generated OTP
async function sendOtpViaGreenApi(mobile, otp) {
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    return {
      ok: false,
      reason: "Missing GreenAPI credentials (instance / token).",
    };
  }

  const chatId = buildWhatsAppChatId(mobile);
  if (!chatId) {
    return { ok: false, reason: "Invalid mobile number for WhatsApp." };
  }

  const url = `${GREEN_API_BASE_URL.replace(
    /\/$/,
    ""
  )}/waInstance${GREEN_API_INSTANCE_ID}/SendMessage/${GREEN_API_TOKEN}`;

  const messageAr = `رمز الدخول لنحل هب: ${otp}\n\nصالح لمدة ١٠ دقائق. لا تشارك هذا الكود مع أي شخص.`;
  const messageEn = `Your NahlHub login code is: ${otp}\n\nValid for 10 minutes. Do not share this code with anyone.`;
  const finalMessage = `${messageAr}\n\n${messageEn}`;

  const payload = {
    chatId,
    message: finalMessage,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }

    if (!res.ok) {
      console.error("❌ GreenAPI error:", res.status, text);
      return {
        ok: false,
        reason: `GreenAPI HTTP ${res.status}`,
        raw: data || text,
      };
    }

    // GreenAPI often returns {"idMessage":"..."} on success
    return {
      ok: true,
      raw: data || text,
    };
  } catch (err) {
    console.error("❌ GreenAPI fetch error:", err);
    return { ok: false, reason: err.message || String(err) };
  }
}

export default async function handler(req, res) {
  // Basic CORS (optional but handy for dev)
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

  if (req.method !== "POST" && req.method !== "GET") {
    res
      .status(405)
      .json(errorJson("Method not allowed. Use POST or GET.", 405));
    return;
  }

  try:
  {
    const payload =
      req.method === "GET"
        ? { ...(req.query || {}) }
        : typeof req.body === "object"
        ? req.body
        : {};

    const action = (payload.action || "").trim();

    if (!action) {
      res.status(400).json(errorJson("Missing action parameter", 400));
      return;
    }

    // Special handling for OTP to include GreenAPI sending
    if (action === "sendOtp") {
      const mobile = (payload.mobile || "").trim();
      const appId = (payload.appId || payload.appid || "").trim();

      if (!mobile) {
        res.status(400).json(errorJson("Mobile is required.", 400));
        return;
      }

      // 1) Ask Apps Script to generate & store OTP
      const hubRes = await callHubBackend({
        action: "sendOtp",
        appId,
        mobile,
      });

      if (!hubRes || !hubRes.success) {
        res.status(500).json(
          errorJson("Failed to generate OTP in backend.", 500, {
            hubRes,
          })
        );
        return;
      }

      const otp = hubRes.debugOtp; // NOTE: only for dev; in prod you can stop returning it
      if (!otp) {
        res.status(500).json(
          errorJson("Backend did not return OTP for sending.", 500, {
            hubRes,
          })
        );
        return;
      }

      // 2) Send via GreenAPI
      const waResult = await sendOtpViaGreenApi(mobile, otp);

      if (!waResult.ok) {
        // Still success for frontend (OTP exists), but warn about WhatsApp send
        res.status(200).json({
          success: true,
          otpStored: true,
          whatsappSent: false,
          whatsappError: waResult.reason || "Unknown GreenAPI error",
        });
        return;
      }

      res.status(200).json({
        success: true,
        otpStored: true,
        whatsappSent: true,
      });
      return;
    }

    // All other actions are just proxied to Apps Script
    const backendResponse = await callHubBackend(payload);
    res.status(200).json(backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);
    res
      .status(500)
      .json(errorJson(err.message || "Unexpected server error", 500));
  }
}
