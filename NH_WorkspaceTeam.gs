/**
 * NH_WorkspaceTeam.gs
 * ===================
 * Workspace team features for Milestone 2:
 * - workspace.acceptInvite
 * - workspace.updateMemberRole
 * - workspace.removeMember
 * - workspace.revokeInvite
 *
 * Requires NH_Security.gs + existing Code.gs sheets:
 * - Users, WorkspaceMembers, Sessions
 *
 * IMPORTANT: Add routing in Code.gs handleRequest_ switch:
 * case 'workspace.acceptInvite': return jsonResponse(handleWorkspaceAcceptInvite_(payload));
 * case 'workspace.updateMemberRole': return jsonResponse(handleWorkspaceUpdateMemberRole_(payload));
 * case 'workspace.removeMember': return jsonResponse(handleWorkspaceRemoveMember_(payload));
 * case 'workspace.revokeInvite': return jsonResponse(handleWorkspaceRevokeInvite_(payload));
 */

// We rely on helpers from NH_Security.gs
function nhTeamNow_() { return new Date(); }
function nhTeamStr_(v) { return String(v == null ? "" : v).trim(); }

function nhEnsureUsersSheet_() {
  var ss = (typeof nhGetSs_ === "function") ? nhGetSs_() : SpreadsheetApp.getActive();
  var sheetName = (typeof NH_SHEET_USERS !== "undefined" && NH_SHEET_USERS) ? NH_SHEET_USERS : "Users";
  if (typeof ensureUsersSheet_ === "function") {
    ensureUsersSheet_(ss);
    return ss.getSheetByName(sheetName);
  }
  // fallback
  if (typeof nhEnsureSheetWithHeaders_ === "function") {
    nhEnsureSheetWithHeaders_(ss, sheetName, ["UserId","Email","Mobile","Name","GlobalRole","Status","CreatedAt","UpdatedAt"]);
  }
  return ss.getSheetByName(sheetName);
}

function nhFindMemberRowByToken_(workspaceId, inviteToken) {
  workspaceId = nhTeamStr_(workspaceId);
  inviteToken = nhTeamStr_(inviteToken);

  var sh = nhEnsureMembersSheet_();
  var map = nhGetHeaderMap_(sh.getName());

  var colWs = map["workspaceid"];
  var colToken = map["invitetoken"];
  var colStatus = map["status"];

  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (nhTeamStr_(data[r][colWs - 1]) !== workspaceId) continue;
    if (nhTeamStr_(data[r][colToken - 1]) !== inviteToken) continue;

    var st = nhTeamStr_(data[r][colStatus - 1]).toLowerCase();
    // Accept only invited (or pending)
    if (st !== "invited" && st !== "pending") return null;

    return { rowIndex: r + 1, row: data[r] };
  }
  return null;
}

function nhCountActiveAdmins_(workspaceId) {
  workspaceId = nhTeamStr_(workspaceId);
  var sh = nhEnsureMembersSheet_();
  var map = nhGetHeaderMap_(sh.getName());

  var colWs = map["workspaceid"];
  var colRole = map["role"];
  var colStatus = map["status"];

  var data = sh.getDataRange().getValues();
  var count = 0;

  for (var r = 1; r < data.length; r++) {
    if (nhTeamStr_(data[r][colWs - 1]) !== workspaceId) continue;
    var st = nhTeamStr_(data[r][colStatus - 1]).toLowerCase() || "active";
    if (st !== "active") continue;
    var role = nhNormalizeRole_(data[r][colRole - 1]);
    if (role === "admin") count++;
  }
  return count;
}

