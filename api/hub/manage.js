// pages/api/hub/manage.js
//
// Proxy between frontend (Next.js / Vercel) and Google Apps Script WebApp.
//
// ENV VAR (in Vercel):
//   NAHL_HUB_WEBAPP_URL = https://script.google.com/macros/s/XXXX/exec
//
// Frontend usage:
//   POST /api/hub/manage  { action: 'auth.requestOtp', mobile: '9665...' }
//   POST /api/hub/manage  { action: 'auth.verifyOtp', mobile, otp }
//   POST /api/hub/manage  { action: 'auth.me', sessionKey }
//   POST /api/hub/manage  { action: 'auth.logout', sessionKey }
//
// Notes:
//   - For GET, if no "action" is provided, we add action=ping.
//   - For POST, we forward JSON body as-is to Apps Script doPost(e).
//   - If Apps Script returns non-JSON (e.g., HTML error page), we wrap it
//     in a JSON error so the frontend never sees raw HTML.

export default async function handler(req, res) {
  const scriptUrl = process.env.NAHL_HUB_WEBAPP_URL;

  if (!scriptUrl) {
    res.status(500).json({
      success: false,
      error:
        "NAHL_HUB_WEBAPP_URL is not configured in environment variables. Please set it to your Apps Script Web App /exec URL."
    });
    return;
  }

  try {
    const url = new URL(scriptUrl);

    // Copy query parameters from the incoming request
    const query = req.query || {};
    Object.keys(query).forEach((key) => {
      const value = query[key];
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, v));
      } else if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    // For GET requests, if no action is supplied, default to "ping"
    if (req.method === "GET" && !url.searchParams.get("action")) {
      url.searchParams.set("action", "ping");
    }

    const fetchOptions = {
      method: req.method,
      headers: {}
    };

    if (req.method !== "GET") {
      fetchOptions.headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(req.body || {});
    }

    const response = await fetch(url.toString(), fetchOptions);
    const text = await response.text();

    // Try to parse JSON from Apps Script.
    // If it fails, wrap it in a JSON error so frontend never sees raw HTML.
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      console.error("Apps Script returned non-JSON response:", text);

      res.status(502).json({
        success: false,
        error:
          "Invalid JSON returned from Apps Script (POST). Check Web App deployment & NAHL_HUB_WEBAPP_URL.",
        statusCodeFromAppsScript: response.status,
        raw: text
      });
      return;
    }

    // Forward status + parsed JSON
    res.status(response.status).json(json);
  } catch (err) {
    console.error("Error in /api/hub/manage:", err);
    res.status(500).json({
      success: false,
      error: "Proxy error: " + (err && err.message ? err.message : String(err))
    });
  }
}
