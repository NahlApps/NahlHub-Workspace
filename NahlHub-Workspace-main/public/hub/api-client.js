/* /public/hub/api-client.js
 * =========================
 * API client for making requests to the backend
 */

(function () {
  "use strict";

  if (!window.NH_CONFIG) throw new Error("NH_CONFIG is missing. Include /public/hub/config.js first.");
  if (!window.NH_UI) throw new Error("NH_UI is missing. Include /public/hub/ui.js first.");

  var API_URL = window.NH_CONFIG.API_URL;
  var HUB_APP_ID = window.NH_CONFIG.HUB_APP_ID;
  var isHtmlLike = window.NH_UI.isHtmlLike;

  /**
   * Make a POST request to the API
   * @param {Object} payload - Request payload
   * @param {string} sessionKey - Optional session key
   * @returns {Promise<Object>} Response data
   */
  function postJson(payload, sessionKey) {
    var body = Object.assign({}, payload || {});
    if (!body.appId && !body.appid && HUB_APP_ID) body.appId = HUB_APP_ID;

    // Auto-attach sessionKey if available
    if (sessionKey && !body.sessionKey) body.sessionKey = sessionKey;

    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (txt) {
        // If function is not deployed, Vercel might return HTML
        if (isHtmlLike(txt)) {
          var hint = "API returned HTML. In Vercel (Other/Static), ensure file exists at /api/hub/manage.js and remove any vercel.json rewrites that touch /api.";
          throw new Error(hint + " (HTTP " + res.status + ")");
        }

        var data = null;
        try { data = JSON.parse(txt || "{}"); } catch (e) {}

        if (!res.ok) {
          var msg = (data && (data.error || data.message)) || ("HTTP " + res.status);
          throw new Error(msg);
        }
        return data || {};
      });
    });
  }

  /**
   * Ping API health endpoint
   * @returns {Promise<Object>} Health check response
   */
  function pingApi() {
    return fetch(API_URL + "?action=health", { method: "GET", cache: "no-store" })
      .then(function (r) { 
        return r.text().then(function (t) { 
          return { ok: r.ok, status: r.status, text: t }; 
        }); 
      })
      .then(function (x) {
        if (isHtmlLike(x.text)) {
          throw new Error("API returned HTML — check Vercel /api function routing.");
        }
        var d = null;
        try { d = JSON.parse(x.text || "{}"); } catch (e) {}
        if (!x.ok || !d || (d.ok !== true && d.success !== true)) {
          throw new Error("Health check failed: HTTP " + x.status);
        }
        return d;
      });
  }

  window.NH_API_CLIENT = {
    postJson: postJson,
    pingApi: pingApi
  };
})();

