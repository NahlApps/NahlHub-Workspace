// api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy
// ==================================================================
// Actions used by frontend + backend (proxied to Apps Script):
//   - sendOtp                     (OTP created + sent by Apps Script)
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

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

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

/**
 * Call Apps Script backend (JSON POST).
 * Automatically injects default appId if missing.
 */
async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) {
    throw new Error("HUB_BACKEND_URL is not configured in environment.");
  }

  const finalPayload = { ...(payload || {}) };

  // Normalize appId / appid
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
  } catch (err) {
    throw new Error(
      `Apps Script returned non-JSON response (HTTP ${res.status}): ${text.slice(
        0,
        200
      )}`
    );
  }

  if (!res.ok) {
    const backendError =
      (data && (data.error || data.message)) || "Unknown Apps Script error";
    throw new Error(`Apps Script error (HTTP ${res.status}): ${backendError}`);
  }

  return data;
}

// ------------------------------------------------------------------
// Next.js API route handler
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
    res
      .status(405)
      .json(errorJson("Method not allowed. Use GET or POST.", 405));
    return;
  }

  try {
    // Build payload from request
    const payload =
      req.method === "GET"
        ? { ...(req.query || {}) }
        : typeof req.body === "object" && req.body !== null
        ? req.body
        : {};

    const actionRaw = payload.action;
    const action = (actionRaw || "").trim();

    if (!action) {
      res.status(400).json(errorJson("Missing action parameter", 400));
      return;
    }

    // Optional: light validation for some actions before hitting Apps Script
    if (
      action === "sendOtp" ||
      action === "auth.requestOtp"
    ) {
      const mobile = (payload.mobile || "").trim();
      if (!mobile) {
        res.status(400).json(errorJson("Mobile is required.", 400));
        return;
      }
    }

    // health check can either be handled locally or forwarded to Apps Script.
    // Here we just forward like any other action.
    const backendResponse = await callHubBackend(payload);
    res.status(200).json(backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);
    res
      .status(500)
      .json(errorJson(err.message || "Unexpected server error", 500));
  }
}
