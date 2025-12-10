// api/hub/manage.js
//
// NahlHub Workspace → Google Apps Script Hub Backend Proxy
// --------------------------------------------------------
// This API route runs on Vercel/Next.js and forwards requests
// from the frontend (index.html) to the Apps Script Web App.
//
// Configure your Apps Script Web App URL in an env variable:
//   - NEXT_PUBLIC_NAHL_HUB_BACKEND_URL  (preferred, works on client too)
//   - or NAHL_HUB_BACKEND_URL           (server only)
//
// Example:
//   NEXT_PUBLIC_NAHL_HUB_BACKEND_URL="https://script.google.com/macros/s/AKfycbxxxxxxx/exec"
//
// Frontend usage (POST):
//   postJson('/api/hub/manage', { action: 'auth.requestOtp', mobile: '05xxxxxxxx' })
//
// Apps Script (Code.gs) expects:
//   - action (string, required for all calls)
//   - other fields depending on action

const BACKEND_URL =
  process.env.NEXT_PUBLIC_NAHL_HUB_BACKEND_URL ||
  process.env.NAHL_HUB_BACKEND_URL ||
  ''; // fallback empty → handled below

/**
 * Helper: try to parse JSON safely, otherwise wrap raw text.
 */
async function parseBackendResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return {
      success: false,
      error: 'Backend returned non-JSON response',
      raw: text,
    };
  }
}

export default async function handler(req, res) {
  // 1) Ensure backend URL is configured
  if (!BACKEND_URL) {
    return res.status(500).json({
      success: false,
      error:
        'Hub backend URL not configured. Set NEXT_PUBLIC_NAHL_HUB_BACKEND_URL or NAHL_HUB_BACKEND_URL in environment variables.',
    });
  }

  // 2) Only allow GET & POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed`,
    });
  }

  try {
    if (req.method === 'GET') {
      // ----------------------------------------------------
      // GET → forward query params as-is to Apps Script
      // Example: /api/hub/manage?action=health
      // ----------------------------------------------------
      const queryString = new URLSearchParams(req.query).toString();
      const url =
        BACKEND_URL + (queryString ? `?${queryString}` : '');

      const backendRes = await fetch(url, {
        method: 'GET',
      });

      const data = await parseBackendResponse(backendRes);
      const status = backendRes.ok ? 200 : backendRes.status;

      return res.status(status).json(data);
    }

    // ------------------------------------------------------
    // POST → forward JSON body as-is to Apps Script
    // This is critical to keep `action` at top-level.
    // ------------------------------------------------------
    const payload = req.body || {};

    // Optional: validate action on server before forwarding
    if (!payload.action) {
      // This catches missing action before hitting Apps Script
      return res.status(400).json({
        success: false,
        error: 'Missing action in request body',
      });
    }

    const backendRes = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await parseBackendResponse(backendRes);
    const status = backendRes.ok ? 200 : backendRes.status;

    return res.status(status).json(data);
  } catch (err) {
    console.error('❌ Error in /api/hub/manage:', err);
    return res.status(500).json({
      success: false,
      error: 'Proxy error while calling Hub backend: ' + String(err && err.message ? err.message : err),
    });
  }
}
