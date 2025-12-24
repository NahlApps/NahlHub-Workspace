// lib/otp.js
// OTP generator + HMAC hashing + signature

import crypto from "crypto";

export function generateOtp(length = 4) {
  const n = Math.max(4, Number(length || 4));
  let out = "";
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10);
  return out.slice(0, n);
}

export function normalizeKsaMobile(input) {
  // returns "9665xxxxxxxx" or null
  const d = String(input || "").replace(/[^\d]/g, "");
  if (!d) return null;

  // common forms:
  // 5xxxxxxxx (9 digits)
  // 05xxxxxxxx (10 digits)
  // 9665xxxxxxxx (12 digits)
  // +9665xxxxxxxx

  if (d.length === 9 && d.startsWith("5")) return `966${d}`;
  if (d.length === 10 && d.startsWith("05")) return `966${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("9665")) return d;

  return null;
}

export function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashOtp({ appId, mobile, otp, secret }) {
  // HMAC-SHA256 for OTP hash
  const base = `${appId}|${mobile}|${otp}`;
  return crypto.createHmac("sha256", secret).update(base).digest("hex");
}

export function signPayload({ payload, secret }) {
  // Do not include `sig` itself when signing
  const copy = { ...(payload || {}) };
  delete copy.sig;

  const canonical = stableStringify(copy);
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}
