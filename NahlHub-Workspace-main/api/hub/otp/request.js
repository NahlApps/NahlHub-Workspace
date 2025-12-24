// pages/api/hub/otp/request.js
// OTP generation + WhatsApp send (Green API) + store OTP hash in Apps Script
// =======================================================================

import { mustGetEnv } from "../../../lib/env";
import { postJson } from "../../../lib/http";
import { generateOtp, hashOtp, signPayload, normalizeKsaMobile } from "../../../lib/otp";
import { sendOtpWhatsApp } from "../../../lib/greenapi";

const HUB_BACKEND_URL = mustGetEnv("HUB_BACKEND_URL");
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";
const OTP_HMAC_SECRET = mustGetEnv("OTP_HMAC_SECRET");

// Policy
const OTP_LENGTH = Number(process.env.OTP_LENGTH || 4);
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);

function errorJson(message, statusCode = 500, extra = {}) {
  return { success: false, statusCode, error: message, ...extra };
}

async function callAppsScript(payload) {
  return postJson(HUB_BACKEND_URL, payload, { timeoutMs: 15000 });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json(errorJson("Method not allowed. Use POST.", 405));
    return;
  }

  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};

    const appId = String(body.appId || body.appid || HUB_APP_ID).trim() || HUB_APP_ID;
    const mobileRaw = String(body.mobile || "").trim();
    if (!mobileRaw) {
      res.status(400).json(errorJson("Mobile is required.", 400));
      return;
    }

    const mobile = normalizeKsaMobile(mobileRaw); // "9665xxxxxxxx"
    if (!mobile) {
      res.status(400).json(errorJson("Invalid KSA mobile. Expected 5XXXXXXXX.", 400));
      return;
    }

    const otp = generateOtp(OTP_LENGTH);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    // Hash OTP for storage (do not store raw OTP)
    const otpHash = hashOtp({ appId, mobile, otp, secret: OTP_HMAC_SECRET });

    // Store OTP (pre-check inside Apps Script will enforce cooldown & spam protection)
    const ts = Date.now();
    const storePayloadNoSig = {
      action: "otp.store",
      appId,
      mobile,
      otpHash,
      expiresAt,
      ts,
      meta: {
        ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
        ua: req.headers["user-agent"] || ""
      }
    };

    const sig = signPayload({ payload: storePayloadNoSig, secret: OTP_HMAC_SECRET });
    const storeRes = await callAppsScript({ ...storePayloadNoSig, sig });

    if (!storeRes || !storeRes.success) {
      res.status(429).json(errorJson(storeRes?.error || "OTP cannot be issued now.", 429, storeRes || {}));
      return;
    }

    // Send via WhatsApp (Green API)
    const waText = `رمز الدخول: ${otp}\nNahlHub`;
    const waRes = await sendOtpWhatsApp({ ksaE164: mobile, text: waText });

    if (!waRes?.success) {
      // mark OTP as failed to prevent verify
      const failNoSig = { action: "otp.fail", appId, mobile, otpHash, ts: Date.now(), reason: waRes?.error || "WhatsApp send failed" };
      const failSig = signPayload({ payload: failNoSig, secret: OTP_HMAC_SECRET });
      await callAppsScript({ ...failNoSig, sig: failSig }).catch(() => {});
      res.status(500).json(errorJson(waRes?.error || "Failed to send WhatsApp OTP.", 500));
      return;
    }

    res.status(200).json({ success: true, cooldownSec: storeRes.cooldownSec || 30 });
  } catch (err) {
    console.error("❌ /api/hub/otp/request error:", err);
    res.status(500).json(errorJson(err?.message || "Unexpected server error", 500));
  }
}
