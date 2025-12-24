// === api/hub/auth/register.js ===
// NahlHub – User Registration Endpoint

const crypto = require("crypto");

// Apps Script WebApp URL (POST endpoint)
const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

// GreenAPI
const GREEN_API_URL = process.env.GREEN_API_URL || "https://api.green-api.com";
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

// HMAC secret (must match Apps Script Script Properties OTP_HMAC_SECRET)
const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET;

// OTP settings
const OTP_LENGTH = Number(process.env.OTP_LENGTH || 4);
const OTP_TTL_MIN = Number(process.env.OTP_TTL_MIN || 10);

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(obj || {}));
}

function normalizeMobileLocal(mobileRaw = "") {
  const d = String(mobileRaw).trim().replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.length === 12 && d.startsWith("966")) return d.slice(3); // 9665XXXXXXXX -> 5XXXXXXXX
  if (d.length === 10 && d.startsWith("0")) return d.slice(1);   // 05XXXXXXXX -> 5XXXXXXXX
  return d; // already local
}

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

function signOtpStore({ appId, mobile, otp, ts }) {
  if (!OTP_HMAC_SECRET) throw new Error("OTP_HMAC_SECRET is missing in Vercel env.");
  const msg = `${appId}|${mobile}|${otp}|${ts}`;
  return crypto.createHmac("sha256", OTP_HMAC_SECRET).update(msg).digest("hex");
}

async function readBodyJson(req) {
  try {
    if (req.body && typeof req.body === "object") return req.body;
    const raw = await new Promise((resolve, reject) => {
      let s = "";
      req.on("data", (c) => (s += c));
      req.on("end", () => resolve(s));
      req.on("error", reject);
    });
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function looksLikeHtml(text = "") {
  return /<!doctype|<html/i.test(String(text || ""));
}

async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) throw new Error("HUB_BACKEND_URL is not configured in Vercel env.");
  if (typeof fetch !== "function") {
    throw new Error("Global fetch() is not available. Ensure Vercel Node.js runtime is 18+.");
  }

  const finalPayload = { ...(payload || {}) };
  if (!finalPayload.appId && !finalPayload.appid && HUB_APP_ID) finalPayload.appId = HUB_APP_ID;

  const r = await fetch(HUB_BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(finalPayload)
  });

  const text = await r.text();

  if (looksLikeHtml(text)) {
    throw new Error(
      `Apps Script returned HTML (HTTP ${r.status}). Check Web App deployment: Execute as Me, Access: Anyone.`
    );
  }

  let data = {};
  try { data = JSON.parse(text || "{}"); } catch {
    throw new Error(`Apps Script returned non-JSON (HTTP ${r.status}): ${String(text).slice(0, 200)}`);
  }

  if (!r.ok || data.success === false) {
    throw new Error(data.error || data.message || `Apps Script HTTP ${r.status}`);
  }

  return data;
}

async function greenSendMessage(chatId, message) {
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    throw new Error("GREEN_API_INSTANCE_ID / GREEN_API_TOKEN are missing.");
  }
  if (typeof fetch !== "function") {
    throw new Error("Global fetch() is not available. Ensure Vercel Node.js runtime is 18+.");
  }

  const url = `${GREEN_API_URL}/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message })
  });

  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text || "{}"); } catch {
    throw new Error(`GreenAPI returned non-JSON (HTTP ${r.status}): ${String(text).slice(0, 200)}`);
  }

  if (!r.ok) {
    throw new Error(data.message || `GreenAPI HTTP ${r.status}`);
  }
  return data;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, error: "Method not allowed" });
  }

  try {
    const payload = await readBodyJson(req);
    const { name, email, mobile } = payload;

    // Validate input
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return sendJson(res, 400, { success: false, error: "Name is required." });
    }

    if (!mobile || typeof mobile !== "string" || mobile.trim().length === 0) {
      return sendJson(res, 400, { error: "Mobile number is required." });
    }

    const mobileLocal = normalizeMobileLocal(mobile);
    if (!mobileLocal || mobileLocal.length < 9) {
      return sendJson(res, 400, { success: false, error: "Invalid mobile number format." });
    }

    // Check if user already exists
    const checkUser = await callHubBackend({
      action: "user.getByMobile",
      mobile: mobileLocal
    });

    if (checkUser && checkUser.user && checkUser.user.userId) {
      return sendJson(res, 409, {
        success: false,
        error: "User with this mobile number already exists. Please login instead."
      });
    }

    // Create user in backend
    const createUserRes = await callHubBackend({
      action: "auth.register",
      name: name.trim(),
      email: email && email.trim() ? email.trim() : null,
      mobile: mobileLocal
    });

    if (!createUserRes || !createUserRes.success || !createUserRes.user) {
      return sendJson(res, 500, {
        success: false,
        error: createUserRes?.error || "Failed to create user account."
      });
    }

    // Send welcome OTP
    const appId = String(payload.appId || payload.appid || HUB_APP_ID || "HUB").trim();
    const otp = generateOtp(OTP_LENGTH);
    const chatId = toGreenChatId(mobileLocal);
    const message = `مرحباً ${name.trim()}!\nرمز التحقق: ${otp}\nصالح لمدة ${OTP_TTL_MIN} دقائق.`;

    // 1) WhatsApp send
    const green = await greenSendMessage(chatId, message);

    // 2) Store OTP in Apps Script (HMAC signed)
    const ts = Date.now();
    const sig = signOtpStore({ appId, mobile: mobileLocal, otp, ts });

    await callHubBackend({
      action: "otp.store",
      appId,
      mobile: mobileLocal,
      otp,
      ts,
      sig
    });

    return sendJson(res, 200, {
      success: true,
      user: createUserRes.user,
      otpSent: true,
      idMessage: green?.idMessage || "",
      message: "Account created successfully. Verification code sent via WhatsApp."
    });

  } catch (err) {
    return sendJson(res, 500, {
      success: false,
      error: err?.message || "Unexpected server error",
      stage: "api/hub/auth/register"
    });
  }
};

