// pages/api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy (+ OTP via Green API)
// ==================================================================
//
// Frontend calls this endpoint for:
//   - sendOtp        (NOW handled in Vercel: generate OTP + send via Green API + store in Apps Script)
//   - verifyOtp      (forward to Apps Script)
//   - auth.me        (forward to Apps Script)
//   - auth.logout    (forward to Apps Script)
//   - workspace.*    (forward to Apps Script)
//   - marketplace.*  (forward to Apps Script)
//   - health         (local quick health)
//   - debug.backend  (debug raw Apps Script response)
//
// Required env vars in Vercel:
//   HUB_BACKEND_URL         -> Apps Script WebApp /exec URL
//   HUB_APP_ID              -> default "HUB"
//   GREEN_API_INSTANCE_ID   -> Green API instance id
//   GREEN_API_TOKEN         -> Green API token
//   OTP_HMAC_SECRET         -> random long secret for signing (recommended)
// Optional:
//   OTP_EXP_MINUTES         -> default 10
//   OTP_LEN                 -> default 4

import crypto from "crypto";

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || "";
const OTP_EXP_MINUTES = Number(process.env.OTP_EXP_MINUTES || 10);
const OTP_LEN = Number(process.env.OTP_LEN || 4);

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function json(res, statusCode, obj) {
  res.status(statusCode).json(obj);
}

function okJson(obj = {}) {
  return { success: true, ...obj };
}

function errorJson(message, statusCode = 500, extra = {}) {
  return { success: false, error: message, ...extra };
}

function mask(s, keepStart = 3, keepEnd = 3) {
  if (!s) return "";
  const str = String(s);
  if (str.length <= keepStart + keepEnd) return "*".repeat(str.length);
  return (
    str.slice(0, keepStart) +
    "*".repeat(Math.max(3, str.length - keepStart - keepEnd)) +
    str.slice(str.length - keepEnd)
  );
}

function normalizeSaudiMobileToChatId(mobileRaw) {
  // Frontend uses: 5XXXXXXXX
  // Convert to WhatsApp chatId: 9665XXXXXXXX@c.us
  const m = String(mobileRaw || "").replace(/\D/g, "");
  if (!m) return null;

  // If user entered 05xxxxxxxx
  if (m.length === 10 && m.startsWith("05")) {
    return "966" + m.slice(1) + "@c.us";
  }

  // If user entered 5xxxxxxxx
  if (m.length === 9 && m.startsWith("5")) {
    return "966" + m + "@c.us";
  }

  // If user entered 9665xxxxxxxx
  if (m.length === 12 && m.startsWith("966")) {
    return m + "@c.us";
  }

  // fallback: treat as international (must already include country code)
  if (m.length >= 10) return m + "@c.us";
  return null;
}

function generateOtp(len = 4) {
  let out = "";
  for (let i = 0; i < len; i++) out += String(Math.floor(Math.random() * 10));
  return out;
}

function hmacSha256(secret, text) {
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(text).digest("hex");
}

/**
 * Call Apps Script backend (JSON POST).
 * Returns a structured object even if backend returns HTML or non-JSON.
 */
async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) {
    return {
      ok: false,
      status: 500,
      data: null,
      raw: "",
      error: "HUB_BACKEND_URL is not configured in environment.",
    };
  }

  const finalPayload = { ...(payload || {}) };

  // Normalize appId/appid
  if (!finalPayload.appId && !finalPayload.appid && HUB_APP_ID) {
    finalPayload.appId = HUB_APP_ID;
  }

  let res;
  let raw = "";
  try {
    res = await fetch(HUB_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalPayload),
    });
    raw = await res.text();
  } catch (err) {
    return {
      ok: false,
      status: 502,
      data: null,
      raw: "",
      error: `Failed to reach Apps Script: ${err?.message || String(err)}`,
    };
  }

  // Try parse JSON
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    // This is the #1 cause of "mystery 500" (Apps Script returns HTML login page)
    return {
      ok: false,
      status: 502,
      data: null,
      raw: raw?.slice(0, 800),
      error:
        `Apps Script returned non-JSON (HTTP ${res.status}). ` +
        `This usually means HUB_BACKEND_URL is not /exec or the WebApp is not public (Anyone).`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data,
      raw: raw?.slice(0, 800),
      error: (data && (data.error || data.message)) || "Apps Script error",
    };
  }

  return { ok: true, status: 200, data, raw: raw?.slice(0, 800), error: "" };
}

