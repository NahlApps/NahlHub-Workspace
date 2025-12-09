// pages/api/hub/manage.js
// NahlHub – proxy between front-end and Apps Script backend

// 1) Set this env var in Vercel:
//    NAHL_HUB_BACKEND_URL = https://script.google.com/macros/s/XXXX/exec
//
// Or, during testing, you can hard-code it below instead of using env.

const GAS_WEBAPP_URL =
  process.env.NAHL_HUB_BACKEND_URL ||
  ''; // <== set this via env, or temporarily put your full /exec URL here.

export default async function handler(req, res) {
  // --- Basic CORS (so you can call from any origin, including local dev) ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ success: false, error: 'Only POST is allowed on this endpoint.' });
  }

  if (!GAS_WEBAPP_URL) {
    // This avoids a crash if env var is not set
    return res.status(500).json({
      success: false,
      error:
        'NAHL_HUB_BACKEND_URL is not configured. Set it to your Apps Script /exec URL in Vercel env.',
    });
  }

  try {
    // Forward JSON body to Apps Script
    const payload = req.body || {};

    const upstreamResponse = await fetch(GAS_WEBAPP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await upstreamResponse.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error('❌ Apps Script did NOT return valid JSON. Raw body:', text);
      data = {
        success: false,
        error: 'Upstream (Apps Script) did not return valid JSON.',
        raw: text,
      };
    }

    // If Apps Script itself returned 500, we propagate that,
    // but still respond with JSON so the front-end can show the error.
    return res
      .status(upstreamResponse.ok ? 200 : upstreamResponse.status)
      .json(data);
  } catch (err) {
    console.error('❌ Error in /api/hub/manage proxy:', err);
    return res.status(500).json({
      success: false,
      error: 'Proxy error calling Apps Script: ' + err.message,
    });
  }
}
