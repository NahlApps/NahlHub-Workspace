// pages/api/hub/manage.js

// IMPORTANT:
// Set NAHL_HUB_APPS_SCRIPT_URL in your environment to the deployed
// Apps Script web-app /exec URL.

const SCRIPT_URL = process.env.NAHL_HUB_APPS_SCRIPT_URL;

export default async function handler(req, res) {
  if (!SCRIPT_URL) {
    return res.status(500).json({
      success: false,
      error: 'Missing env var NAHL_HUB_APPS_SCRIPT_URL'
    });
  }

  const method = req.method || 'GET';

  try {
    // Build target URL (include query params for GET)
    const url = new URL(SCRIPT_URL);

    if (method === 'GET') {
      Object.entries(req.query || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          // Take first value if array
          url.searchParams.set(key, value[0]);
        } else if (value != null) {
          url.searchParams.set(key, String(value));
        }
      });

      // If no action is provided in GET, you *could* default to health or list
      if (!url.searchParams.get('action')) {
        url.searchParams.set('action', 'health');
      }
    }

    const fetchOptions = {
      method,
      headers: {}
    };

    if (method === 'POST') {
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(req.body || {});
    }

    const backendRes = await fetch(url.toString(), fetchOptions);

    const text = await backendRes.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      console.error('❌ Invalid JSON from Apps Script. Raw response:', text);
      return res.status(502).json({
        success: false,
        error: 'Backend did not return valid JSON'
      });
    }

    // Always return JSON; if backend used non-2xx, mark as 500 here
    const status = backendRes.ok ? 200 : 500;
    return res.status(status).json(json);
  } catch (err) {
    console.error('❌ Error in /api/hub/manage proxy:', err);
    return res.status(500).json({
      success: false,
      error: 'Proxy error: ' + (err && err.message ? err.message : String(err))
    });
  }
}