function handleWorkspaceAcceptInvite_(payload) {
  return nhSafe_(function() {
    payload = payload || {};
    var sess = nhRequireSession_(payload);

    var workspaceId = nhTeamStr_(payload.workspaceId);
    var inviteToken = nhTeamStr_(payload.inviteToken || payload.token);

    if (!workspaceId) throw new Error("workspaceId is required");
    if (!inviteToken) throw new Error("inviteToken is required");

    // Find invite row
    var found = nhFindMemberRowByToken_(workspaceId, inviteToken);
    if (!found) throw new Error("Invite not found or already used");

    var sh = nhEnsureMembersSheet_();
    var map = nhGetHeaderMap_(sh.getName());

    var colUser = map["userid"];
    var colRole = map["role"];
    var colStatus = map["status"];
    var colActivatedAt = map["activatedat"];
    var colToken = map["invitetoken"];

    var rowIndex = found.rowIndex;
    var row = found.row;

    var invitedUserId = nhTeamStr_(row[colUser - 1]);
    if (!invitedUserId) throw new Error("Invite record is missing userId");

    // The invite can only be accepted by that invited user
    if (sess.userId !== invitedUserId) {
      throw new Error("Forbidden: this invite is for another user");
    }

    // Activate membership
    var now = nhTeamNow_();
    sh.getRange(rowIndex, colStatus).setValue("active");
    sh.getRange(rowIndex, colActivatedAt).setValue(now);
    sh.getRange(rowIndex, colToken).setValue(""); // consume token

    // Ensure user's status -> active if it was invited
    var usersSh = nhEnsureUsersSheet_();
    if (usersSh) {
      var uMap = nhGetHeaderMap_(usersSh.getName());
      var colUid = uMap["userid"];
      var colStatusU = uMap["status"];
      var colUpdated = uMap["updatedat"];
      var uData = usersSh.getDataRange().getValues();
      for (var i = 1; i < uData.length; i++) {
        if (nhTeamStr_(uData[i][colUid - 1]) !== invitedUserId) continue;
        var st = nhTeamStr_(uData[i][colStatusU - 1]).toLowerCase();
        if (st === "invited") usersSh.getRange(i + 1, colStatusU).setValue("active");
        usersSh.getRange(i + 1, colUpdated).setValue(now);
        break;
      }
    }

    return nhOk_({
      message: "Invite accepted",
      workspaceId: workspaceId,
      userId: sess.userId,
      role: nhNormalizeRole_(row[colRole - 1]) || "member"
    });
  });
}

function handleWorkspaceUpdateMemberRole_(payload) {
  return nhSafe_(function() {
    payload = payload || {};

    var workspaceId = nhTeamStr_(payload.workspaceId);
    var targetMemberId = nhTeamStr_(payload.memberId);
    var targetUserId = nhTeamStr_(payload.userId); // optionally
    var newRole = nhNormalizeRole_(payload.role);

    if (!workspaceId) throw new Error("workspaceId is required");
    if (!newRole) throw new Error("role is required (admin/manager/member/viewer)");
    if (!targetMemberId && !targetUserId) throw new Error("memberId or userId is required");

    // Require admin
    var guard = nhRequireWorkspaceRole_(payload.sessionKey, workspaceId, "admin");
    var actorUserId = guard.session.userId;

    var sh = nhEnsureMembersSheet_();
    var map = nhGetHeaderMap_(sh.getName());

    var colMemberId = map["memberid"];
    var colWs = map["workspaceid"];
    var colUser = map["userid"];
    var colRole = map["role"];
    var colStatus = map["status"];

    var data = sh.getDataRange().getValues();
    var rowIndex = -1;
    var rowUserId = "";

    for (var r = 1; r < data.length; r++) {
      if (nhTeamStr_(data[r][colWs - 1]) !== workspaceId) continue;

      var mid = nhTeamStr_(data[r][colMemberId - 1]);
      var uid = nhTeamStr_(data[r][colUser - 1]);

      if (targetMemberId && mid === targetMemberId) { rowIndex = r + 1; rowUserId = uid; break; }
      if (!targetMemberId && targetUserId && uid === targetUserId) { rowIndex = r + 1; rowUserId = uid; break; }
    }

    if (rowIndex === -1) throw new Error("Member not found");

    var st = nhTeamStr_(sh.getRange(rowIndex, colStatus).getValue()).toLowerCase();
    if (st !== "active" && st !== "invited") throw new Error("Cannot change role for status: " + st);

    // Prevent demoting the last admin
    var currentRole = nhNormalizeRole_(sh.getRange(rowIndex, colRole).getValue());
    if (currentRole === "admin" && newRole !== "admin") {
      var adminCount = nhCountActiveAdmins_(workspaceId);
      // If this member is active admin and is the only admin -> block
      if (st === "active" && adminCount <= 1) {
        throw new Error("Cannot demote the last admin in the workspace");
      }
    }

    // Optional: prevent changing your own role (safe default)
    if (rowUserId && rowUserId === actorUserId) {
      throw new Error("Cannot change your own role");
    }

    sh.getRange(rowIndex, colRole).setValue(newRole);

    return nhOk_({
      message: "Role updated",
      workspaceId: workspaceId,
      memberId: targetMemberId || nhTeamStr_(sh.getRange(rowIndex, colMemberId).getValue()),
      userId: rowUserId,
      role: newRole
    });
  });
}

