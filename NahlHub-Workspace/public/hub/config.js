/* /public/hub/config.js
 * =====================
 * Configuration constants for NahlHub
 */

(function () {
  "use strict";

  var HUB_APP_ID = "HUB";

  // ✅ Robust API URL (works in Vercel static "Other")
  var API_URL = (function () {
    try { return new URL("/api/hub/manage", window.location.origin).toString(); }
    catch (e) { return "/api/hub/manage"; }
  })();

  var STORAGE_SESSION_KEY = "nahlhub_session_key";
  var STORAGE_LANG = "nahlhub_lang";
  var STORAGE_THEME = "nahlhub_theme";

  window.NH_CONFIG = {
    HUB_APP_ID: HUB_APP_ID,
    API_URL: API_URL,
    STORAGE_SESSION_KEY: STORAGE_SESSION_KEY,
    STORAGE_LANG: STORAGE_LANG,
    STORAGE_THEME: STORAGE_THEME
  };
})();

