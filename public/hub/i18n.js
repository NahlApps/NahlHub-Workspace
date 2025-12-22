/* /public/hub/i18n.js
 * ===================
 * Internationalization (i18n) for NahlHub
 * Supports Arabic (RTL) and English (LTR)
 */

(function () {
  "use strict";

  if (!window.NH_CONFIG) throw new Error("NH_CONFIG is missing. Include /public/hub/config.js first.");

  var STORAGE_LANG = window.NH_CONFIG.STORAGE_LANG;
  var currentLang = localStorage.getItem(STORAGE_LANG) || "ar";

  var tDict = {
    hubTitle: { ar: "NahlHub", en: "NahlHub" },
    hubSub: { ar: "تطبيقاتك في نحل هب", en: "Your apps in NahlHub" },
    welcomeTitle: { ar: "مرحباً 👋", en: "Welcome 👋" },
    welcomeSub: { ar: "ادخل برقم الجوال ثم اختر مساحة العمل والتطبيق.", en: "Enter your mobile, then choose workspace and app." },
    step1Title: { ar: "رقم الجوال", en: "Mobile number" },
    step1Sub: { ar: "ادخل رقم الجوال.", en: "Enter your mobile." },
    step1Label: { ar: "رقم الجوال", en: "Mobile" },
    btnSendOtp: { ar: "إرسال الرمز", en: "Send code" },
    step2Title: { ar: "رمز الدخول", en: "Login code" },
    step2Sub: { ar: "أدخل الرمز ٤ أرقام.", en: "Enter the 4-digit code." },
    changeMobile: { ar: "تعديل الرقم", en: "Change number" },
    btnVerify: { ar: "تأكيد", en: "Confirm" },
    logout: { ar: "تسجيل خروج", en: "Logout" },
    statusIdle: { ar: "جاهز.", en: "Ready." },
    statusSendingOtp: { ar: "يتم إرسال الرمز عبر واتساب...", en: "Sending WhatsApp code..." },
    statusOtpSent: { ar: "تم إرسال الرمز على واتساب.", en: "Code sent via WhatsApp." },
    statusVerifying: { ar: "يتم التحقق...", en: "Verifying..." },
    statusLoadingSession: { ar: "جاري التحقق من الجلسة...", en: "Checking session..." },
    statusError: { ar: "حدث خطأ. حاول مرة أخرى.", en: "Something went wrong. Try again." },
    statusNoWorkspaces: { ar: "لا توجد مساحات عمل متاحة.", en: "No workspaces available." },
    statusLoadingWorkspace: { ar: "جاري تحميل مساحات العمل...", en: "Loading workspaces..." },
    statusLoadingApps: { ar: "جاري تحميل التطبيقات...", en: "Loading apps..." },
    statusLoadingMarketplace: { ar: "جاري تحميل متجر التطبيقات...", en: "Loading marketplace..." },
    workspaceLabel: { ar: "مساحة العمل", en: "Workspace" },
    yourAppsTitle: { ar: "تطبيقاتك", en: "Your apps" },
    marketplaceTitle: { ar: "App Marketplace", en: "App Marketplace" },
    marketplaceSub: { ar: "اختر مساحة العمل وثبت التطبيقات المناسبة لفريقك.", en: "Choose a workspace and install the right apps for your team." },
    viewApps: { ar: "التطبيقات", en: "Apps" },
    viewMarketplace: { ar: "المتجر", en: "Marketplace" },
    appPlaceholder: { ar: "اختر تطبيقاً من قائمة التطبيقات أو من المتجر.", en: "Choose an app from your apps or from the marketplace." },
    appViewSub: { ar: "التطبيق ظاهر داخل نحل هب. استخدم زر الرجوع للعودة للتطبيقات.", en: "The app is shown inside NahlHub. Use Back to return to apps." },
    backToApps: { ar: "التطبيقات", en: "Apps" },
    userNotFound: { ar: "هذا الرقم غير مسجل. تواصل مع مسؤول النظام لإنشاء حساب.", en: "This mobile is not registered. Contact your admin to create an account." }
  };

  /**
   * Translate a key to the current language
   * @param {string} key - Translation key
   * @returns {string} Translated text
   */
  function t(key) {
    var entry = tDict[key];
    if (!entry) return key;
    return entry[currentLang] || entry.ar || key;
  }

  /**
   * Get current language
   * @returns {string} Current language code ("ar" or "en")
   */
  function getLang() {
    return currentLang;
  }

  /**
   * Set current language
   * @param {string} lang - Language code ("ar" or "en")
   */
  function setLang(lang) {
    if (lang !== "ar" && lang !== "en") return;
    currentLang = lang;
    localStorage.setItem(STORAGE_LANG, currentLang);
    applyLanguage();
  }

  /**
   * Apply language to the document
   */
  function applyLanguage() {
    document.documentElement.lang = currentLang;
    document.documentElement.dir = currentLang === "ar" ? "rtl" : "ltr";

    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      var key = node.getAttribute("data-i18n");
      node.textContent = t(key);
    });
  }

  /**
   * Get all translation keys
   * @returns {Object} Translation dictionary
   */
  function getDict() {
    return tDict;
  }

  window.NH_I18N = {
    t: t,
    getLang: getLang,
    setLang: setLang,
    applyLanguage: applyLanguage,
    getDict: getDict
  };
})();

