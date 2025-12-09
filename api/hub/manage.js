// api/hub/manage.js
//
// Proxy between NahlHub frontend and Google Apps Script backend.
// - Expects NAHL_HUB_GAS_URL in environment variables.
// - Forwards POST JSON body to GAS as JSON.
// - Forwards GET query params to GAS.
// - Ensures both appId and appid are present for compatibility.
//

const GAS_URL = process.env.NAHL_HUB_GAS_URL;

export default async function handler(req, res) {
  // Basic config check
  if (!GAS_URL) {
    console.error("❌ NAHL_HUB_GAS_URL env variable is not set.");
    return res.status(500).json({
      success: false,
      error: "Server configuration error: NAHL_HUB_GAS_URL not configured",
    });
  }

  // Allow only GET / POST (and OPTIONS for safety)
  if (req.method === "OPTIONS") {
    // Minimal CORS support if needed
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed`,
    });
  }

  try {
    if (req.method === "POST") {
      // Next.js already parses JSON into req.body
      const payload = (req.body && typeof req.body === "object") ? req.body : {};

      // Ensure action exists (frontend should always send it)
      const action = (payload.action || "").trim();
      if (!action) {
        return res.status(400).json({
          success: false,
          error: "Missing action in request body",
        });
      }

      // For compatibility with Apps Script handler using appId/appid
      if (payload.appId && !payload.appid) {
        payload.appid = payload.appId;
      }

      console.log("➡️ Forwarding POST to GAS:", {
        url: GAS_URL,
        action,
      });

      const gasRes = await fetch(GAS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await gasRes.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error("❌ GAS returned non-JSON response:", text);
        return res.status(500).json({
          success: false,
          error: "Backend did not return valid JSON",
          raw: text,
        });
      }

      // If GAS responded with an error HTTP code, surface it but still send JSON body.
      if (!gasRes.ok) {
        console.error("❌ GAS error status:", gasRes.status, data);
        return res.status(500).json({
          success: false,
          error: data.error || `Apps Script error (HTTP ${gasRes.status})`,
          detail: data,
        });
      }

      console.log("✅ GAS response:", data);
      return res.status(200).json(data);
    }

    // ---------------------- GET (e.g., health) ----------------------
    if (req.method === "GET") {
      const url = new URL(GAS_URL);

      // Forward query params to GAS
      Object.entries(req.query || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key, v));
        } else if (value !== undefined) {
          url.searchParams.append(key, value);
        }
      });

      console.log("➡️ Forwarding GET to GAS:", url.toString());

      const gasRes = await fetch(url.toString(), {
        method: "GET",
      });

      const text = await gasRes.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error("❌ GAS returned non-JSON response (GET):", text);
        return res.status(500).json({
          success: false,
          error: "Backend did not return valid JSON (GET)",
          raw: text,
        });
      }

      if (!gasRes.ok) {
        console.error("❌ GAS error status (GET):", gasRes.status, data);
        return res.status(500).json({
          success: false,
          error: data.error || `Apps Script error (HTTP ${gasRes.status})`,
          detail: data,
        });
      }

      console.log("✅ GAS GET response:", data);
      return res.status(200).json(data);
    }
  } catch (err) {
    console.error("❌ Unexpected error in /api/hub/manage:", err);
    return res.status(500).json({
      success: false,
      error: err?.message || String(err),
    });
  }
}
