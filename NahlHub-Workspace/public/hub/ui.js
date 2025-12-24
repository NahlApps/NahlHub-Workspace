/* /public/hub/ui.js
 * =================
 * UI utilities and helpers
 */

(function () {
  "use strict";

  if (!window.NH_I18N) throw new Error("NH_I18N is missing. Include /public/hub/i18n.js first.");

  var t = window.NH_I18N.t;
  var getLang = window.NH_I18N.getLang;

  /**
   * Check if text looks like HTML
   * @param {string} text - Text to check
   * @returns {boolean} True if text looks like HTML
   */
  function isHtmlLike(text) {
    return /<!doctype|<html/i.test(String(text || ""));
  }

  /**
   * Set status message
   * @param {HTMLElement} statusPill - Status pill element
   * @param {HTMLElement} statusText - Status text element
   * @param {string} msgKeyOrText - Message key or text
   * @param {string} type - Status type ("ok", "error", or null)
   */
  function setStatus(statusPill, statusText, msgKeyOrText, type) {
    if (!statusPill || !statusText) return;

    if (!msgKeyOrText) {
      statusText.textContent = "";
      statusPill.classList.remove("ok", "error");
      return;
    }

    var text = (window.NH_I18N.getDict()[msgKeyOrText] && window.NH_I18N.getDict()[msgKeyOrText][getLang()]) 
      ? t(msgKeyOrText) 
      : msgKeyOrText;

    statusPill.classList.remove("ok", "error");
    if (type === "ok") statusPill.classList.add("ok");
    else if (type === "error") statusPill.classList.add("error");
    statusText.textContent = text;
  }

  /**
   * Show a step in the authentication flow
   * @param {string} name - Step name ("mobile", "otp", or "apps")
   * @param {Object} elements - Step elements
   */
  function showStep(name, elements) {
    if (!elements) return;

    elements.stepMobile.classList.add("hidden");
    elements.stepOtp.classList.add("hidden");
    elements.stepApps.classList.add("hidden");

    if (name === "mobile") {
      elements.authOverlay.classList.remove("hidden");
      elements.stepMobile.classList.remove("hidden");
      setTimeout(function () { 
        if (elements.mobileInput) elements.mobileInput.focus(); 
      }, 50);
    } else if (name === "otp") {
      elements.authOverlay.classList.remove("hidden");
      elements.stepOtp.classList.remove("hidden");
      setTimeout(function () { 
        if (elements.otpInputs && elements.otpInputs[0]) elements.otpInputs[0].focus(); 
      }, 50);
    } else if (name === "apps") {
      elements.authOverlay.classList.add("hidden");
      elements.stepApps.classList.remove("hidden");
    }
  }

  /**
   * Apply theme to document
   * @param {HTMLElement} bodyEl - Body element
   * @param {HTMLElement} themeIcon - Theme icon element
   * @param {string} theme - Theme name ("light" or "dark")
   */
  function applyTheme(bodyEl, themeIcon, theme) {
    if (!bodyEl) return;
    bodyEl.setAttribute("data-theme", theme);
    if (themeIcon) {
      themeIcon.textContent = theme === "light" ? "🌞" : "🌙";
    }
  }

  /**
   * Toggle theme
   * @param {HTMLElement} bodyEl - Body element
   * @param {HTMLElement} themeIcon - Theme icon element
   * @param {string} currentTheme - Current theme
   * @param {string} storageKey - Storage key for theme
   * @returns {string} New theme
   */
  function toggleTheme(bodyEl, themeIcon, currentTheme, storageKey) {
    var newTheme = currentTheme === "light" ? "dark" : "light";
    localStorage.setItem(storageKey, newTheme);
    applyTheme(bodyEl, themeIcon, newTheme);
    return newTheme;
  }

  window.NH_UI = {
    isHtmlLike: isHtmlLike,
    setStatus: setStatus,
    showStep: showStep,
    applyTheme: applyTheme,
    toggleTheme: toggleTheme
  };
})();

