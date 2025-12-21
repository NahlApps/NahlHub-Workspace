// api/hub/manage.js
module.exports = async (req, res) => {
  // --- CORS (safe default) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  // --- Helpers ---
  const sendJson = (status, obj) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
  };

  const readBodyJson = async () => {
    try {
      if (req.body && typeof req.body === "object") return req.body;
      let raw = "";
      await new Promise((resolve, reject) => {
        req.on("data", (c) => (raw += c));
        req.on("end", resolve);
        req.on("error", reject);
      });
      if (!raw) return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };

  // --- Parse action (GET query or POST body) ---
  const url = new URL(req.url, "http://localhost");
  const queryAction = url.searchParams.get("action") || "";
  const body = req.method === "POST" ? await readBodyJson() : {};
  const bodyAction = (body && body.action) || "";

  const action = (bodyAction || queryAction || "").trim();

  // ✅ Health always works
  if (action === "health") {
    return sendJson(200, {
      success: true,
      ok: true,
      action: "health",
      time: new Date().toISOString()
    });
  }

  // ✅ Debug echo so you can see requests reaching the function
  return sendJson(200, {
    success: false,
    error: "NO_ACTION_OR_NOT_IMPLEMENTED",
    hint: "Send {action:'health'} or implement your actions router here.",
    debug: {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      actionDetected: action,
      body
    }
  });
};
