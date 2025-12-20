/**
 * /api/hub/manage.js
 * ------------------------------------------------------------
 * Next.js (pages/api) API Route for NahlHub Hub.
 *
 * ✅ What this file does:
 * - Accepts POST JSON { action, ...payload }
 * - Validates appId (optional but recommended)
 * - Adds requestId for tracing
 * - Handles CORS + OPTIONS
 * - Proxies the request to Google Apps Script WebApp (Hub Backend) if configured
 * - Provides a MOCK mode for local/dev
 * - Returns consistent JSON: { success: boolean, ... }
 *
 * ------------------------------------------------------------
 * Required ENV (recommended):
 * - HUB_APP_ID                 e.g. "HUB"  (optional, but used to validate appId)
 * - HUB_GAS_WEBAPP_URL         Google Apps Script Web App URL (doPost endpoint)
 *
 * Optional ENV:
 * - HUB_API_KEY                If set, client must send header: x-api-key
 * - HUB_ALLOWED_ORIGINS        Comma-separated list for CORS, e.g. "https://x.com,https://y.com"
 * - HUB_TIMEOUT_MS             Default 15000
 * - HUB_MOCK                   "true" to enable mock backend (no GAS required)
 *
 * Notes:
 * - If your GAS action "sendOtp" fails due to UrlFetchApp permissions, that is inside GAS.
 *   This route will still surface the exact error text to the frontend (no more silent 500/502).
 */

function asBool(v) {
  return String(v || "").toLowerCase() === "true";
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function buildCors(req) {
  const allowed = String(process.env.HUB_ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const origin = req.headers.origin || "";
  const allowOrigin =
    !allowed.length ? "*" : (allowed.includes(origin) ? origin : allowed[0]);

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    "Access-Control-Max-Age": "86400",
  };
}

function withCors(res, headers) {
  Object.keys(headers || {}).forEach((k) => res.setHeader(k, headers[k]));
}

function genRequestId() {
  // short, unique-enough for logs
  return "hub_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
}

async function readJsonBody(req) {
  // Next.js usually parses JSON automatically when Content-Type is application/json
  // But we keep this robust in case body arrives as string.
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    const parsed = safeJsonParse(req.body);
    if (parsed) return parsed;
  }

  // fallback: manually read stream
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = safeJsonParse(raw);
  if (!parsed) throw new Error("Invalid JSON body");
  return parsed;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Proxy call to GAS WebApp
 */
async function callGas(gasUrl, payload, timeoutMs) {
  const res = await fetchWithTimeout(
    gasUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );

  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      (text ? text.slice(0, 500) : "") ||
      `GAS HTTP ${res.status}`;
    const err = new Error(msg);
    err.statusCode = 502; // upstream failure -> bad gateway
    err.upstreamStatus = res.status;
    err.upstreamBody = text;
    throw err;
  }

  if (!data) {
    const err = new Error("Invalid JSON from GAS: " + (text || "").slice(0, 500));
    err.statusCode = 502;
    err.upstreamStatus = res.status;
    err.upstreamBody = text;
    throw err;
  }

  return data;
}

/**
 * MOCK backend (for dev/testing when GAS not configured).
 * Only implements minimal OTP flow and a tiny workspace/apps stub.
 */
const mockDb = global.__NAHLHUB_MOCK_DB__ || (global.__NAHLHUB_MOCK_DB__ = {
  otpByMobile: new Map(), // mobile -> { otp, exp }
  sessions: new Map(), // sessionKey -> user
  usersByMobile: new Map([
    // add your test users here
    ["500000000", { userId: "U1", name: "Test User", mobile: "500000000" }],
  ]),
  workspacesByUser: new Map([
    ["U1", [{ workspaceId: "W1", name: "Workspace 1", slug: "ws-1", role: "admin", plan: "free" }]],
  ]),
  templates: [
    { templateId: "T1", nameAr: "تطبيق تجريبي", nameEn: "Demo App", category: "Tools", shortDescAr: "وصف", shortDescEn: "Desc", defaultRoute: "https://example.com", planRequired: "free", featureTags: "demo" }
  ],
  workspaceApps: new Map([
    ["W1", [{ workspaceAppId: "WA1", appId: "APP1", templateId: "T1", status: "active", visibleInHub: "true" }]]
  ]),
});

function randomOtp4() {
  const n = Math.floor(Math.random() * 9000) + 1000;
  return String(n);
}

