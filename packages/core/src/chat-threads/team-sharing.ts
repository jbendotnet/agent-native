import crypto from "node:crypto";

import { fail } from "../action.js";
import {
  getDbExec,
  getScopedDbExec,
  withDbExec,
  type DbExec,
} from "../db/client.js";
import { invalidateCollabAccessCache } from "../server/poll.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  ensureWorkspaceUserGroupsTable,
  getWorkspaceTeamForMember,
} from "../workspace-connections/groups.js";
import {
  chatThreadAccessSql,
  chatThreadSummaryFromRow,
  ensureChatThreadTables,
  type ChatThreadSummary,
} from "./store.js";

export async function withChatThreadGroupMutationLock<T>(
  threadId: string,
  groupId: string,
  run: (tx: DbExec) => Promise<T>,
): Promise<T> {
  await ensureChatThreadTables();
  await ensureWorkspaceUserGroupsTable();
  const locked = async (tx: DbExec): Promise<T> => {
    await tx.execute({
      sql: "SELECT id FROM workspace_user_groups WHERE id = ? FOR UPDATE",
      args: [groupId],
    });
    await tx.execute({
      // guard:allow-unscoped — lock one opaque thread id; callers recheck authorization inside this transaction before any mutation
      sql: "SELECT id FROM chat_threads WHERE id = ? FOR UPDATE",
      args: [threadId],
    });
    return run(tx);
  };
  const scoped = getScopedDbExec();
  if (scoped && !scoped.transaction) return locked(scoped);
  const db = getDbExec();
  if (!db.transaction)
    throw new Error("Chat group sharing requires database transactions.");
  return db.transaction((tx) => withDbExec(tx, () => locked(tx)));
}

export async function changeChatThreadTeamShare(
  threadId: string,
  teamGroupId: string,
  operation: "share" | "unshare",
): Promise<{ threadId: string; teamGroupId: string; shared: boolean }> {
  const email = getRequestUserEmail();
  const orgId = getRequestOrgId();
  if (!email || !orgId)
    fail("Current organization membership is required.", { statusCode: 403 });
  const changed = await withChatThreadGroupMutationLock(
    threadId,
    teamGroupId,
    async (tx) => {
      const {
        rows: [thread],
      } = await tx.execute({
        sql: `SELECT owner_email, org_id, team_group_id FROM chat_threads WHERE id = ?`,
        args: [threadId],
      });
      if (
        !thread ||
        thread.org_id !== orgId ||
        String(thread.owner_email).trim().toLowerCase() !==
          email.trim().toLowerCase() ||
        (thread.team_group_id && thread.team_group_id !== teamGroupId) ||
        !(await getWorkspaceTeamForMember(orgId, teamGroupId, email))
      ) {
        fail("Only the current owner and team member may change this share.", {
          statusCode: 403,
        });
      }
      const { rows: existing } = await tx.execute({
        sql: `SELECT s.id, s.principal_id, s.role FROM chat_thread_shares s JOIN workspace_user_groups g ON g.id = s.principal_id AND g.org_id = ? AND g.is_team = true WHERE s.resource_id = ? AND s.principal_type = 'group' FOR UPDATE OF s`,
        args: [orgId, threadId],
      });
      if (existing.some((row) => row.principal_id !== teamGroupId)) {
        fail("This conversation is already shared with another team.", {
          statusCode: 409,
        });
      }
      const same = existing[0];
      if (operation === "share") {
        if (same && same.role !== "viewer") {
          fail("An existing team grant must be viewer-only.", {
            statusCode: 409,
          });
        }
        if (same) return false;
        await tx.execute({
          sql: `INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by, created_at) VALUES (?, ?, 'group', ?, 'viewer', ?, ?)`,
          args: [
            crypto.randomUUID(),
            threadId,
            teamGroupId,
            email,
            new Date().toISOString(),
          ],
        });
        return true;
      }
      if (!same) return false;
      await tx.execute({
        sql: `DELETE FROM chat_thread_shares WHERE id = ?`,
        args: [same.id],
      });
      return true;
    },
  );
  if (changed) invalidateCollabAccessCache("chat_thread", threadId);
  return { threadId, teamGroupId, shared: operation === "share" };
}

export async function listTeamSharedChatThreads(
  teamGroupId: string,
  limit: number,
  offset: number,
): Promise<{ threads: ChatThreadSummary[]; nextOffset: number | null }> {
  const email = getRequestUserEmail();
  const orgId = getRequestOrgId();
  if (
    !email ||
    !orgId ||
    !(await getWorkspaceTeamForMember(orgId, teamGroupId, email))
  ) {
    fail("Current team and organization membership is required.", {
      statusCode: 403,
    });
  }
  await ensureChatThreadTables();
  const access = chatThreadAccessSql(email, orgId);
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, title, preview, message_count, created_at, updated_at, scope_type, scope_id, scope_label, pinned_at, archived_at, source_platform, source_app_id, source_url, org_id, team_group_id, visibility FROM chat_threads WHERE org_id = ? AND message_count > 0 AND ${access.sql} AND EXISTS (SELECT 1 FROM chat_thread_shares s WHERE s.resource_id = chat_threads.id AND s.principal_type = 'group' AND s.principal_id = ?) ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
    args: [orgId, ...access.args, teamGroupId, limit + 1, offset],
  });
  return {
    threads: rows
      .slice(0, limit)
      .map(chatThreadSummaryFromRow)
      .filter((row): row is ChatThreadSummary => row !== null),
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}
