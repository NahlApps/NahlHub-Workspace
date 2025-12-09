// pages/api/hub/manage.js

// ✅ Vercel / Next.js API route that proxies to Google Apps Script (NahlHub backend)

const APPS_SCRIPT_URL = process.env.NAHLHUB_APPS_SCRIPT_URL;

/**
 * Helper: build the Apps Script URL with original query params.
 */
function buildAppsScriptUrl(query) {
  if (!APPS_SCRIPT_URL) {
    throw new Error("Missing NAHLHUB_APPS_SCRIPT_URL env variable.");
  }

  const url = new URL(APPS_SCRIPT_URL);

  // Copy all query params from the incoming request
  if (query) {
    Object.keys(query).forEach((key) => {
      const value = query[key];
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, v));
      } else if (value !== undefined) {
        url.searchParams.append(key, value);
      }
    });
  }

  // For generic GET calls with no `action`, we can default (not really used for hub, but safe)
  if (!url.searchParams.has("action") && (query && Object.keys(query).length)) {
    url.searchParams.set("action", "list");
  }

  return url.toString();
}

/**
 * Helper: forward request to Apps Script and normalize to JSON.
 */
async function forwardToAppsScript(method, query, body) {
  const targetUrl = buildAppsScriptUrl(query);

  const fetchOptions = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (method === "POST") {
    // Ensure we send JSON string body
    fetchOptions.body = JSON.stringify(body || {});
  }

  const resp = await fetch(targetUrl, fetchOptions);

  const rawText = await resp.text();

  // Try to parse JSON; if fails, wrap it in a JSON error envelope
  try {
    const data = JSON.parse(rawText);
    return {
      ok: resp.ok,
      status: resp.status,
      data,
    };
  } catch (err) {
    console.error("❌ Apps Script did not return valid JSON", {
      status: resp.status,
      rawSnippet: rawText.slice(0, 500),
    });

    return {
      ok: false,
      status: 500,
      data: {
        success: false,
        error: "Invalid JSON from Apps Script backend.",
        statusCodeFromAppsScript: resp.status,
        rawBodySnippet: rawText.slice(0, 500),
      },
    };
  }
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  try {
    if (!APPS_SCRIPT_URL) {
      console.error("❌ NAHLHUB_APPS_SCRIPT_URL is not set.");
      return res.status(500).json({
        success: false,
        error:
          "Server misconfigured: NAHLHUB_APPS_SCRIPT_URL env variable is not set.",
      });
    }

    const method = req.method || "GET";

    if (method !== "GET" && method !== "POST") {
      return res
        .status(405)
        .json({ success: false, error: "Method not allowed" });
    }

    const query = req.query || {};
    const body = method === "POST" ? req.body || {} : null;

    const result = await forwardToAppsScript(method, query, body);

    // Always respond with JSON
    return res.status(result.status || 200).json(result.data);
  } catch (err) {
    console.error("❌ Error in /api/hub/manage:", err);
    return res.status(500).json({
      success: false,
      error: "Unexpected error in hub API.",
      details: err.message || String(err),
    });
  }
}

// Optional: keep default body parsing (JSON) enabled
export const config = {
  api: {
    bodyParser: true,
  },
};
