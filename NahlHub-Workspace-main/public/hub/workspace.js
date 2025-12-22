/* /public/hub/workspace.js
 * ========================
 * Workspace management logic
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
   * Build workspace dropdown menu
   * @param {HTMLElement} workspaceMenu - Menu container
   * @param {Array} workspaces - Workspace list
   * @param {string} currentWorkspaceId - Current workspace ID
   * @param {Function} onSelect - Selection callback
   */
  function buildWorkspaceMenu(workspaceMenu, workspaces, currentWorkspaceId, onSelect) {
    if (!workspaceMenu) return;

    workspaceMenu.innerHTML = "";
    if (!workspaces || !workspaces.length) {
      var empty = document.createElement("div");
      empty.className = "card-caption";
      empty.style.padding = "6px 4px";
      empty.textContent = t("statusNoWorkspaces");
      workspaceMenu.appendChild(empty);
      return;
    }

    workspaces.forEach(function (ws) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "workspace-menu-item";
      if (ws.workspaceId === currentWorkspaceId) btn.classList.add("active");

      var main = document.createElement("div");
      main.className = "workspace-menu-item-main";

      var name = document.createElement("div");
      name.className = "workspace-menu-item-name";
      name.textContent = ws.name || ws.workspaceId;

      var meta = document.createElement("div");
      meta.className = "workspace-menu-item-meta";
      meta.textContent = (ws.slug || "") + (ws.plan ? " · " + ws.plan : "");

      main.appendChild(name);
      main.appendChild(meta);

      var rolePill = document.createElement("span");
      rolePill.className = "workspace-menu-item-role";
      rolePill.textContent = ws.role || "member";

      btn.appendChild(main);
      btn.appendChild(rolePill);

      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (onSelect) onSelect(ws.workspaceId);
        workspaceMenu.classList.add("hidden");
      });

      workspaceMenu.appendChild(btn);
    });
  }

  /**
   * Load user workspaces
   * @param {Object} elements - UI elements
   * @param {Object} state - Application state
   * @param {Function} onSuccess - Success callback
   */
  function loadWorkspaces(elements, state, onSuccess) {
    if (!state.currentUser || !state.currentUser.userId) {
      if (onSuccess) onSuccess();
      return;
    }

    setStatus(elements.statusPill, elements.statusText, "statusLoadingWorkspace");
    postJson({ action: "workspace.listForUser", userId: state.currentUser.userId }, state.currentSessionKey)
      .then(function (res) {
        state.currentWorkspaces = (res && res.items) || [];
        if (!state.currentWorkspaces.length) {
          setStatus(elements.statusPill, elements.statusText, "statusNoWorkspaces", "error");
          if (onSuccess) onSuccess();
          return;
        }
        if (onSuccess) onSuccess();
      })
      .catch(function (err) {
        var msg = (getLang() === "ar" ? "فشل تحميل المساحات: " : "Failed loading workspaces: ") + (err && err.message ? err.message : "");
        setStatus(elements.statusPill, elements.statusText, msg, "error");
        if (onSuccess) onSuccess();
      });
  }

  /**
   * Select a workspace
   * @param {Object} elements - UI elements
   * @param {Object} state - Application state
   * @param {string} workspaceId - Workspace ID to select
   * @param {Function} onLoadData - Callback to load workspace data
   */
  function selectWorkspace(elements, state, workspaceId, onLoadData) {
    var ws = state.currentWorkspaces.find(function (w) { return w.workspaceId === workspaceId; });
    if (!ws) return;

    state.currentWorkspaceId = workspaceId;
    state.currentWorkspaceRole = ws.role || "member";

    if (elements.workspaceNameEl) elements.workspaceNameEl.textContent = ws.name || ws.workspaceId;
    if (elements.workspaceRoleEl) elements.workspaceRoleEl.textContent = ws.role === "admin" ? "admin" : "member";

    buildWorkspaceMenu(elements.workspaceMenu, state.currentWorkspaces, workspaceId, function (id) {
      selectWorkspace(elements, state, id, onLoadData);
    });

    setStatus(elements.statusPill, elements.statusText, "statusLoadingApps");
    if (onLoadData) onLoadData();
  }

  /**
   * Load workspace data (apps and templates)
   * @param {Object} elements - UI elements
   * @param {Object} state - Application state
   * @param {Function} onRenderApps - Callback to render apps
   * @param {Function} onRenderMarketplace - Callback to render marketplace
   */
  function loadWorkspaceData(elements, state, onRenderApps, onRenderMarketplace) {
    if (!state.currentWorkspaceId) return;

    Promise.all([
      postJson({ action: "marketplace.listWorkspaceApps", workspaceId: state.currentWorkspaceId }, state.currentSessionKey),
      postJson({ action: "marketplace.listTemplates", workspaceId: state.currentWorkspaceId }, state.currentSessionKey)
    ])
      .then(function (results) {
        var appsRes = results[0] || {};
        var tplRes = results[1] || {};
        state.currentTemplates = tplRes.items || [];

        var tplById = {};
        state.currentTemplates.forEach(function (tpl) { tplById[tpl.templateId] = tpl; });

        var currentLang = getLang();
        state.currentWorkspaceApps = (appsRes.items || []).map(function (app) {
          var tpl = tplById[app.templateId] || {};
          return {
            workspaceAppId: app.workspaceAppId,
            appId: app.appId,
            templateId: app.templateId,
            name: (currentLang === "ar"
              ? (app.nameAr || tpl.nameAr || app.name || tpl.name || app.templateId)
              : (app.nameEn || tpl.nameEn || app.name || tpl.name || app.templateId)),
            category: tpl.category || app.category || "",
            shortDesc: (currentLang === "ar" ? (tpl.shortDescAr || tpl.shortDesc || "") : (tpl.shortDescEn || tpl.shortDesc || "")) || "",
            status: app.status || "",
            visibleInHub: app.visibleInHub || "",
            defaultRoute: tpl.defaultRoute || app.defaultRoute || "",
            iconUrl: tpl.iconUrl || "",
            featureTags: tpl.featureTags || ""
          };
        });

        if (onRenderApps) onRenderApps();
        if (onRenderMarketplace) onRenderMarketplace();
        setStatus(elements.statusPill, elements.statusText, "statusIdle");
      })
      .catch(function (err) {
        var msg = (getLang() === "ar" ? "فشل تحميل البيانات: " : "Failed loading data: ") + (err && err.message ? err.message : "");
        setStatus(elements.statusPill, elements.statusText, msg, "error");
      });
  }

  window.NH_WORKSPACE = {
    buildWorkspaceMenu: buildWorkspaceMenu,
    loadWorkspaces: loadWorkspaces,
    selectWorkspace: selectWorkspace,
    loadWorkspaceData: loadWorkspaceData
  };
})();

