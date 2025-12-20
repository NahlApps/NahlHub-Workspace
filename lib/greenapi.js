// lib/greenapi.js
// Green API WhatsApp sender (text)

import { mustGetEnv, getEnv } from "./env";
import { postJson } from "./http";

const GREENAPI_INSTANCE_ID = mustGetEnv("GREENAPI_INSTANCE_ID");
const GREENAPI_TOKEN = mustGetEnv("GREENAPI_TOKEN");
const GREENAPI_API_BASE = getEnv("GREENAPI_API_BASE", "https://api.green-api.com");

function buildSendMessageUrl() {
  // Standard Green API endpoint:
  // POST https://api.green-api.com/waInstance{instanceId}/sendMessage/{token}
  return `${GREENAPI_API_BASE}/waInstance${GREENAPI_INSTANCE_ID}/sendMessage/${GREENAPI_TOKEN}`;
}

function toChatId(ksaE164) {
  // Green API expects chatId like: 9665xxxxxxx@c.us
  return `${ksaE164}@c.us`;
}

export async function sendWhatsAppText({ chatId, message }) {
  try {
    const url = buildSendMessageUrl();
    const payload = { chatId, message };
    const data = await postJson(url, payload, { timeoutMs: 15000 });

    // Green API usually returns { idMessage: "..."} on success
    if (data && (data.idMessage || data.idMessage === "")) {
      return { success: true, data };
    }
    // Some configs may return different response — treat as success if no explicit error
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err?.message || "Green API send failed" };
  }
}

export async function sendOtpWhatsApp({ ksaE164, text }) {
  const chatId = toChatId(ksaE164);
  return sendWhatsAppText({ chatId, message: text });
}