function handleWorkspaceRemoveMember_(payload) {
  return nhSafe_(function() {
    payload = payload || {};

    var workspaceId = nhTeamStr_(payload.workspaceId);
    var targetMemberId = nhTeamStr_(payload.memberId);
    var targetUserId = nhTeamStr_(payload.userId);

    if (!workspaceId) throw new Error("workspaceId is required");
    if (!targetMemberId && !targetUserId) throw new Error("memberId or userId is required");

    // Require admin
    var guard = nhRequireWorkspaceRole_(payload.sessionKey, workspaceId, "admin");
    var actorUserId = guard.session.userId;

    var sh = nhEnsureMembersSheet_();
    var map = nhGetHeaderMap_(sh.getName());

    var colMemberId = map["memberid"];
    var colWs = map["workspaceid"];
    var colUser = map["userid"];
    var colRole = map["role"];
    var colStatus = map["status"];

    var data = sh.getDataRange().getValues();
    var rowIndex = -1;
    var rowUserId = "";
    var rowRole = "";

    for (var r = 1; r < data.length; r++) {
      if (nhTeamStr_(data[r][colWs - 1]) !== workspaceId) continue;

      var mid = nhTeamStr_(data[r][colMemberId - 1]);
      var uid = nhTeamStr_(data[r][colUser - 1]);

      if (targetMemberId && mid === targetMemberId) { rowIndex = r + 1; rowUserId = uid; rowRole = nhNormalizeRole_(data[r][colRole - 1]); break; }
      if (!targetMemberId && targetUserId && uid === targetUserId) { rowIndex = r + 1; rowUserId = uid; rowRole = nhNormalizeRole_(data[r][colRole - 1]); break; }
    }

    if (rowIndex === -1) throw new Error("Member not found");

    // Prevent removing self
    if (rowUserId && rowUserId === actorUserId) {
      throw new Error("Cannot remove yourself");
    }

    var st = nhTeamStr_(sh.getRange(rowIndex, colStatus).getValue()).toLowerCase();
    if (st === "removed") return nhOk_({ message: "Already removed" });

    // Prevent removing the last admin (if target is active admin)
    if (rowRole === "admin" && st === "active") {
      var adminCount = nhCountActiveAdmins_(workspaceId);
      if (adminCount <= 1) throw new Error("Cannot remove the last admin in the workspace");
    }

    sh.getRange(rowIndex, colStatus).setValue("removed");

    return nhOk_({
      message: "Member removed",
      workspaceId: workspaceId,
      memberId: targetMemberId || nhTeamStr_(sh.getRange(rowIndex, colMemberId).getValue()),
      userId: rowUserId
    });
  });
}

function handleWorkspaceRevokeInvite_(payload) {
  return nhSafe_(function() {
    payload = payload || {};

    var workspaceId = nhTeamStr_(payload.workspaceId);
    var targetMemberId = nhTeamStr_(payload.memberId);
    var inviteToken = nhTeamStr_(payload.inviteToken || payload.token);

    if (!workspaceId) throw new Error("workspaceId is required");
    if (!targetMemberId && !inviteToken) throw new Error("memberId or inviteToken is required");

    // Require admin
    nhRequireWorkspaceRole_(payload.sessionKey, workspaceId, "admin");

    var sh = nhEnsureMembersSheet_();
    var map = nhGetHeaderMap_(sh.getName());

    var colMemberId = map["memberid"];
    var colWs = map["workspaceid"];
    var colStatus = map["status"];
    var colToken = map["invitetoken"];

    var data = sh.getDataRange().getValues();
    var rowIndex = -1;

    for (var r = 1; r < data.length; r++) {
      if (nhTeamStr_(data[r][colWs - 1]) !== workspaceId) continue;

      var mid = nhTeamStr_(data[r][colMemberId - 1]);
      var tok = nhTeamStr_(data[r][colToken - 1]);

      if (targetMemberId && mid === targetMemberId) { rowIndex = r + 1; break; }
      if (!targetMemberId && inviteToken && tok === inviteToken) { rowIndex = r + 1; break; }
    }

    if (rowIndex === -1) throw new Error("Invite record not found");

    var st = nhTeamStr_(sh.getRange(rowIndex, colStatus).getValue()).toLowerCase();
    if (st !== "invited" && st !== "pending") throw new Error("Only invited members can be revoked");

    sh.getRange(rowIndex, colStatus).setValue("revoked");
    sh.getRange(rowIndex, colToken).setValue("");

    return nhOk_({
      message: "Invite revoked",
      workspaceId: workspaceId,
      memberId: nhTeamStr_(sh.getRange(rowIndex, colMemberId).getValue())
    });
  });
}