async function handleMock(payload) {
  const action = payload.action;

  if (action === "sendOtp") {
    const mobile = String(payload.mobile || "").trim();
    const otp = randomOtp4();
    const exp = Date.now() + 5 * 60 * 1000;
    mockDb.otpByMobile.set(mobile, { otp, exp });
    return { success: true, otp, expiresInSec: 300, mock: true };
  }

  if (action === "verifyOtp") {
    const mobile = String(payload.mobile || "").trim();
    const otp = String(payload.otp || "").trim();
    const rec = mockDb.otpByMobile.get(mobile);
    if (!rec || rec.exp < Date.now() || rec.otp !== otp) {
      return { success: false, error: "Invalid or expired code.", mock: true };
    }
    const user = mockDb.usersByMobile.get(mobile);
    if (!user) {
      return { success: true, userExists: false, mock: true };
    }
    const sessionKey = "S_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
    mockDb.sessions.set(sessionKey, user);
    return { success: true, userExists: true, sessionKey, user, mock: true };
  }

  if (action === "auth.me") {
    const sessionKey = String(payload.sessionKey || "");
    const user = mockDb.sessions.get(sessionKey);
    if (!user) return { success: false, error: "Invalid session.", mock: true };
    return { success: true, user, mock: true };
  }

  if (action === "auth.logout") {
    const sessionKey = String(payload.sessionKey || "");
    mockDb.sessions.delete(sessionKey);
    return { success: true, mock: true };
  }

  if (action === "workspace.listForUser") {
    const userId = String(payload.userId || "");
    return { success: true, items: mockDb.workspacesByUser.get(userId) || [], mock: true };
  }

  if (action === "marketplace.listTemplates") {
    // mark installed for current workspace
    const workspaceId = String(payload.workspaceId || "");
    const installed = new Set((mockDb.workspaceApps.get(workspaceId) || []).map(x => x.templateId));
    const items = mockDb.templates.map(t => ({ ...t, installed: installed.has(t.templateId) }));
    return { success: true, items, mock: true };
  }

  if (action === "marketplace.listWorkspaceApps") {
    const workspaceId = String(payload.workspaceId || "");
    return { success: true, items: mockDb.workspaceApps.get(workspaceId) || [], mock: true };
  }

  if (action === "marketplace.installApp" || action === "marketplace.installModule") {
    const workspaceId = String(payload.workspaceId || "");
    const templateId = String(payload.templateId || "");
    const list = mockDb.workspaceApps.get(workspaceId) || [];
    if (!list.some(x => x.templateId === templateId)) {
      list.push({
        workspaceAppId: "WA_" + Date.now().toString(36),
        appId: "APP_" + templateId,
        templateId,
        status: "active",
        visibleInHub: "true",
      });
      mockDb.workspaceApps.set(workspaceId, list);
    }
    return { success: true, mock: true };
  }

  return { success: false, error: "Unknown action in MOCK mode: " + action, mock: true };
}

export default async function handler(req, res) {
  const cors = buildCors(req);
  withCors(res, cors);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
    return;
  }

  const requestId = genRequestId();
  const ip = getClientIp(req);

  // Optional API key protection
  const requiredKey = String(process.env.HUB_API_KEY || "");
  if (requiredKey) {
    const gotKey = String(req.headers["x-api-key"] || "");
    if (!gotKey || gotKey !== requiredKey) {
      res.status(401).json({ success: false, error: "Unauthorized (missing/invalid x-api-key).", requestId });
      return;
    }
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    res.status(400).json({ success: false, error: e.message || "Invalid JSON body.", requestId });
    return;
  }

  const action = String(body.action || "").trim();
  if (!action) {
    res.status(400).json({ success: false, error: "Missing 'action' in request body.", requestId });
    return;
  }

  // Optional appId validation (keeps your HUB isolated if you host multiple apps)
  const envAppId = String(process.env.HUB_APP_ID || "");
  const reqAppId = String(body.appId || body.appid || "").trim();
  if (envAppId && reqAppId && reqAppId !== envAppId) {
    res.status(403).json({ success: false, error: "Invalid appId.", requestId });
    return;
  }

  // Enrich payload for upstream / logs
  const payload = {
    ...body,
    requestId,
    meta: {
      ip,
      ua: String(req.headers["user-agent"] || ""),
      origin: String(req.headers.origin || ""),
      ts: new Date().toISOString(),
    },
  };

  const t0 = Date.now();

  try {
    const useMock = asBool(process.env.HUB_MOCK);
    if (useMock) {
      const data = await handleMock(payload);
      res.status(200).json({ ...data, requestId, ms: Date.now() - t0 });
      return;
    }

    const gasUrl = String(process.env.HUB_GAS_WEBAPP_URL || "").trim();
    if (!gasUrl) {
      res.status(500).json({
        success: false,
        error: "Missing HUB_GAS_WEBAPP_URL in environment.",
        requestId,
      });
      return;
    }

    const timeoutMs = Number(process.env.HUB_TIMEOUT_MS || 15000);
    const data = await callGas(gasUrl, payload, timeoutMs);

    // Always attach requestId + timing (helps debugging 500/502)
    res.status(200).json({ ...data, requestId, ms: Date.now() - t0 });
  } catch (err) {
    const status = Number(err.statusCode || 500);

    // Make upstream failures readable (no more blank 502)
    const message =
      (err && err.message) ||
      "Server error";

    // (Optional) improve one common Apps Script permission message clarity
    const hint =
      typeof message === "string" && message.includes("Required permissions") && message.includes("script.external_request")
        ? "GAS needs the scope: https://www.googleapis.com/auth/script.external_request (UrlFetchApp). Re-authorize the script owner, or move external calls to Vercel."
        : undefined;

    // Log server side
    console.error("[hub.manage]", {
      requestId,
      action,
      ip,
      status,
      message,
      upstreamStatus: err.upstreamStatus,
    });

    res.status(status).json({
      success: false,
      error: message,
      hint,
      requestId,
      ms: Date.now() - t0,
    });
  }
}
