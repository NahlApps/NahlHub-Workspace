/* /public/hub/ui.members.js
 * =========================
 * Members modal for workspace team management (Milestone 2).
 *
 * Requires:
 * - /public/hub/state.js  (window.NH_STATE)
 * - /public/hub/api.js    (window.NH_API)
 *
 * Integration hooks (recommended to add in index.html later):
 * - After successful login / auth.me:
 *     NH_STATE.setUser(currentUser);
 *     NH_STATE.setSessionKey(currentSessionKey);
 * - When workspace is selected:
 *     NH_STATE.setWorkspaceId(currentWorkspaceId);
 *     NH_STATE.setWorkspaceRole(currentWorkspaceRole);
 */

(function () {
  "use strict";

  if (!window.NH_STATE) throw new Error("NH_STATE is missing. Include /public/hub/state.js first.");
  if (!window.NH_API) throw new Error("NH_API is missing. Include /public/hub/api.js first.");

  var overlayEl = null;
  var modalEl = null;
  var listEl = null;
  var inviteInputEl = null;
  var inviteBtnEl = null;
  var refreshBtnEl = null;
  var closeBtnEl = null;
  var titleEl = null;
  var hintEl = null;

  var currentItems = [];
  var loading = false;

  function injectStylesOnce() {
    if (document.getElementById("nh-members-style")) return;

    var css = ""
      + ".nh-members-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;z-index:9999;backdrop-filter:blur(10px);background:rgba(2,6,23,.35)}"
      + "body[data-theme='dark'] .nh-members-overlay{background:rgba(2,6,23,.7)}"
      + ".nh-members-modal{width:100%;max-width:720px;border-radius:22px;border:1px solid rgba(148,163,184,.45);box-shadow:0 22px 60px rgba(15,23,42,.55);padding:12px;}"
      + "body[data-theme='light'] .nh-members-modal{background:#fff}"
      + "body[data-theme='dark'] .nh-members-modal{background:rgba(15,23,42,.98);border-color:rgba(148,163,184,.55)}"
      + ".nh-members-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}"
      + ".nh-members-title{font-size:14px;font-weight:700}"
      + ".nh-members-sub{font-size:12px;opacity:.75;margin-top:2px}"
      + ".nh-members-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}"
      + ".nh-members-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 8px}"
      + ".nh-members-list{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto;padding-right:2px}"
      + ".nh-member-item{border:1px solid rgba(148,163,184,.35);border-radius:16px;padding:10px;display:flex;align-items:center;justify-content:space-between;gap:10px}"
      + "body[data-theme='dark'] .nh-member-item{border-color:rgba(148,163,184,.55)}"
      + ".nh-member-main{display:flex;flex-direction:column;gap:2px;min-width:0}"
      + ".nh-member-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
      + ".nh-member-meta{font-size:11px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
      + ".nh-member-badges{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}"
      + ".nh-pill{font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid rgba(148,163,184,.35);opacity:.95}"
      + ".nh-pill.ok{border-color:rgba(34,197,94,.6);color:rgba(34,197,94,.95)}"
      + ".nh-pill.warn{border-color:rgba(250,204,21,.6);color:rgba(202,138,4,.95)}"
      + "body[data-theme='dark'] .nh-pill.warn{color:rgba(253,224,71,.95)}"
      + ".nh-pill.err{border-color:rgba(239,68,68,.7);color:rgba(248,113,113,.95)}"
      + ".nh-member-controls{display:flex;gap:6px;align-items:center}"
      + ".nh-select{border-radius:999px;border:1px solid rgba(148,163,184,.45);padding:6px 10px;font-size:12px;background:transparent;color:inherit;outline:none}"
      + "body[data-theme='light'] .nh-select{background:rgba(248,250,252,.96)}"
      + "body[data-theme='dark'] .nh-select{background:rgba(15,23,42,.96)}"
      + ".nh-members-footer{display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px;flex-wrap:wrap}"
      + ".nh-members-hint{font-size:11px;opacity:.7}";

    var style = document.createElement("style");
    style.id = "nh-members-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function open() {
    ensureUi();
    overlayEl.classList.remove("hidden");
    load();
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.classList.add("hidden");
  }

  function ensureUi() {
    injectStylesOnce();
    if (overlayEl) return;

    overlayEl = el("div", "nh-members-overlay hidden");
    modalEl = el("div", "nh-members-modal");
    overlayEl.appendChild(modalEl);

    var header = el("div", "nh-members-header");
    var headerLeft = el("div");
    titleEl = el("div", "nh-members-title", "Workspace Members");
    hintEl = el("div", "nh-members-sub", "");
    headerLeft.appendChild(titleEl);
    headerLeft.appendChild(hintEl);

    var headerRight = el("div", "nh-members-actions");
    refreshBtnEl = el("button", "btn-ghost", "↻ Refresh");
    closeBtnEl = el("button", "btn-ghost", "✕ Close");
    headerRight.appendChild(refreshBtnEl);
    headerRight.appendChild(closeBtnEl);

    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    modalEl.appendChild(header);

    var inviteRow = el("div", "nh-members-row");
    inviteInputEl = el("input", "input");
    inviteInputEl.type = "email";
    inviteInputEl.placeholder = "email@company.com";
    inviteInputEl.style.flex = "1";

    inviteBtnEl = el("button", "btn btn-primary", "Invite");
    inviteRow.appendChild(inviteInputEl);
    inviteRow.appendChild(inviteBtnEl);
    modalEl.appendChild(inviteRow);

    listEl = el("div", "nh-members-list");
    modalEl.appendChild(listEl);

    var footer = el("div", "nh-members-footer");
    var leftHint = el("div", "nh-members-hint", "Admins can change roles and remove members.");
    var rightHint = el("div", "nh-members-hint", "Invited users must accept the invite to become active.");
    footer.appendChild(leftHint);
    footer.appendChild(rightHint);
    modalEl.appendChild(footer);

    document.body.appendChild(overlayEl);

    // Events
    overlayEl.addEventListener("click", function (e) {
      if (e.target === overlayEl) close();
    });

    closeBtnEl.addEventListener("click", close);
    refreshBtnEl.addEventListener("click", load);

    inviteBtnEl.addEventListener("click", function () {
      invite();
    });

    inviteInputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); invite(); }
    });
  }

  function setHeaderInfo() {
    var snap = window.NH_STATE.snapshot();
    var ws = snap.workspaceId || "—";
    var role = snap.workspaceRole || "";
    titleEl.textContent = "Members · " + ws;
    hintEl.textContent = role ? ("Your role: " + role) : "";
  }

  function setLoading(isLoading) {
    loading = !!isLoading;
    if (inviteBtnEl) inviteBtnEl.disabled = loading;
    if (refreshBtnEl) refreshBtnEl.disabled = loading;
  }

  function getWorkspaceIdOrThrow() {
    var snap = window.NH_STATE.snapshot();
    var wsId = snap.workspaceId;
    if (!wsId) throw new Error("workspaceId is missing. Call NH_STATE.setWorkspaceId(workspaceId) when workspace changes.");
    return wsId;
  }

  function load() {
    setHeaderInfo();

    var wsId;
    try {
      wsId = getWorkspaceIdOrThrow();
    } catch (e) {
      renderError(e.message);
      return;
    }

    setLoading(true);
    renderInfo("Loading members...");

    window.NH_API.workspaceMembers(wsId)
      .then(function (res) {
        currentItems = (res && res.items) ? res.items : [];
        renderList(currentItems);
      })
      .catch(function (err) {
        renderError(err && err.message ? err.message : String(err));
      })
      .finally(function () {
        setLoading(false);
      });
  }

  function invite() {
    var snap = window.NH_STATE.snapshot();
    var user = snap.user;
    if (!user || !user.userId) {
      renderError("User not loaded. Please login again.");
      return;
    }

    var wsId;
    try { wsId = getWorkspaceIdOrThrow(); } catch (e) { renderError(e.message); return; }

    var email = String(inviteInputEl.value || "").trim().toLowerCase();
    if (!email || email.indexOf("@") < 1) {
      renderError("Enter a valid email.");
      inviteInputEl.focus();
      return;
    }

    setLoading(true);
    renderInfo("Sending invite...");

    window.NH_API.invite(wsId, email, user.userId)
      .then(function () {
        inviteInputEl.value = "";
        return load();
      })
      .catch(function (err) {
        renderError(err && err.message ? err.message : String(err));
      })
      .finally(function () {
        setLoading(false);
      });
  }

  function changeRole(memberId, role) {
    var wsId;
    try { wsId = getWorkspaceIdOrThrow(); } catch (e) { renderError(e.message); return; }

    setLoading(true);
    window.NH_API.updateMemberRole(wsId, memberId, role)
      .then(function () { return load(); })
      .catch(function (err) { renderError(err && err.message ? err.message : String(err)); })
      .finally(function () { setLoading(false); });
  }

  function removeMember(memberId) {
    var wsId;
    try { wsId = getWorkspaceIdOrThrow(); } catch (e) { renderError(e.message); return; }

    if (!confirm("Remove this member from workspace?")) return;

    setLoading(true);
    window.NH_API.removeMember(wsId, memberId)
      .then(function () { return load(); })
      .catch(function (err) { renderError(err && err.message ? err.message : String(err)); })
      .finally(function () { setLoading(false); });
  }

  function revokeInvite(memberId) {
    var wsId;
    try { wsId = getWorkspaceIdOrThrow(); } catch (e) { renderError(e.message); return; }

    if (!confirm("Revoke this invite?")) return;

    setLoading(true);
    window.NH_API.revokeInvite(wsId, memberId)
      .then(function () { return load(); })
      .catch(function (err) { renderError(err && err.message ? err.message : String(err)); })
      .finally(function () { setLoading(false); });
  }

  function renderInfo(text) {
    listEl.innerHTML = "";
    var box = el("div", "card-caption", text || "");
    box.style.padding = "8px 6px";
    listEl.appendChild(box);
  }

  function renderError(text) {
    listEl.innerHTML = "";
    var box = el("div", "card-caption", text || "Error");
    box.style.padding = "8px 6px";
    box.style.color = "rgba(239,68,68,.95)";
    listEl.appendChild(box);
  }

  function statusPill(status) {
    status = String(status || "").toLowerCase();
    if (status === "active") return { cls: "nh-pill ok", label: "active" };
    if (status === "invited" || status === "pending") return { cls: "nh-pill warn", label: "invited" };
    if (status === "revoked") return { cls: "nh-pill err", label: "revoked" };
    if (status === "removed") return { cls: "nh-pill err", label: "removed" };
    return { cls: "nh-pill", label: status || "—" };
  }

  function renderList(items) {
    listEl.innerHTML = "";

    if (!items || !items.length) {
      renderInfo("No members found.");
      return;
    }

    var snap = window.NH_STATE.snapshot();
    var myRole = String(snap.workspaceRole || "").toLowerCase();
    var canAdmin = (myRole === "admin" || myRole === "owner"); // owner treated as admin
    setHeaderInfo();

    for (var i = 0; i < items.length; i++) {
      var m = items[i] || {};
      var user = m.user || {};
      var memberId = m.memberId || "";

      var card = el("div", "nh-member-item");

      var main = el("div", "nh-member-main");
      var name = el("div", "nh-member-name", user.name || user.email || user.mobile || m.userId || "—");
      var meta = el("div", "nh-member-meta", [
        (user.email ? ("Email: " + user.email) : ""),
        (user.mobile ? ("Mobile: " + user.mobile) : ""),
        (m.userId ? ("UserId: " + m.userId) : "")
      ].filter(Boolean).join(" · "));

      main.appendChild(name);
      main.appendChild(meta);

      var right = el("div", "nh-member-badges");

      var roleP = el("span", "nh-pill", String(m.role || "member"));
      right.appendChild(roleP);

      var st = statusPill(m.memberStatus || m.status);
      var stP = el("span", st.cls, st.label);
      right.appendChild(stP);

      // Controls (admin only)
      if (canAdmin && memberId) {
        var controls = el("div", "nh-member-controls");

        var sel = document.createElement("select");
        sel.className = "nh-select";
        ["admin", "manager", "member", "viewer"].forEach(function (r) {
          var opt = document.createElement("option");
          opt.value = r;
          opt.textContent = r;
          if (String(m.role || "").toLowerCase() === r) opt.selected = true;
          sel.appendChild(opt);
        });

        sel.addEventListener("change", (function (mid) {
          return function (e) {
            changeRole(mid, e.target.value);
          };
        })(memberId));

        var btnRemove = el("button", "btn-pill-sm", "Remove");
        btnRemove.addEventListener("click", (function (mid) {
          return function (e) { e.preventDefault(); removeMember(mid); };
        })(memberId));

        controls.appendChild(sel);

        // If invited -> show revoke, else remove
        var memberStatus = String(m.memberStatus || "").toLowerCase();
        if (memberStatus === "invited" || memberStatus === "pending") {
          var btnRevoke = el("button", "btn-pill-sm", "Revoke");
          btnRevoke.addEventListener("click", (function (mid) {
            return function (e) { e.preventDefault(); revokeInvite(mid); };
          })(memberId));
          controls.appendChild(btnRevoke);
        } else {
          controls.appendChild(btnRemove);
        }

        right.appendChild(controls);
      }

      card.appendChild(main);
      card.appendChild(right);

      listEl.appendChild(card);
    }
  }

  // Optional auto-button injection if index.html doesn't provide a button yet
  function autoAttachButton() {
    // If index.html adds a button with id="btnMembers", we bind to it.
    var btn = document.getElementById("btnMembers");
    if (btn) {
      btn.addEventListener("click", open);
      return;
    }

    // Otherwise inject a small ghost button near logout if present
    var logoutBtn = document.getElementById("btnLogout");
    if (!logoutBtn || logoutBtn.dataset.nhMembersInjected === "1") return;

    logoutBtn.dataset.nhMembersInjected = "1";
    var injected = document.createElement("button");
    injected.type = "button";
    injected.className = "btn-ghost";
    injected.id = "btnMembersInjected";
    injected.textContent = "Members";
    injected.style.marginInlineEnd = "6px";
    injected.addEventListener("click", open);

    logoutBtn.parentNode.insertBefore(injected, logoutBtn);
  }

  // Public API
  window.NH_MEMBERS = {
    open: open,
    close: close,
    refresh: load
  };

  // Init (safe)
  document.addEventListener("DOMContentLoaded", function () {
    autoAttachButton();
  });
})();
