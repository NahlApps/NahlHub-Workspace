// api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy
// ==================================================================
// Actions used by frontend + backend (proxied to Apps Script):
//   - sendOtp                     (OTP created + sent by Apps Script via Green API)
//   - verifyOtp                   (OTP verification + session creation)
//   - auth.me                     (session check)
//   - auth.logout                 (session logout)
//   - workspace.create            (create workspace)
//   - workspace.listForUser       (list workspaces for a user)
//   - workspace.members           (list members in a workspace)
//   - workspace.invite            (invite user by email)
//   - marketplace.listTemplates   (list templates for Marketplace)
//   - marketplace.installApp      (install app template)
//   - marketplace.installModule   (install module template)
//   - marketplace.install         (auto-detect app/module)
//   - marketplace.listWorkspaceApps (apps installed in workspace)
//   - health                      (backend healthcheck)

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL; // Apps Script Web App URL (exec)
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

// Optional hardening
const ALLOW_ORIGIN = process.env.HUB_ALLOW_ORIGIN || "*"; // set to your domain in prod
const REQUEST_TIMEOUT_MS = Number(process.env.HUB_REQUEST_TIMEOUT_MS || 20000);

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function errorJson(message, statusCode = 500, extra = {}) {
  return {
    success: false,
    statusCode,
    error: message,
    ...extra,
  };
}

function okJson(data = {}) {
  return {
    success: true,
    ...data,
  };
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
}

/**
 * Safe JSON parse (returns null if fails)
 */
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/**
 * Build payload from Next req
 */
function readPayload(req) {
  if (req.method === "GET") return { ...(req.query || {}) };
  if (typeof req.body === "object" && req.body !== null) return req.body;
  // Some clients send raw string body
  if (typeof req.body === "string" && req.body.trim()) {
    const parsed = tryParseJson(req.body);
    return parsed && typeof parsed === "object" ? parsed : {};
  }
  return {};
}

/**
 * Normalize & inject appId when missing
 */
function normalizePayload(payload) {
  const out = { ...(payload || {}) };

  // Normalize action
  if (typeof out.action === "string") out.action = out.action.trim();

  // Normalize appId/appid
  if (!out.appId && out.appid) out.appId = out.appid;
  if (!out.appId && HUB_APP_ID) out.appId = HUB_APP_ID;

  // Normalize sessionKey header -> payload fallback
  // (Frontend usually sends in JSON; this is for flexibility)
  return out;
}

/**
 * Basic light validation (optional) before calling Apps Script
 */
function validatePayload(payload) {
  const action = (payload.action || "").trim();
  if (!action) return "Missing action parameter";

  const needsMobile = action === "sendOtp" || action === "auth.requestOtp";
  if (needsMobile) {
    const mobile = String(payload.mobile || "").trim();
    if (!mobile) return "Mobile is required.";
  }

  // If you want to enforce appId always:
  if (!payload.appId) return "Missing appId/appid parameter";

  return null;
}

/**
 * Call Apps Script backend (JSON POST).
 * Uses AbortController for timeout.
 */
async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) {
    throw new Error("HUB_BACKEND_URL is not configured in environment.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(HUB_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });

    const text = await res.text();
    const data = tryParseJson(text);

    if (!data) {
      // Apps Script sometimes returns HTML on auth errors
      const snippet = text ? text.slice(0, 240) : "";
      throw new Error(
        `Apps Script returned non-JSON response (HTTP ${res.status}): ${snippet}`
      );
    }

    if (!res.ok) {
      const backendError = data.error || data.message || "Unknown Apps Script error";
      throw new Error(`Apps Script error (HTTP ${res.status}): ${backendError}`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------
// Next.js API route handler
// ------------------------------------------------------------------
export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // ✅ Friendly GET response (so opening URL in browser doesn’t look “broken”)
  if (req.method === "GET") {
    res.status(200).json(
      okJson({
        message:
          "NahlHub API is alive. Use POST with JSON body. Example: { action: 'health', appId: 'HUB' }",
        method: "GET",
      })
    );
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json(errorJson("Method not allowed. Use POST.", 405));
    return;
  }

  try {
    const rawPayload = readPayload(req);
    const payload = normalizePayload(rawPayload);

    const validationError = validatePayload(payload);
    if (validationError) {
      res.status(400).json(errorJson(validationError, 400));
      return;
    }

    // You can short-circuit health locally if you want (optional):
    // if (payload.action === "health") {
    //   res.status(200).json(okJson({ message: "OK (local)", ts: new Date().toISOString() }));
    //   return;
    // }

    const backendResponse = await callHubBackend(payload);
    res.status(200).json(backendResponse);
  } catch (err) {
    const msg = err?.name === "AbortError"
      ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms`
      : (err?.message || "Unexpected server error");

    console.error("❌ /api/hub/manage error:", err);

    // 502 is more accurate if upstream (Apps Script) failed
    const status = msg.includes("Apps Script") || msg.includes("non-JSON") ? 502 : 500;

    res.status(status).json(
      errorJson(msg, status, {
        upstream: "Apps Script",
      })
    );
  }
}
