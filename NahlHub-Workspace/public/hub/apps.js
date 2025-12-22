/* /public/hub/apps.js
 * ===================
 * App management logic
 */

(function () {
  "use strict";

  if (!window.NH_I18N) throw new Error("NH_I18N is missing. Include /public/hub/i18n.js first.");
  if (!window.NH_UI) throw new Error("NH_UI is missing. Include /public/hub/ui.js first.");
  if (!window.NH_API_CLIENT) throw new Error("NH_API_CLIENT is missing. Include /public/hub/api-client.js first.");

  var t = window.NH_I18N.t;
  var getLang = window.NH_I18N.getLang;
  var setStatus = window.NH_UI.setStatus;
  var postJson = window.NH_API_CLIENT.postJson;

  /**
   * Set main view (apps, marketplace, or app)
   * @param {Object} elements - UI elements
   * @param {string} view - View name
   */
  function setMainView(elements, view) {
    if (elements.sectionApps) elements.sectionApps.classList.toggle("hidden", view !== "apps");
    if (elements.sectionMarketplace) elements.sectionMarketplace.classList.toggle("hidden", view !== "marketplace");
    if (elements.sectionAppView) elements.sectionAppView.classList.toggle("hidden", view !== "app");

    if (elements.btnViewApps) elements.btnViewApps.classList.toggle("active", view === "apps");
    if (elements.btnViewMarketplace) elements.btnViewMarketplace.classList.toggle("active", view === "marketplace");
  }

  /**
   * Render installed apps
   * @param {HTMLElement} appsGrid - Apps grid container
   * @param {Array} apps - App list
   * @param {Function} onOpenApp - Callback when app is opened
   */
  function renderApps(appsGrid, apps, onOpenApp) {
    if (!appsGrid) return;
    appsGrid.innerHTML = "";

    if (!apps || !apps.length) {
      var empty = document.createElement("div");
      empty.className = "card-caption";
      empty.textContent = getLang() === "ar" ? "لا توجد تطبيقات مثبتة في هذه المساحة." : "No apps installed in this workspace.";
      appsGrid.appendChild(empty);
      return;
    }

    apps.forEach(function (app) {
      var card = document.createElement("article");
      card.className = "app-card";

      var header = document.createElement("div");
      header.className = "app-card-header";

      var main = document.createElement("div");
      main.className = "app-card-main";

      var icon = document.createElement("div");
      icon.className = "app-card-icon";
      icon.textContent = "✦";

      var titleWrap = document.createElement("div");
      var title = document.createElement("div");
      title.className = "app-card-title";
      title.textContent = app.name || app.templateId;

      var tagLine = document.createElement("div");
      tagLine.className = "app-card-tagline";
      tagLine.textContent = app.category || "";

      titleWrap.appendChild(title);
      titleWrap.appendChild(tagLine);

      main.appendChild(icon);
      main.appendChild(titleWrap);

      var statusBadge = document.createElement("span");
      statusBadge.className = "badge-installed";
      statusBadge.textContent = getLang() === "ar" ? "مثبّت" : "Installed";

      header.appendChild(main);
      header.appendChild(statusBadge);

      var body = document.createElement("div");
      body.className = "app-card-body";
      body.textContent = app.shortDesc || "";

      var footer = document.createElement("div");
      footer.className = "app-card-footer";

      var cat = document.createElement("span");
      cat.textContent = app.category || "—";

      var actions = document.createElement("div");
      actions.className = "app-card-actions";

      var openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "btn-pill-sm primary";
      openBtn.textContent = getLang() === "ar" ? "فتح التطبيق" : "Open app";

      openBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (onOpenApp) onOpenApp(app);
      });

      actions.appendChild(openBtn);
      footer.appendChild(cat);
      footer.appendChild(actions);

      card.appendChild(header);
      card.appendChild(body);
      card.appendChild(footer);

      card.addEventListener("click", function () {
        if (onOpenApp) onOpenApp(app);
      });

      appsGrid.appendChild(card);
    });
  }

  /**
   * Render marketplace templates
   * @param {HTMLElement} marketplaceGrid - Marketplace grid container
   * @param {Array} templates - Template list
   * @param {Function} onInstall - Callback when template is installed
   */
  function renderMarketplace(marketplaceGrid, templates, onInstall) {
    if (!marketplaceGrid) return;
    marketplaceGrid.innerHTML = "";

    if (!templates || !templates.length) {
      var empty = document.createElement("div");
      empty.className = "card-caption";
      empty.textContent = getLang() === "ar" ? "لا توجد تطبيقات في المتجر." : "No apps available in marketplace.";
      marketplaceGrid.appendChild(empty);
      return;
    }

    var currentLang = getLang();
    templates.forEach(function (tpl) {
      var card = document.createElement("article");
      card.className = "app-card";

      var header = document.createElement("div");
      header.className = "app-card-header";

      var main = document.createElement("div");
      main.className = "app-card-main";

      var icon = document.createElement("div");
      icon.className = "app-card-icon";
      icon.textContent = "✴";

      var titleWrap = document.createElement("div");
      var title = document.createElement("div");
      title.className = "app-card-title";
      title.textContent = (currentLang === "ar" ? (tpl.nameAr || tpl.name || tpl.templateId) : (tpl.nameEn || tpl.name || tpl.templateId));

      var tagLine = document.createElement("div");
      tagLine.className = "app-card-tagline";
      tagLine.textContent = tpl.category || "";

      titleWrap.appendChild(title);
      titleWrap.appendChild(tagLine);

      main.appendChild(icon);
      main.appendChild(titleWrap);

      var statusSpan = document.createElement("span");
      statusSpan.className = "badge-soft";
      statusSpan.textContent = tpl.planRequired || "free";

      header.appendChild(main);
      header.appendChild(statusSpan);

      var body = document.createElement("div");
      body.className = "app-card-body";
      body.textContent = (currentLang === "ar" ? (tpl.shortDescAr || tpl.shortDesc || "") : (tpl.shortDescEn || tpl.shortDesc || ""));

      var footer = document.createElement("div");
      footer.className = "app-card-footer";

      var tags = document.createElement("span");
      tags.textContent = tpl.featureTags || "";

      var actions = document.createElement("div");
      actions.className = "app-card-actions";

      var installBtn = document.createElement("button");
      installBtn.type = "button";
      installBtn.className = "btn-pill-sm primary";

      var isInstalled = !!tpl.installed;

      installBtn.textContent = isInstalled ? (currentLang === "ar" ? "مثبّت" : "Installed") : (currentLang === "ar" ? "تثبيت" : "Install");
      if (isInstalled) installBtn.disabled = true;

      installBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (isInstalled) return;
        if (onInstall) onInstall(tpl);
      });

      actions.appendChild(installBtn);
      footer.appendChild(tags);
      footer.appendChild(actions);

      card.appendChild(header);
      card.appendChild(body);
      card.appendChild(footer);

      marketplaceGrid.appendChild(card);
    });
  }

  /**
   * Install app template
   * @param {Object} elements - UI elements
   * @param {Object} state - Application state
   * @param {Object} template - Template to install
   * @param {Function} onReload - Callback to reload workspace data
   */
  function installTemplate(elements, state, template, onReload) {
    if (!state.currentWorkspaceId || !state.currentUser) return;
    setStatus(elements.statusPill, elements.statusText, "statusLoadingMarketplace");

    postJson({
      action: "marketplace.installApp",
      workspaceId: state.currentWorkspaceId,
      templateId: template.templateId,
      userId: state.currentUser.userId
    }, state.currentSessionKey)
      .then(function (res) {
        if (!res || res.success !== true) {
          setStatus(elements.statusPill, elements.statusText, (res && res.error) || "Install failed", "error");
          return;
        }
        if (onReload) onReload();
      })
      .catch(function (err) {
        var msg = (getLang() === "ar" ? "فشل التثبيت: " : "Install failed: ") + (err && err.message ? err.message : "");
        setStatus(elements.statusPill, elements.statusText, msg, "error");
      });
  }

  /**
   * Open workspace app
   * @param {Object} elements - UI elements
   * @param {Object} state - Application state
   * @param {Object} app - App to open
   */
  function openWorkspaceApp(elements, state, app) {
    if (!app || !app.defaultRoute) {
      var msg = getLang() === "ar" ? "رابط التطبيق غير مهيأ." : "App URL is not configured yet.";
      setStatus(elements.statusPill, elements.statusText, msg, "error");
      setMainView(elements, "apps");
      return;
    }

    if (!state.currentWorkspaceId) {
      var msg2 = getLang() === "ar" ? "اختر مساحة عمل أولاً." : "Please select a workspace first.";
      setStatus(elements.statusPill, elements.statusText, msg2, "error");
      return;
    }

    if (elements.appViewTitle) elements.appViewTitle.textContent = app.name || app.templateId;
    if (elements.appFramePlaceholder) elements.appFramePlaceholder.classList.add("hidden");
    if (elements.appFrame) elements.appFrame.classList.remove("hidden");

    var route = app.defaultRoute;
    var join = route.indexOf("?") >= 0 ? "&" : "?";
    if (elements.appFrame) {
      elements.appFrame.src = route + join + "workspaceId=" + encodeURIComponent(state.currentWorkspaceId);
    }

    setMainView(elements, "app");
  }

  /**
   * Update user UI display
   * @param {HTMLElement} userNameLabel - User name label element
   * @param {Object} user - User object
   */
  function updateUserUi(userNameLabel, user) {
    if (!userNameLabel) return;
    if (!user) {
      userNameLabel.textContent = "";
      return;
    }
    var suffix = " · " + (user.mobile || "");
    var greet = getLang() === "ar" ? ("مرحباً " + (user.name || "")) : ("Hi " + (user.name || ""));
    userNameLabel.textContent = greet + suffix;
  }

  window.NH_APPS = {
    setMainView: setMainView,
    renderApps: renderApps,
    renderMarketplace: renderMarketplace,
    installTemplate: installTemplate,
    openWorkspaceApp: openWorkspaceApp,
    updateUserUi: updateUserUi
  };
})();

