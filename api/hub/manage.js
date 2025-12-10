// api/hub/manage.js
// Vercel / Next.js API route to proxy requests to Google Apps Script backend

const SCRIPT_URL = process.env.NAHL_HUB_SCRIPT_URL; // Web App URL from Apps Script
const APP_ID = process.env.NAHL_HUB_APP_ID || "HUB";

export default async function handler(req, res) {
  try {
    // 1) تأكد من ضبط URL الخاص بـ Apps Script
    if (!SCRIPT_URL) {
      return res.status(500).json({
        success: false,
        error:
          "Missing NAHL_HUB_SCRIPT_URL environment variable. Set it in Vercel → Project → Settings → Environment Variables.",
      });
    }

    // 2) السماح فقط لـ GET و POST
    if (req.method !== "POST" && req.method !== "GET") {
      res.setHeader("Allow", ["GET", "POST"]);
      return res
        .status(405)
        .json({ success: false, error: "Method not allowed" });
    }

    // 3) قراءة الـ payload من الطلب
    let payload;
    if (req.method === "GET") {
      // من query string
      payload = { ...req.query };
    } else {
      // من body
      if (typeof req.body === "string") {
        try {
          payload = JSON.parse(req.body || "{}");
        } catch (err) {
          return res.status(400).json({
            success: false,
            error: "Invalid JSON body in request to /api/hub/manage",
          });
        }
      } else {
        payload = { ...req.body };
      }
    }

    const action = (payload.action || "").trim();
    if (!action) {
      return res
        .status(400)
        .json({ success: false, error: "Missing action in request payload" });
    }

    // 4) إضافة appId إذا مو موجود
    const forwardPayload = {
      ...payload,
      appId: payload.appId || payload.appid || APP_ID,
    };

    // 5) إرسال الطلب إلى Google Apps Script كـ JSON
    const gsResp = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(forwardPayload),
    });

    const text = await gsResp.text();

    // 6) حاول تحويل الرد إلى JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.error("Apps Script did not return valid JSON:", text);
      return res.status(500).json({
        success: false,
        error: "Apps Script did not return valid JSON",
        status: gsResp.status,
        rawBody: text.slice(0, 500),
      });
    }

    // 7) إذا Apps Script رجّع status مو OK
    if (!gsResp.ok) {
      return res.status(500).json({
        success: false,
        error: data.error || "Apps Script responded with non-200 status",
        status: gsResp.status,
        details: data,
      });
    }

    // 8) كل شيء تمام → رجّع الرد للفرونت
    return res.status(200).json(data);
  } catch (err) {
    console.error("❌ Error in /api/hub/manage:", err);
    return res.status(500).json({
      success: false,
      error: "Server error in /api/hub/manage",
      detail: String(err),
    });
  }
}
