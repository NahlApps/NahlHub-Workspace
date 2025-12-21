/**
 * NH_Security.gs
 * ==============
 * Session + Workspace role guards for NahlHub.
 *
 * Depends on existing Code.gs globals (if present):
 * - NH_SHEET_SESSIONS
 * - NH_SHEET_MEMBERS
 * - NH_SHEET_USERS
 * - getSs_()
 * - ensureSheetWithHeaders_()
 * - getHeaderMap_()
 *
 * If any helper is missing, this file provides safe fallbacks.
 */

// ------------------------------------------------------------
// Fallbacks (only used if Code.gs didn't define them)
// ------------------------------------------------------------

function nhGetSs_() {
  if (typeof getSs_ === "function") return getSs_();
  return SpreadsheetApp.getActive();
}

function nhEnsureSheetWithHeaders_(ss, name, headers) {
  if (typeof ensureSheetWithHeaders_ === "function") return ensureSheetWithHeaders_(ss, name, headers);

  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function nhGetHeaderMap_(sheetName) {
  if (typeof getHeaderMap_ === "function") return getHeaderMap_(sheetName);

  var ss = nhGetSs_();
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("Sheet not found: " + sheetName);
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) throw new Error("Sheet has no header row: " + sheetName);

  var headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = headerRow[i];
    if (!h) continue;
    map[String(h).toLowerCase()] = i + 1; // 1-based
  }
  return map;
}

function nhNow_() {
  return new Date();
}

function nhStr_(v) {
  return String(v == null ? "" : v).trim();
}

// ------------------------------------------------------------
// Role system
// ------------------------------------------------------------

function nhNormalizeRole_(role) {
  role = nhStr_(role).toLowerCase();
  if (!role) return "member";
  if (role === "owner") return "admin";
  if (role === "administrator") return "admin";
  if (role === "admin") return "admin";
  if (role === "manager") return "manager";
  if (role === "viewer") return "viewer";
  if (role === "member") return "member";
  return "member";
}

function nhRoleRank_(role) {
  role = nhNormalizeRole_(role);
  // higher = more power
  var map = {
    viewer: 10,
    member: 20,
    manager: 30,
    admin: 40
  };
  return map[role] || 20;
}

function nhIsAdminRole_(role) {
  return nhNormalizeRole_(role) === "admin";
}

function nhAssertMinRole_(actualRole, requiredRole) {
  var a = nhRoleRank_(actualRole);
  var r = nhRoleRank_(requiredRole);
  if (a < r) throw new Error("Forbidden: insufficient role. Required: " + requiredRole);
}

// ------------------------------------------------------------
// Session
// ------------------------------------------------------------

function nhEnsureSessionsSheet_() {
  var ss = nhGetSs_();
  var sheetName = (typeof NH_SHEET_SESSIONS !== "undefined" && NH_SHEET_SESSIONS) ? NH_SHEET_SESSIONS : "Sessions";
  nhEnsureSheetWithHeaders_(ss, sheetName, ["SessionKey", "UserId", "AppId", "WorkspaceId", "ExpiresAt", "CreatedAt"]);
  return ss.getSheetByName(sheetName);
}

function nhGetSession_(sessionKey) {
  sessionKey = nhStr_(sessionKey);
  if (!sessionKey) return null;

  var sh = nhEnsureSessionsSheet_();
  var map = nhGetHeaderMap_(sh.getName());

  var colSess = map["sessionkey"];
  var colUser = map["userid"];
  var colApp = map["appid"];
  var colWs = map["workspaceid"];
  var colExp = map["expiresat"];

  var data = sh.getDataRange().getValues();
  var now = nhNow_();

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (nhStr_(row[colSess - 1]) !== sessionKey) continue;

    var exp = row[colExp - 1];
    if (exp && exp instanceof Date && exp < now) return null;

    return {
      sessionKey: sessionKey,
      userId: nhStr_(row[colUser - 1]),
      appId: nhStr_(row[colApp - 1]),
      workspaceId: nhStr_(row[colWs - 1]),
      expiresAt: exp
    };
  }
  return null;
}

function nhRequireSession_(payload) {
  payload = payload || {};
  var sessionKey = nhStr_(payload.sessionKey || payload.session_key || "");
  if (!sessionKey) throw new Error("sessionKey is required");

  var sess = nhGetSession_(sessionKey);
  if (!sess || !sess.userId) throw new Error("Session not found or expired");

  return sess;
}

// ------------------------------------------------------------
// Workspace membership role
// ------------------------------------------------------------

function nhEnsureMembersSheet_() {
  var ss = nhGetSs_();
  var sheetName = (typeof NH_SHEET_MEMBERS !== "undefined" && NH_SHEET_MEMBERS) ? NH_SHEET_MEMBERS : "WorkspaceMembers";
  nhEnsureSheetWithHeaders_(ss, sheetName, [
    "MemberId", "WorkspaceId", "UserId", "Role", "Status",
    "InvitedBy", "InviteToken", "InvitedAt", "ActivatedAt"
  ]);
  return ss.getSheetByName(sheetName);
}

function nhGetWorkspaceMember_(workspaceId, userId) {
  workspaceId = nhStr_(workspaceId);
  userId = nhStr_(userId);
  if (!workspaceId || !userId) return null;

  var sh = nhEnsureMembersSheet_();
  var map = nhGetHeaderMap_(sh.getName());

  var colMemberId = map["memberid"];
  var colWs = map["workspaceid"];
  var colUser = map["userid"];
  var colRole = map["role"];
  var colStatus = map["status"];

  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (nhStr_(row[colWs - 1]) !== workspaceId) continue;
    if (nhStr_(row[colUser - 1]) !== userId) continue;

    var st = nhStr_(row[colStatus - 1]).toLowerCase() || "active";
    if (st === "removed" || st === "blocked" || st === "revoked") return null;

    return {
      rowIndex: r + 1,
      memberId: nhStr_(row[colMemberId - 1]),
      workspaceId: workspaceId,
      userId: userId,
      role: nhNormalizeRole_(row[colRole - 1]),
      status: st
    };
  }
  return null;
}

function nhRequireWorkspaceRole_(sessionKey, workspaceId, requiredRole) {
  var sess = nhGetSession_(sessionKey);
  if (!sess || !sess.userId) throw new Error("Session not found or expired");

  workspaceId = nhStr_(workspaceId);
  if (!workspaceId) throw new Error("workspaceId is required");

  var member = nhGetWorkspaceMember_(workspaceId, sess.userId);
  if (!member) throw new Error("Forbidden: not a workspace member");

  nhAssertMinRole_(member.role, requiredRole || "member");
  return {
    session: sess,
    member: member
  };
}

// ------------------------------------------------------------
// Helpers for common API handlers
// ------------------------------------------------------------

function nhOk_(data) {
  var out = data || {};
  out.success = true;
  return out;
}

function nhFail_(message) {
  return { success: false, error: message };
}

/**
 * Wrap a handler body to always return {success:false,error:...} on exceptions.
 */
function nhSafe_(fn) {
  try {
    return fn();
  } catch (e) {
    return nhFail_(e && e.message ? e.message : String(e));
  }
}
