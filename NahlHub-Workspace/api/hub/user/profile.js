// === api/hub/user/profile.js ===
// NahlHub – User Profile Management Endpoint

// Apps Script WebApp URL (POST endpoint)
const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(obj || {}));
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
    const { action, userId, name, email, sessionKey } = payload;

    if (!sessionKey) {
      return sendJson(res, 401, { success: false, error: "Session key is required." });
    }

    if (!userId) {
      return sendJson(res, 400, { success: false, error: "User ID is required." });
    }

    // Get profile
    if (action === "user.getProfile" || action === "getProfile") {
      const profileRes = await callHubBackend({
        action: "user.getProfile",
        userId: userId,
        sessionKey: sessionKey
      });

      if (!profileRes || !profileRes.success) {
        return sendJson(res, 500, {
          success: false,
          error: profileRes?.error || "Failed to load profile."
        });
      }

      return sendJson(res, 200, {
        success: true,
        user: profileRes.user || {}
      });
    }

    // Update profile
    if (action === "user.updateProfile" || action === "updateProfile") {
      // Validate input
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return sendJson(res, 400, { success: false, error: "Name is required." });
      }

      if (email && typeof email === "string" && email.trim().length > 0) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          return sendJson(res, 400, { success: false, error: "Invalid email address format." });
        }
      }

      const updateRes = await callHubBackend({
        action: "user.updateProfile",
        userId: userId,
        name: name.trim(),
        email: email && email.trim() ? email.trim() : null,
        sessionKey: sessionKey
      });

      if (!updateRes || !updateRes.success) {
        return sendJson(res, 500, {
          success: false,
          error: updateRes?.error || "Failed to update profile."
        });
      }

      return sendJson(res, 200, {
        success: true,
        user: updateRes.user || {},
        message: "Profile updated successfully."
      });
    }

    return sendJson(res, 400, { success: false, error: "Invalid action." });

  } catch (err) {
    return sendJson(res, 500, {
      success: false,
      error: err?.message || "Unexpected server error",
      stage: "api/hub/user/profile"
    });
  }
};

