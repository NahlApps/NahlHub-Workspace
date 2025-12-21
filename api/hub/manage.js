// api/hub/manage.js

export default async function handler(req, res) {
  // --- CORS (safe default) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const sendJson = (status, obj) => {
    res.status(status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
  };

  const readBodyJson = async () => {
    try {
      // Some runtimes may populate req.body
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

  // Vercel provides req.query in Node Functions
  const queryAction = (req.query && req.query.action) ? String(req.query.action) : "";

  const body = req.method === "POST" ? await readBodyJson() : {};
  const bodyAction = body && body.action ? String(body.action) : "";

  const action = (bodyAction || queryAction || "").trim();

  if (action === "health") {
    return sendJson(200, {
      success: true,
      ok: true,
      action: "health",
      time: new Date().toISOString(),
      runtime: "vercel-node-function",
      method: req.method,
      query: req.query || {}
    });
  }

  return sendJson(200, {
    success: false,
    error: "NO_ACTION_OR_NOT_IMPLEMENTED",
    hint: "Send ?action=health or {action:'health'}",
    debug: {
      method: req.method,
      url: req.url,
      query: req.query || {},
      actionDetected: action,
      body
    }
  });
}
