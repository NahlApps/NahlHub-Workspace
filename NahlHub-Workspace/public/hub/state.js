/* /public/hub/state.js
 * ====================
 * Shared state container for Hub UI modules.
 *
 * Designed to work with your current index.html IIFE:
 * - index.html should call:
 *   NH_STATE.setSessionKey(currentSessionKey)
 *   NH_STATE.setUser(currentUser)
 *   NH_STATE.setWorkspaceId(currentWorkspaceId)
 *
 * If index.html is not yet updated, this still provides:
 * - sessionKey restored from localStorage ("nahlhub_session_key")
 */

(function () {
  "use strict";

  var STORAGE_SESSION_KEY = "nahlhub_session_key";

  var state = {
    appId: "HUB",
    apiUrl: "/api/hub/manage",

    sessionKey: localStorage.getItem(STORAGE_SESSION_KEY) || "",
    user: null,

    workspaceId: "",
    workspaceRole: "",

    // observers
    _subs: []
  };

  function notify() {
    for (var i = 0; i < state._subs.length; i++) {
      try { state._subs[i](NH_STATE.snapshot()); } catch (e) {}
    }
  }

  var NH_STATE = {
    snapshot: function () {
      return {
        appId: state.appId,
        apiUrl: state.apiUrl,
        sessionKey: state.sessionKey,
        user: state.user,
        workspaceId: state.workspaceId,
        workspaceRole: state.workspaceRole
      };
    },

    subscribe: function (fn) {
      if (typeof fn !== "function") return function () {};
      state._subs.push(fn);
      return function unsubscribe() {
        var idx = state._subs.indexOf(fn);
        if (idx >= 0) state._subs.splice(idx, 1);
      };
    },

    setAppId: function (appId) {
      state.appId = String(appId || "HUB").trim() || "HUB";
      notify();
    },

    setApiUrl: function (url) {
      state.apiUrl = String(url || "/api/hub/manage").trim() || "/api/hub/manage";
      notify();
    },

    setSessionKey: function (key) {
      state.sessionKey = String(key || "").trim();
      if (state.sessionKey) localStorage.setItem(STORAGE_SESSION_KEY, state.sessionKey);
      else localStorage.removeItem(STORAGE_SESSION_KEY);
      notify();
    },

    getSessionKey: function () {
      return state.sessionKey || "";
    },

    setUser: function (userObj) {
      state.user = userObj || null;
      notify();
    },

    getUser: function () {
      return state.user || null;
    },

    setWorkspaceId: function (workspaceId) {
      state.workspaceId = String(workspaceId || "").trim();
      notify();
    },

    getWorkspaceId: function () {
      return state.workspaceId || "";
    },

    setWorkspaceRole: function (role) {
      state.workspaceRole = String(role || "").trim();
      notify();
    },

    getWorkspaceRole: function () {
      return state.workspaceRole || "";
    }
  };

  window.NH_STATE = NH_STATE;
})();
