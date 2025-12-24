/* /public/hub/main.js
 * ===================
 * Main application initialization
 * Ties all modules together
 */

(function () {
  "use strict";

  // Check dependencies
  if (!window.NH_CONFIG) throw new Error("NH_CONFIG is missing. Include /public/hub/config.js first.");
  if (!window.NH_I18N) throw new Error("NH_I18N is missing. Include /public/hub/i18n.js first.");
  if (!window.NH_UI) throw new Error("NH_UI is missing. Include /public/hub/ui.js first.");
  if (!window.NH_API_CLIENT) throw new Error("NH_API_CLIENT is missing. Include /public/hub/api-client.js first.");
  if (!window.NH_AUTH) throw new Error("NH_AUTH is missing. Include /public/hub/auth.js first.");
  if (!window.NH_WORKSPACE) throw new Error("NH_WORKSPACE is missing. Include /public/hub/workspace.js first.");
  if (!window.NH_APPS) throw new Error("NH_APPS is missing. Include /public/hub/apps.js first.");

  var STORAGE_SESSION_KEY = window.NH_CONFIG.STORAGE_SESSION_KEY;
  var STORAGE_THEME = window.NH_CONFIG.STORAGE_THEME;

  // Application state
  var state = {
    currentLang: window.NH_I18N.getLang(),
    currentTheme: localStorage.getItem(STORAGE_THEME) || "light",
    currentSessionKey: localStorage.getItem(STORAGE_SESSION_KEY) || null,
    currentUser: null,
    currentMobileRaw: "",
    currentWorkspaces: [],
    currentWorkspaceId: null,
    currentWorkspaceRole: "",
    currentWorkspaceApps: [],
    currentTemplates: [],
    currentMainView: "apps"
  };

  // Get DOM elements
  var elements = {
    bodyEl: document.body,
    statusPill: document.getElementById("statusPill"),
    statusText: document.getElementById("statusText"),
    welcomeCard: document.getElementById("welcomeCard"),
    authOverlay: document.getElementById("authOverlay"),
    stepMobile: document.getElementById("stepMobile"),
    stepOtp: document.getElementById("stepOtp"),
    stepApps: document.getElementById("stepApps"),
    mobileInput: document.getElementById("mobileInput"),
    btnSendOtp: document.getElementById("btnSendOtp"),
    otpInputs: [
      document.getElementById("otp1"),
      document.getElementById("otp2"),
      document.getElementById("otp3"),
      document.getElementById("otp4")
    ],
    btnVerifyOtp: document.getElementById("btnVerifyOtp"),
    btnChangeMobile: document.getElementById("btnChangeMobile"),
    workspaceCard: document.getElementById("workspaceCard"),
    workspaceMenu: document.getElementById("workspaceMenu"),
    workspaceNameEl: document.getElementById("workspaceName"),
    workspaceRoleEl: document.getElementById("workspaceRole"),
    btnViewApps: document.getElementById("btnViewApps"),
    btnViewMarketplace: document.getElementById("btnViewMarketplace"),
    sectionApps: document.getElementById("sectionApps"),
    sectionMarketplace: document.getElementById("sectionMarketplace"),
    sectionAppView: document.getElementById("sectionAppView"),
    appsGrid: document.getElementById("appsGrid"),
    marketplaceGrid: document.getElementById("marketplaceGrid"),
    appFrame: document.getElementById("appFrame"),
    appFramePlaceholder: document.getElementById("appFramePlaceholder"),
    appViewTitle: document.getElementById("appViewTitle"),
    btnBackFromApp: document.getElementById("btnBackFromApp"),
    btnLogout: document.getElementById("btnLogout"),
    btnTheme: document.getElementById("btnTheme"),
    themeIcon: document.getElementById("themeIcon"),
    btnLangAr: document.getElementById("btnLangAr"),
    btnLangEn: document.getElementById("btnLangEn"),
    userNameLabel: document.getElementById("userNameLabel"),
    btnPing: document.getElementById("btnPing"),
    devInfo: document.getElementById("devInfo")
  };

  // Setup OTP inputs
  window.NH_AUTH.setupOtpInputs(elements.otpInputs, function () {
    window.NH_AUTH.verifyOtp(elements, state, onAuthSuccess);
  });

  // Event handlers
  function onAuthSuccess() {
    if (elements.welcomeCard) elements.welcomeCard.classList.add("hidden");
    window.NH_APPS.updateUserUi(elements.userNameLabel, state.currentUser);
    window.NH_WORKSPACE.loadWorkspaces(elements, state, function () {
      if (state.currentWorkspaces.length > 0) {
        window.NH_WORKSPACE.selectWorkspace(elements, state, state.currentWorkspaces[0].workspaceId, function () {
          window.NH_WORKSPACE.loadWorkspaceData(elements, state, renderApps, renderMarketplace);
        });
      }
      window.NH_UI.showStep("apps", elements);
      window.NH_UI.setStatus(elements.statusPill, elements.statusText, "statusIdle");
    });
  }

  function renderApps() {
    window.NH_APPS.renderApps(elements.appsGrid, state.currentWorkspaceApps, function (app) {
      window.NH_APPS.openWorkspaceApp(elements, state, app);
    });
  }

  function renderMarketplace() {
    window.NH_APPS.renderMarketplace(elements.marketplaceGrid, state.currentTemplates, function (tpl) {
      window.NH_APPS.installTemplate(elements, state, tpl, function () {
        window.NH_WORKSPACE.loadWorkspaceData(elements, state, renderApps, renderMarketplace);
      });
    });
  }

  // Event listeners
  if (elements.btnSendOtp) {
    elements.btnSendOtp.addEventListener("click", function () {
      window.NH_AUTH.sendOtp(elements, state, function () {
        // OTP sent successfully
      });
    });
  }

  if (elements.mobileInput) {
    elements.mobileInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        window.NH_AUTH.sendOtp(elements, state);
      }
    });
  }

  if (elements.btnVerifyOtp) {
    elements.btnVerifyOtp.addEventListener("click", function () {
      window.NH_AUTH.verifyOtp(elements, state, onAuthSuccess);
    });
  }

  if (elements.btnChangeMobile) {
    elements.btnChangeMobile.addEventListener("click", function () {
      window.NH_UI.showStep("mobile", elements);
      window.NH_UI.setStatus(elements.statusPill, elements.statusText, "statusIdle");
    });
  }

  if (elements.btnLogout) {
    elements.btnLogout.addEventListener("click", function () {
      window.NH_AUTH.logout(elements, state);
    });
  }

  if (elements.btnTheme) {
    elements.btnTheme.addEventListener("click", function () {
      state.currentTheme = window.NH_UI.toggleTheme(elements.bodyEl, elements.themeIcon, state.currentTheme, STORAGE_THEME);
    });
  }

  if (elements.btnLangAr) {
    elements.btnLangAr.addEventListener("click", function () {
      window.NH_I18N.setLang("ar");
      state.currentLang = "ar";
      updateLanguageUI();
      renderApps();
      renderMarketplace();
    });
  }

  if (elements.btnLangEn) {
    elements.btnLangEn.addEventListener("click", function () {
      window.NH_I18N.setLang("en");
      state.currentLang = "en";
      updateLanguageUI();
      renderApps();
      renderMarketplace();
    });
  }

  function updateLanguageUI() {
    if (elements.btnLangAr) elements.btnLangAr.classList.toggle("active", state.currentLang === "ar");
    if (elements.btnLangEn) elements.btnLangEn.classList.toggle("active", state.currentLang === "en");
    if (elements.mobileInput) elements.mobileInput.placeholder = "5XXXXXXXX";
    window.NH_APPS.updateUserUi(elements.userNameLabel, state.currentUser);
  }

  if (elements.btnViewApps) {
    elements.btnViewApps.addEventListener("click", function () {
      window.NH_APPS.setMainView(elements, "apps");
      state.currentMainView = "apps";
    });
  }

  if (elements.btnViewMarketplace) {
    elements.btnViewMarketplace.addEventListener("click", function () {
      window.NH_APPS.setMainView(elements, "marketplace");
      state.currentMainView = "marketplace";
    });
  }

  if (elements.btnBackFromApp) {
    elements.btnBackFromApp.addEventListener("click", function () {
      window.NH_APPS.setMainView(elements, "apps");
      state.currentMainView = "apps";
    });
  }

  if (elements.workspaceCard) {
    elements.workspaceCard.addEventListener("click", function (e) {
      e.stopPropagation();
      if (elements.workspaceMenu) elements.workspaceMenu.classList.toggle("hidden");
    });
  }

  document.addEventListener("click", function () {
    if (elements.workspaceMenu) elements.workspaceMenu.classList.add("hidden");
  });

  if (elements.workspaceMenu) {
    elements.workspaceMenu.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }

  if (elements.btnPing) {
    elements.btnPing.addEventListener("click", function () {
      if (elements.devInfo) elements.devInfo.textContent = "…";
      window.NH_API_CLIENT.pingApi()
        .then(function (data) {
          if (elements.devInfo) elements.devInfo.textContent = "OK";
        })
        .catch(function (err) {
          if (elements.devInfo) elements.devInfo.textContent = "ERR";
          window.NH_UI.setStatus(elements.statusPill, elements.statusText, err.message || "API error", "error");
        });
    });
  }

  // Initialize
  window.NH_UI.applyTheme(elements.bodyEl, elements.themeIcon, state.currentTheme);
  window.NH_I18N.applyLanguage();
  updateLanguageUI();
  window.NH_UI.setStatus(elements.statusPill, elements.statusText, "statusIdle");

  // Try auto-login
  window.NH_AUTH.tryAutoLogin(elements, state, function () {
    if (elements.welcomeCard) elements.welcomeCard.classList.add("hidden");
    window.NH_APPS.updateUserUi(elements.userNameLabel, state.currentUser);
    window.NH_WORKSPACE.loadWorkspaces(elements, state, function () {
      if (state.currentWorkspaces.length > 0) {
        window.NH_WORKSPACE.selectWorkspace(elements, state, state.currentWorkspaces[0].workspaceId, function () {
          window.NH_WORKSPACE.loadWorkspaceData(elements, state, renderApps, renderMarketplace);
        });
      }
      window.NH_UI.showStep("apps", elements);
      window.NH_UI.setStatus(elements.statusPill, elements.statusText, "statusIdle", "ok");
    });
  }, function () {
    window.NH_UI.showStep("mobile", elements);
  });

  // Ping API on load
  if (elements.btnPing) {
    window.NH_API_CLIENT.pingApi()
      .then(function () {
        if (elements.devInfo) elements.devInfo.textContent = "OK";
      })
      .catch(function () {
        if (elements.devInfo) elements.devInfo.textContent = "ERR";
      });
  }
})();

