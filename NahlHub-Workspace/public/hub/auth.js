/* /public/hub/auth.js
 * ===================
 * Authentication logic for NahlHub
 */

(function () {
  "use strict";

  if (!window.NH_CONFIG) throw new Error("NH_CONFIG is missing. Include /public/hub/config.js first.");
  if (!window.NH_I18N) throw new Error("NH_I18N is missing. Include /public/hub/i18n.js first.");
  if (!window.NH_UI) throw new Error("NH_UI is missing. Include /public/hub/ui.js first.");
  if (!window.NH_API_CLIENT) throw new Error("NH_API_CLIENT is missing. Include /public/hub/api-client.js first.");

  var STORAGE_SESSION_KEY = window.NH_CONFIG.STORAGE_SESSION_KEY;
  var t = window.NH_I18N.t;
  var getLang = window.NH_I18N.getLang;
  var setStatus = window.NH_UI.setStatus;
  var showStep = window.NH_UI.showStep;
  var postJson = window.NH_API_CLIENT.postJson;

  /**
   * Read OTP from input fields
   * @param {Array<HTMLElement>} otpInputs - OTP input elements
   * @returns {string} OTP code
   */
  function readOtp(otpInputs) {
    return otpInputs.map(function (el) { return el.value || ""; }).join("");
  }

  /**
   * Clear OTP input fields
   * @param {Array<HTMLElement>} otpInputs - OTP input elements
   */
  function clearOtpInputs(otpInputs) {
    otpInputs.forEach(function (el) { el.value = ""; });
  }

  /**
   * Setup OTP input handlers
   * @param {Array<HTMLElement>} otpInputs - OTP input elements
   * @param {Function} verifyCallback - Callback when Enter is pressed
   */
  function setupOtpInputs(otpInputs, verifyCallback) {
    otpInputs.forEach(function (input, idx) {
      input.addEventListener("input", function (e) {
        var value = e.target.value.replace(/\D/g, "");
        e.target.value = value.slice(0, 1);
        if (value && idx < otpInputs.length - 1) otpInputs[idx + 1].focus();
      });

      input.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !e.target.value && idx > 0) otpInputs[idx - 1].focus();
        if (e.key === "ArrowLeft" && idx > 0) otpInputs[idx - 1].focus();
        if (e.key === "ArrowRight" && idx < otpInputs.length - 1) otpInputs[idx + 1].focus();
        if (e.key === "Enter" && verifyCallback) { 
          e.preventDefault(); 
          verifyCallback(); 
        }
      });
    });
  }

  /**
   * Send OTP code
   * @param {Object} elements - UI elements
   * @param {Object} state - Application state
   * @param {Function} onSuccess - Success callback
   */
  function sendOtp(elements, state, onSuccess) {
    var mobile = (elements.mobileInput.value || "").trim();
    if (!mobile) {
      var msg = getLang() === "ar" ? "أدخل رقم الجوال." : "Enter your mobile.";
      setStatus(elements.statusPill, elements.statusText, msg, "error");
      elements.mobileInput.focus();
      return;
    }

    state.currentMobileRaw = mobile;
    elements.btnSendOtp.disabled = true;
    setStatus(elements.statusPill, elements.statusText, "statusSendingOtp");

    postJson({ action: "sendOtp", mobile: mobile }, state.currentSessionKey)
      .then(function (res) {
        if (!res || res.success !== true) {
          var msg = (res && res.error) || (getLang() === "ar" ? "تعذر إرسال الرمز." : "Failed to send code.");
          setStatus(elements.statusPill, elements.statusText, msg, "error");
          return;
        }
        setStatus(elements.statusPill, elements.statusText, "statusOtpSent", "ok");
        clearOtpInputs(elements.otpInputs);
        showStep("otp", elements);
        if (onSuccess) onSuccess();
      })
      .catch(function (err) {
        var msg = (getLang() === "ar" ? "خطأ: " : "Error: ") + (err && err.message ? err.message : "");
        setStatus(elements.statusPill, elements.statusText, msg, "error");
      })
      .finally(function () {
        elements.btnSendOtp.disabled = false;
      });
  }

  /**
   * Verify OTP code
   * @param {Object} elements - UI elements
   * @param {Object} state - Application state
   * @param {Function} onSuccess - Success callback
   */
  function verifyOtp(elements, state, onSuccess) {
    var otp = readOtp(elements.otpInputs);
    if (!otp || otp.length !== 4) {
      var msg = getLang() === "ar" ? "أدخل الرمز ٤ أرقام." : "Enter the 4-digit code.";
      setStatus(elements.statusPill, elements.statusText, msg, "error");
      elements.otpInputs[0].focus();
      return;
    }

    elements.btnVerifyOtp.disabled = true;
    setStatus(elements.statusPill, elements.statusText, "statusVerifying");

    postJson({ action: "verifyOtp", mobile: state.currentMobileRaw, otp: otp }, state.currentSessionKey)
      .then(function (res) {
        if (!res || res.success !== true) {
          var msg = (res && res.error) || (getLang() === "ar" ? "رمز غير صحيح أو منتهي." : "Invalid or expired code.");
          setStatus(elements.statusPill, elements.statusText, msg, "error");
          clearOtpInputs(elements.otpInputs);
          elements.otpInputs[0].focus();
          return;
        }

        if (res.userExists === false) {
          setStatus(elements.statusPill, elements.statusText, "userNotFound", "error");
          clearOtpInputs(elements.otpInputs);
          elements.otpInputs[0].focus();
          return;
        }

        state.currentSessionKey = res.sessionKey || null;
        state.currentUser = res.user || null;
        if (state.currentSessionKey) {
          localStorage.setItem(STORAGE_SESSION_KEY, state.currentSessionKey);
        }

        if (onSuccess) onSuccess();
      })
      .catch(function (err) {
        var msg = (getLang() === "ar" ? "خطأ: " : "Error: ") + (err && err.message ? err.message : "");
        setStatus(elements.statusPill, elements.statusText, msg, "error");
      })
      .finally(function () {
        elements.btnVerifyOtp.disabled = false;
      });
  }

  /**
   * Try auto-login with stored session
   * @param {Object} elements - UI elements
   * @param {Object} state - Application state
   * @param {Function} onSuccess - Success callback
   * @param {Function} onFailure - Failure callback
   */
  function tryAutoLogin(elements, state, onSuccess, onFailure) {
    if (!state.currentSessionKey) {
      if (onFailure) onFailure();
      return;
    }

    setStatus(elements.statusPill, elements.statusText, "statusLoadingSession");
    postJson({ action: "auth.me" }, state.currentSessionKey)
      .then(function (res) {
        if (!res || res.success !== true) {
          if (onFailure) onFailure();
          return;
        }

        state.currentUser = res.user || null;
        if (onSuccess) onSuccess();
      })
      .catch(function () {
        if (onFailure) onFailure();
      });
  }

  /**
   * Logout user
   * @param {Object} elements - UI elements
   * @param {Object} state - Application state
   * @param {Function} onComplete - Completion callback
   */
  function logout(elements, state, onComplete) {
    var prevSession = state.currentSessionKey;

    state.currentSessionKey = null;
    localStorage.removeItem(STORAGE_SESSION_KEY);
    state.currentUser = null;
    state.currentWorkspaces = [];
    state.currentWorkspaceId = null;
    state.currentWorkspaceApps = [];
    state.currentTemplates = [];

    if (elements.appsGrid) elements.appsGrid.innerHTML = "";
    if (elements.marketplaceGrid) elements.marketplaceGrid.innerHTML = "";
    if (elements.workspaceNameEl) elements.workspaceNameEl.textContent = "—";
    if (elements.workspaceRoleEl) elements.workspaceRoleEl.textContent = "—";

    if (elements.welcomeCard) elements.welcomeCard.classList.remove("hidden");
    setStatus(elements.statusPill, elements.statusText, "statusIdle");
    showStep("mobile", elements);

    if (prevSession) {
      postJson({ action: "auth.logout", sessionKey: prevSession }).catch(function () {});
    }

    if (onComplete) onComplete();
  }

  window.NH_AUTH = {
    readOtp: readOtp,
    clearOtpInputs: clearOtpInputs,
    setupOtpInputs: setupOtpInputs,
    sendOtp: sendOtp,
    verifyOtp: verifyOtp,
    tryAutoLogin: tryAutoLogin,
    logout: logout
  };
})();

