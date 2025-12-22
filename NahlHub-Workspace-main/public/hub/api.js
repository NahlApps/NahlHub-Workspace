/* /public/hub/api.js
 * ==================
 * Small API wrapper used by hub UI modules.
 *
 * Depends on window.NH_STATE (state.js).
 */

(function () {
  "use strict";

  function safeJson(res) {
    return res.json().catch(function () {
      throw new Error("Invalid JSON from server.");
    });
  }

  function normalizeError(err) {
    if (!err) return "Unexpected error";
    if (typeof err === "string") return err;
    return err.message || "Unexpected error";
  }

  function nhPost(action, payload, opts) {
    payload = payload || {};
    opts = opts || {};

    if (!window.NH_STATE) throw new Error("NH_STATE is missing. Include /public/hub/state.js first.");

    var snap = window.NH_STATE.snapshot();
    var apiUrl = opts.apiUrl || snap.apiUrl || "/api/hub/manage";
    var appId = opts.appId || snap.appId || "HUB";
    var sessionKey = (opts.sessionKey != null) ? String(opts.sessionKey) : String(snap.sessionKey || "");

    var body = {};
    for (var k in payload) body[k] = payload[k];
    body.action = action;
    if (!body.appId && !body.appid) body.appId = appId;

    // attach sessionKey if we have one AND not explicitly provided
    if (sessionKey && !body.sessionKey) body.sessionKey = sessionKey;

    return fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(safeJson)
      .then(function (data) {
        if (!data || data.success !== true) {
          var msg = (data && (data.error || data.message)) || "Request failed";
          throw new Error(msg);
        }
        return data;
      })
      .catch(function (err) {
        throw new Error(normalizeError(err));
      });
  }

  // Convenience helpers
  function nhMe() {
    return nhPost("auth.me", {});
  }

  function nhWorkspaceMembers(workspaceId) {
    return nhPost("workspace.members", { workspaceId: workspaceId });
  }

  function nhInvite(workspaceId, email, invitedBy) {
    return nhPost("workspace.invite", { workspaceId: workspaceId, email: email, invitedBy: invitedBy });
  }

  function nhUpdateMemberRole(workspaceId, memberId, role) {
    return nhPost("workspace.updateMemberRole", { workspaceId: workspaceId, memberId: memberId, role: role });
  }

  function nhRemoveMember(workspaceId, memberId) {
    return nhPost("workspace.removeMember", { workspaceId: workspaceId, memberId: memberId });
  }

  function nhRevokeInvite(workspaceId, memberId) {
    return nhPost("workspace.revokeInvite", { workspaceId: workspaceId, memberId: memberId });
  }

  window.NH_API = {
    post: nhPost,
    me: nhMe,
    workspaceMembers: nhWorkspaceMembers,
    invite: nhInvite,
    updateMemberRole: nhUpdateMemberRole,
    removeMember: nhRemoveMember,
    revokeInvite: nhRevokeInvite
  };
})();
