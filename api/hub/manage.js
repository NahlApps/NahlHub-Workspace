// api/hub/manage.js
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

const crypto = require("crypto");

// Apps Script Web App URL (doPost endpoint)
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

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

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
  return d; // already "5XXXXXXXX" or other
}

/**
 * GreenAPI usually needs international chatId:
 * - local "5XXXXXXXX" => "9665XXXXXXXX@c.us"
 * - already "9665..." => "9665...@c.us"
 */
function toGreenChatId(mobileLocalOrIntl = "") {
  const d = String(mobileLocalOrIntl).trim().replace(/[^\d]/g, "");
  if (!d) return "";

  if (d.startsWith("966") && d.length === 12) return `${d}@c.us`;
  if (d.length === 9 && d.startsWith("5")) return `966${d}@c.us`;

  return `${d}@c.us`;
}

function generateOtp(len = 4) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/**
 * Read JSON body safely for Vercel Node function (raw stream).
 */
async function readBodyJson(req) {
  try {
    if (req.body && typeof req.body === "object") return req.body;

    let raw = "";
    await new Promise((resolve, reject) => {
      req.on("data", (c) => (raw += c));
      req.on("end", resolve);
      req.on("error", reject);
    });

    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
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
      `Apps Script returned HTML (HTTP ${res.status}). Ensure Web App access is set to "Anyone" and you are using the Web App URL.`
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

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  if (req.method !== "GET" && req.method !== "POST") {
    return sendJson(res, 405, errorJson("Method not allowed. Use GET or POST.", 405));
  }

  try {
    // GET payload from query string
    let payload = {};
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      payload = Object.fromEntries(url.searchParams.entries());
    } else {
      payload = await readBodyJson(req);
    }

    const action = String(payload.action || "").trim();
    if (!action) return sendJson(res, 400, errorJson("Missing action parameter", 400));

    // Local health
    if (action === "health") {
      return sendJson(res, 200, {
        success: true,
        ok: true,
        service: "NahlHub",
        appId: HUB_APP_ID || "HUB",
        hasBackendUrl: !!HUB_BACKEND_URL,
        hasGreenApi: !!(GREEN_API_INSTANCE_ID && GREEN_API_TOKEN),
        hasHmac: !!OTP_HMAC_SECRET,
        otpLength: OTP_LENGTH,
        otpTtlMin: OTP_TTL_MIN,
        time: new Date().toISOString(),
      });
    }

    // Local sendOtp
    if (action === "sendOtp" || action === "auth.requestOtp") {
      const mobileRaw = payload.mobile || "";
      const mobileLocal = normalizeMobileLocal(mobileRaw);

      if (!mobileLocal) {
        return sendJson(res, 400, errorJson("Mobile is required.", 400));
      }

      const appId = String(payload.appId || payload.appid || HUB_APP_ID || "HUB").trim();
      const otp = generateOtp(OTP_LENGTH);

      // WhatsApp uses intl
      const chatId = toGreenChatId(mobileLocal);
      const message = `رمز التحقق: ${otp}\nصالح لمدة ${OTP_TTL_MIN} دقائق.`;

      // Stage 1: GreenAPI send
      let green;
      try {
        green = await greenSendMessage(chatId, message);
      } catch (e) {
        return sendJson(
          res,
          500,
          errorJson(e?.message || "GreenAPI send failed", 500, {
            stage: "greenapi.send",
            chatId,
          })
        );
      }

      // Stage 2: Apps Script otp.store
      const ts = Date.now();
      const sig = signOtpStore({ appId, mobile: mobileLocal, otp, ts });

      try {
        await callHubBackend({
          action: "otp.store",
          appId,
          mobile: mobileLocal,
          otp,
          ts,
          sig,
        });
      } catch (e) {
        return sendJson(
          res,
          500,
          errorJson(e?.message || "Apps Script otp.store failed", 500, {
            stage: "backend.otp.store",
          })
        );
      }

      return sendJson(res, 200, {
        success: true,
        sent: true,
        idMessage: green?.idMessage || "",
      });
    }

    // Forward everything else to Apps Script
    try {
      const backendResponse = await callHubBackend(payload);
      return sendJson(res, 200, backendResponse);
    } catch (e) {
      return sendJson(
        res,
        500,
        errorJson(e?.message || "Apps Script call failed", 500, {
          stage: "backend.forward",
          action,
        })
      );
    }
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);
    return sendJson(res, 500, errorJson(err?.message || "Unexpected server error", 500));
  }
};