async function sendGreenApiOtp({ chatId, message }) {
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    return {
      ok: false,
      error:
        "Green API env vars missing (GREEN_API_INSTANCE_ID / GREEN_API_TOKEN).",
    };
  }

  const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

  const payload = {
    chatId,
    message,
  };

  let res;
  let raw = "";
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    raw = await res.text();
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `Green API failed (HTTP ${res.status}): ${raw?.slice(0, 500)}`,
    };
  }

  // Green API returns JSON; but we don't need its exact structure to proceed
  return { ok: true };
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
    json(res, 405, errorJson("Method not allowed. Use GET or POST.", 405));
    return;
  }

  // Build payload from request
  const payload =
    req.method === "GET"
      ? { ...(req.query || {}) }
      : typeof req.body === "object" && req.body !== null
      ? req.body
      : {};

  const action = String(payload.action || "").trim();

  // Local health (fast)
  if (action === "health") {
    json(
      res,
      200,
      okJson({
        ok: true,
        service: "NahlHub",
        info: "Hub backend is running.",
        hasGreenApi: !!(GREEN_API_INSTANCE_ID && GREEN_API_TOKEN),
        hasBackendUrl: !!HUB_BACKEND_URL,
      })
    );
    return;
  }

  if (!action) {
    json(res, 400, errorJson("Missing action parameter", 400));
    return;
  }

  try {
    // Debug raw Apps Script response
    if (action === "debug.backend") {
      const r = await callHubBackend({ action: "health", appId: HUB_APP_ID });
      json(res, r.ok ? 200 : 502, {
        success: r.ok,
        backendOk: r.ok,
        backendStatus: r.status,
        backendData: r.data,
        backendRaw: r.raw,
        backendError: r.error,
        HUB_BACKEND_URL: HUB_BACKEND_URL ? mask(HUB_BACKEND_URL, 25, 10) : "",
      });
      return;
    }

    // ===============================================================
    // OTP Send handled in Vercel (Green API) + store in Apps Script
    // ===============================================================
    if (action === "sendOtp" || action === "auth.requestOtp") {
      const mobile = String(payload.mobile || "").trim();
      if (!mobile) {
        json(res, 400, errorJson("Mobile is required.", 400));
        return;
      }

      const chatId = normalizeSaudiMobileToChatId(mobile);
      if (!chatId) {
        json(res, 400, errorJson("Invalid mobile format.", 400));
        return;
      }

      const otp = generateOtp(OTP_LEN);
      const expiresAt = new Date(Date.now() + OTP_EXP_MINUTES * 60 * 1000);
      const expiresAtIso = expiresAt.toISOString();

      // Optional signature for integrity (server-side)
      const appId = String(payload.appId || payload.appid || HUB_APP_ID || "HUB");
      const sigBase = `${appId}|${mobile}|${otp}|${expiresAtIso}`;
      const otpSig = OTP_HMAC_SECRET ? hmacSha256(OTP_HMAC_SECRET, sigBase) : "";

      // Send WhatsApp message via Green API
      const msg =
        `رمز الدخول إلى NahlHub: ${otp}\n` +
        `صالحة لمدة ${OTP_EXP_MINUTES} دقائق.\n\n` +
        `NahlHub Login code: ${otp}\n` +
        `Valid for ${OTP_EXP_MINUTES} minutes.`;

      const wa = await sendGreenApiOtp({ chatId, message: msg });
      if (!wa.ok) {
        json(res, 502, errorJson("Failed to send WhatsApp OTP.", 502, { detail: wa.error }));
        return;
      }

      // Store OTP in Apps Script (otp.store)
      const store = await callHubBackend({
        action: "otp.store",
        appId,
        mobile,
        otp,
        expiresAt: expiresAtIso,
        otpSig, // optional
      });

      if (!store.ok) {
        json(
          res,
          502,
          errorJson("OTP sent, but failed to store OTP in backend.", 502, {
            backendStatus: store.status,
            backendError: store.error,
            backendRaw: store.raw,
            backendData: store.data,
          })
        );
        return;
      }

      json(res, 200, okJson({ message: "OTP sent.", expiresAt: expiresAtIso }));
      return;
    }

    // ===============================================================
    // Everything else → forward to Apps Script
    // ===============================================================
    const backend = await callHubBackend(payload);

    if (!backend.ok) {
      json(
        res,
        backend.status >= 400 && backend.status <= 599 ? backend.status : 502,
        errorJson(backend.error || "Backend error", 502, {
          backendStatus: backend.status,
          backendRaw: backend.raw,
          backendData: backend.data,
          hint:
            "If backendRaw looks like HTML, your Apps Script WebApp is not public or HUB_BACKEND_URL is not /exec.",
        })
      );
      return;
    }

    json(res, 200, backend.data);
  } catch (err) {
    console.error("❌ /api/hub/manage fatal error:", err);
    json(res, 500, errorJson(err?.message || "Unexpected server error", 500));
  }
}
