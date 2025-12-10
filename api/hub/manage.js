// pages/api/hub/manage.js
// NahlHub – Hub API Proxy (Vercel → Apps Script + GreenAPI)
// ---------------------------------------------------------

const BACKEND_URL = process.env.NAHL_HUB_BACKEND_URL; // Apps Script Web App /exec URL
const HUB_APP_ID  = process.env.NAHL_HUB_APP_ID || ''; // Static hub AppId (e.g. USR-0001)

// Green API (WhatsApp) – used for sending OTP via WhatsApp
const GREEN_INSTANCE_ID = process.env.GREENAPI_INSTANCE_ID || '';
const GREEN_API_TOKEN   = process.env.GREENAPI_API_TOKEN || '';
const GREEN_SENDER      = process.env.GREENAPI_SENDER || ''; // optional, for reference only

/**
 * Helper: send JSON response
 */
function sendJson(res, status, payload) {
  res.status(status).json(payload || {});
}

/**
 * Helper: call Apps Script backend (POST JSON)
 */
async function callBackendPost(payload) {
  if (!BACKEND_URL) {
    throw new Error('NAHL_HUB_BACKEND_URL is not configured in environment.');
  }

  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });

  let data;
  try {
    data = await response.json();
  } catch (err) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Backend did not return valid JSON. Status=${response.status}, body=${text}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Backend returned HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

/**
 * Helper: call Apps Script backend (GET with query string)
 */
async function callBackendGet(params) {
  if (!BACKEND_URL) {
    throw new Error('NAHL_HUB_BACKEND_URL is not configured in environment.');
  }

  const url = new URL(BACKEND_URL);
  Object.keys(params || {}).forEach((k) => {
    if (params[k] !== undefined && params[k] !== null) {
      url.searchParams.set(k, String(params[k]));
    }
  });

  const response = await fetch(url.toString(), { method: 'GET' });

  let data;
  try {
    data = await response.json();
  } catch (err) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Backend did not return valid JSON (GET). Status=${response.status}, body=${text}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Backend returned HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

/**
 * Helper: send OTP via Green API WhatsApp
 */
async function sendOtpViaGreenApi(mobile, otp) {
  // If env vars are not set, just skip sending (no crash)
  if (!GREEN_INSTANCE_ID || !GREEN_API_TOKEN) {
    return {
      sent: false,
      reason: 'Missing GREENAPI_INSTANCE_ID or GREENAPI_API_TOKEN'
    };
  }

  if (!mobile || !otp) {
    return {
      sent: false,
      reason: 'Missing mobile or OTP for WhatsApp send'
    };
  }

  // Green API expects chatId in format: 9665XXXXXXX@c.us (no +)
  // NOTE: We assume the mobile already includes country code (e.g. 9665XXXXXXXX)
  const chatId = `${mobile.replace(/\D/g, '')}@c.us`;

  const apiUrl = `https://api.green-api.com/waInstance${GREEN_INSTANCE_ID}/SendMessage/${GREEN_API_TOKEN}`;

  const message = `رمز الدخول الخاص بك هو: ${otp}\nYour NahlHub login code is: ${otp}`;

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message })
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return {
        sent: false,
        reason: `GreenAPI HTTP ${resp.status}`,
        raw: data
      };
    }

    return {
      sent: true,
      raw: data
    };
  } catch (err) {
    return {
      sent: false,
      reason: 'Network / fetch error',
      error: String(err && err.message ? err.message : err)
    };
  }
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Basic sanity check
  if (!BACKEND_URL) {
    return sendJson(res, 500, {
      success: false,
      error:
        'NAHL_HUB_BACKEND_URL is not set. Configure it in Vercel Environment Variables.'
    });
  }

  try {
    const method = req.method || 'GET';

    if (method === 'GET') {
      // Health check or other GET actions
      const { action = 'health', appId, appid, ...rest } = req.query || {};

      const effectiveAppId =
        HUB_APP_ID || appId || appid || ''; // falls back to env AppId

      const params = {
        action,
        appId: effectiveAppId,
        ...rest
      };

      const result = await callBackendGet(params);
      return sendJson(res, 200, result);
    }

    if (method === 'POST') {
      let payload = req.body || {};

      // Next.js can give body as string in some configs
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (err) {
          return sendJson(res, 400, {
            success: false,
            error: 'Invalid JSON in request body'
          });
        }
      }

      const action = (payload.action || '').trim();
      if (!action) {
        return sendJson(res, 400, {
          success: false,
          error: 'Missing action parameter'
        });
      }

      // Ensure we always send appId to Apps Script
      const effectiveAppId =
        HUB_APP_ID || payload.appId || payload.appid || '';

      const backendPayload = {
        ...payload,
        appId: effectiveAppId
      };

      // Call Apps Script
      const backendResult = await callBackendPost(backendPayload);

      // Special handling for sendOtp: forward OTP through WhatsApp (GreenAPI)
      if (action === 'sendOtp') {
        // If Apps Script failed, return as is
        if (!backendResult || !backendResult.success) {
          return sendJson(res, 200, backendResult || {
            success: false,
            error: 'Unknown error from backend on sendOtp'
          });
        }

        const mobile = (payload.mobile || '').toString().trim();
        const otp =
          backendResult.otp ||
          backendResult.debugOtp ||
          backendResult.code ||
          '';

        const waResult = await sendOtpViaGreenApi(mobile, otp);

        // Attach WhatsApp sending status to response
        const merged = {
          ...backendResult,
          whatsapp: waResult
        };

        return sendJson(res, 200, merged);
      }

      // All other actions: just pass through
      return sendJson(res, 200, backendResult);
    }

    // Unsupported method
    return sendJson(res, 405, {
      success: false,
      error: `Method ${req.method} not allowed`
    });
  } catch (err) {
    console.error('❌ Error in /api/hub/manage:', err);
    return sendJson(res, 500, {
      success: false,
      error:
        err && err.message
          ? `Proxy error: ${err.message}`
          : 'Unknown proxy error'
    });
  }
}
