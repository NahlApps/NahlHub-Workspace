// pages/api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy (Hardened)
// ==================================================================
// Forwards actions to Apps Script (HUB_BACKEND_URL).
// Adds better JSON parsing + clearer errors + session requirement for protected actions.

import { mustGetEnv } from "../../../lib/env";
import { postJson } from "../../../lib/http";

const HUB_BACKEND_URL = mustGetEnv("HUB_BACKEND_URL");
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

function errorJson(message, statusCode = 500, extra = {}) {
  return {
    success: false,
    statusCode,
    error: message,
    ...extra,
  };
}

function normalizeAction(actionRaw) {
  return String(actionRaw || "").trim();
}

// Protected actions (Milestone 2)
function isProtectedAction(action) {
  if (!action) return false;
  if (action === "health") return false;
  if (action === "verifyOtp" || action === "auth.verifyOtp") return false;
  if (action === "otp.store" || action === "otp.fail") return false;
  return true;
}

/**
 * Call Apps Script backend (JSON POST).
 * Automatically injects default appId if missing.
 */
async function callHubBackend(payload) {
  const finalPayload = { ...(payload || {}) };

  // Normalize appId / appid
  if (!finalPayload.appId && !finalPayload.appid && HUB_APP_ID) {
    finalPayload.appId = HUB_APP_ID;
  }

  const data = await postJson(HUB_BACKEND_URL, finalPayload, { timeoutMs: 15000 });
  return data;
}

export default async function handler(req, res) {
  // Basic CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

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

    const action = normalizeAction(payload.action);

    if (!action) {
      res.status(400).json(errorJson("Missing action parameter", 400));
      return;
    }

    // pre-validation
    if ((action === "sendOtp" || action === "auth.requestOtp") && !String(payload.mobile || "").trim()) {
      res.status(400).json(errorJson("Mobile is required.", 400));
      return;
    }

    if (isProtectedAction(action)) {
      const sessionKey = String(payload.sessionKey || "").trim();
      if (!sessionKey) {
        res.status(401).json(errorJson("Missing sessionKey for protected action.", 401));
        return;
      }
    }

    const backendResponse = await callHubBackend(payload);
    res.status(200).json(backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);
    res.status(500).json(errorJson(err?.message || "Unexpected server error", 500));
  }
}
