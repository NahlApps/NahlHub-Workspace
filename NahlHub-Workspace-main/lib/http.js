// lib/http.js
// small fetch wrapper with timeout + safe JSON parsing

export async function postJson(url, payload, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });

    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 220)}`);
    }

    if (!res.ok) {
      const msg = data?.error || data?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  } finally {
    clearTimeout(t);
  }
}
