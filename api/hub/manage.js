// pages/api/hub/manage.js

// ✅ Temporary mock backend for NahlHub
// This file is self-contained and does NOT call Google Apps Script.
// It is only for development / UI testing.

const MOCK_SESSION_KEY = "NH-MOCK-SESSION-12345";

// Fake user (you can adjust as you like)
const MOCK_USER = {
  userId: "USR-0001",
  mobile: "500000000",
  name: "ضيف نحل هب", // or "NahlHub Guest"
};

// Fake apps list (opened inside the iframe)
const MOCK_APPS = [
  {
    appId: "APP-NAHLTIME",
    appNameAr: "NahlTime – حجوزات الغسيل",
    appNameEn: "NahlTime – Car Wash Bookings",
    descriptionAr: "تطبيق لحجز مواعيد غسيل السيارة.",
    descriptionEn: "App to schedule car wash appointments.",
    category: "خدمات / Services",
    baseUrl: "https://nahl-time-pro.vercel.app",
    pinned: true,
  },
  {
    appId: "APP-LAUNDRY",
    appNameAr: "Laundry Basket – إدارة المغسلة",
    appNameEn: "Laundry Basket – Laundry Manager",
    descriptionAr: "متابعة الفواتير والرسائل للعملاء.",
    descriptionEn: "Track orders and send WhatsApp updates.",
    category: "إدارة / Management",
    baseUrl: "https://laundry-basket-portal.vercel.app",
    pinned: false,
  },
  {
    appId: "APP-DEMO",
    appNameAr: "تطبيق تجريبي",
    appNameEn: "Demo App",
    descriptionAr: "تطبيق تجريبي مرتبط بنحل هب.",
    descriptionEn: "Demo app connected to NahlHub.",
    category: "تجريبي / Demo",
    baseUrl: "https://example.com",
    pinned: false,
  },
];

function json(res, status, payload) {
  res.status(status).json(payload);
}

export default function handler(req, res) {
  const method = req.method || "GET";

  if (method !== "POST") {
    // For now we only support POST from the frontend
    return json(res, 405, {
      success: false,
      error: "Method not allowed. Use POST.",
    });
  }

  const body = req.body || {};
  const action = body.action;

  if (!action) {
    return json(res, 400, {
      success: false,
      error: "Missing 'action' in request body.",
    });
  }

  // 🔹 Handle actions
  switch (action) {
    case "auth.requestOtp": {
      const mobile = (body.mobile || "").trim();
      if (!mobile) {
        return json(res, 400, {
          success: false,
          error: "Mobile is required.",
        });
      }

      // In real backend: generate OTP, save to sheet, send via WhatsApp.
      // Here: just pretend it worked.
      console.log("📲 [Mock] Sending OTP to:", mobile);

      return json(res, 200, {
        success: true,
        message: "Mock OTP sent.",
      });
    }

    case "auth.verifyOtp": {
      const mobile = (body.mobile || "").trim();
      const otp = (body.otp || "").trim();

      if (!mobile || !otp) {
        return json(res, 400, {
          success: false,
          error: "Mobile and OTP are required.",
        });
      }

      // In real backend: check OTP in sheet.
      // Here: accept any 4-digit OTP.
      if (otp.length !== 4) {
        return json(res, 400, {
          success: false,
          error: "Invalid OTP format.",
        });
      }

      console.log("✅ [Mock] OTP verified for:", mobile, "OTP:", otp);

      const user = {
        ...MOCK_USER,
        mobile,
      };

      return json(res, 200, {
        success: true,
        sessionKey: MOCK_SESSION_KEY,
        user,
        apps: MOCK_APPS,
      });
    }

    case "auth.me": {
      const sessionKey = body.sessionKey;
      if (sessionKey !== MOCK_SESSION_KEY) {
        return json(res, 401, {
          success: false,
          error: "Invalid or expired session.",
        });
      }

      return json(res, 200, {
        success: true,
        user: MOCK_USER,
        apps: MOCK_APPS,
      });
    }

    case "auth.logout": {
      const sessionKey = body.sessionKey;
      console.log("👋 [Mock] Logout for session:", sessionKey);
      // In real backend: delete session from sheet.
      return json(res, 200, {
        success: true,
      });
    }

    default:
      return json(res, 400, {
        success: false,
        error: `Unknown action: ${action}`,
      });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
