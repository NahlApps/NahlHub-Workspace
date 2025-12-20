// api/hub/manage.js
// NahlHub – Vercel API → Apps Script proxy (improved)

const HUB_BACKEND_URL = process.env.HUB_BACKEND_URL;
const HUB_APP_ID = process.env.HUB_APP_ID || "HUB";

function errorJson(message, statusCode = 500, extra = {}) {
  return {
    success: false,
    statusCode,
    error: message,
    ...extra,
  };
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function callHubBackend(payload) {
  if (!HUB_BACKEND_URL) {
    const err = new Error("HUB_BACKEND_URL is not configured in Vercel env.");
    err.statusCode = 500;
    throw err;
  }

  const finalPayload = { ...(payload || {}) };
  if (!finalPayload.appId && !finalPayload.appid && HUB_APP_ID) {
    finalPayload.appId = HUB_APP_ID;
  }

  // Timeout
  const controller = new AbortController();
  const timeoutMs = 20000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(HUB_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalPayload),
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(
      e?.name === "AbortError"
        ? `Backend request timed out after ${timeoutMs}ms`
        : `Failed to reach Apps Script backend: ${e?.message || e}`
    );
    err.statusCode = 502;
    throw err;
  } finally {
    clearTimeout(t);
  }

  const raw = await safeReadText(res);

  // Try JSON parse
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    // Non-JSON response (common when Apps Script returns an HTML login page)
    const err = new Error(
      `Apps Script returned non-JSON (HTTP ${res.status}). First 200 chars: ${raw.slice(
        0,
        200
      )}`
    );
    err.statusCode = 502;
    err.backendStatus = res.status;
    throw err;
  }

  // If Apps Script responded with non-2xx, surface it
  if (!res.ok) {
    const backendMsg = data?.error || data?.message || "Unknown Apps Script error";
    const err = new Error(`Apps Script error (HTTP ${res.status}): ${backendMsg}`);
    err.statusCode = 502;
    err.backendStatus = res.status;
    err.backendData = data;
    throw err;
  }

  return data;
}

export default async function handler(req, res) {
  // Same-origin on Vercel usually doesn't need CORS, but keeping it doesn't hurt.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json(errorJson("Method not allowed. Use GET or POST.", 405));
  }

  try {
    const payload =
      req.method === "GET"
        ? { ...(req.query || {}) }
        : typeof req.body === "object" && req.body !== null
        ? req.body
        : {};

    const action = String(payload.action || "").trim();
    if (!action) return res.status(400).json(errorJson("Missing action parameter", 400));

    const backendResponse = await callHubBackend(payload);
    return res.status(200).json(backendResponse);
  } catch (err) {
    console.error("❌ /api/hub/manage error:", err);

    const status = err.statusCode || 500;
    return res.status(status).json(
      errorJson(err.message || "Unexpected server error", status, {
        backendStatus: err.backendStatus,
        backendData: err.backendData,
      })
    );
  }
}
