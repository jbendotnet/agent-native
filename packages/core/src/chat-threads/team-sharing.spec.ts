import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { callerHasThreadAccess } from "../agent/run-ownership.js";
import { AGENT_AUDIT_LOG_CREATE_SQL } from "../audit/store.js";
import { withDbExec, type DbExec } from "../db/client.js";
import { runWithRequestContext } from "../server/request-context.js";
import setResourceVisibility from "../sharing/actions/set-resource-visibility.js";
import shareResource from "../sharing/actions/share-resource.js";
import unshareResource from "../sharing/actions/unshare-resource.js";
import deleteGroup from "../workspace-connections/actions/delete-workspace-user-group.js";
import { upsertWorkspaceUserGroup } from "../workspace-connections/groups.js";
import listTeamShared from "./actions/list-team-shared-chat-threads.js";
import shareTeam from "./actions/share-chat-thread-with-team.js";
import unshareTeam from "./actions/unshare-chat-thread-from-team.js";
import {
  createThread,
  createThreadShareLink,
  deleteThread,
  getThreadByShareToken,
  registerChatThreadsShareable,
  resolveThreadAccess,
} from "./store.js";

const orgId = "org-example";
const owner = "owner@example.com";
const viewer = "viewer@example.com";
const outsider = "outsider@example.com";

describe("chat team sharing", () => {
  let pg: Awaited<ReturnType<typeof createTestPglite>>;
  let exec: DbExec;

  const as = <T>(email: string, fn: () => Promise<T>, activeOrg = orgId) =>
    runWithRequestContext({ userEmail: email, orgId: activeOrg }, () =>
      withDbExec(exec, fn),
    );

  const grant = (threadId: string, teamGroupId = "team-1") =>
    as(owner, () =>
      shareTeam.run({ threadId, teamGroupId }, { userEmail: owner, orgId }),
    );

  const list = (teamGroupId = "team-1", limit = 25, offset = 0) =>
    as(viewer, () =>
      listTeamShared.run(
        { teamGroupId, limit, offset },
        { userEmail: viewer, orgId },
      ),
    );

  beforeEach(async () => {
    pg = await createTestPglite();
    const execute: DbExec["execute"] = async (statement) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : (statement.args ?? []);
      const result = await pg.query(sql, args);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    };
    exec = {
      execute,
      transaction: (fn) =>
        pg.db.transaction((tx) =>
          fn({
            execute: async (statement) => {
              const sql =
                typeof statement === "string" ? statement : statement.sql;
              const args =
                typeof statement === "string" ? [] : (statement.args ?? []);
              let index = 0;
              const result = await tx.query(
                sql.replace(/\?/g, () => `$${++index}`),
                args,
              );
              return {
                rows: result.rows,
                rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
              };
            },
          }),
        ),
    };
    await pg.exec(`
      CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT);
      CREATE TABLE org_members (id TEXT PRIMARY KEY, org_id TEXT, email TEXT, role TEXT, joined_at BIGINT, federation_removal_pending_at BIGINT);
      CREATE TABLE workspace_user_groups (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT, member_emails_json TEXT NOT NULL, is_team BOOLEAN NOT NULL DEFAULT false, lead_emails_json TEXT NOT NULL DEFAULT '[]', created_by_email TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0);
      CREATE TABLE org_invitations (id TEXT PRIMARY KEY, org_id TEXT, email TEXT, status TEXT);
      CREATE TABLE chat_threads (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', thread_data TEXT NOT NULL DEFAULT '{}', message_count BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, scope_type TEXT, scope_id TEXT, scope_label TEXT, pinned_at BIGINT, archived_at BIGINT, share_token_hash TEXT, source_platform TEXT, source_app_id TEXT, source_url TEXT, org_id TEXT, team_group_id TEXT, visibility TEXT NOT NULL DEFAULT 'private');
      CREATE TABLE chat_thread_shares (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', created_by TEXT NOT NULL, created_at TEXT NOT NULL, notified_at TEXT);
      INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ('m-owner', '${orgId}', '${owner}', 'member', 1), ('m-viewer', '${orgId}', '${viewer}', 'member', 1), ('m-outsider', '${orgId}', '${outsider}', 'admin', 1);
      INSERT INTO workspace_user_groups (id, org_id, name, member_emails_json, is_team) VALUES ('team-1', '${orgId}', 'Team 1', '["${owner}","${viewer}"]', true), ('team-2', '${orgId}', 'Team 2', '["${owner}","${viewer}"]', true), ('ordinary', '${orgId}', 'Ordinary', '["${owner}","${viewer}"]', false), ('other-org', 'other-org', 'Other', '["${owner}"]', true);
    `);
    await pg.exec(AGENT_AUDIT_LOG_CREATE_SQL);
    await as(owner, async () => {
      registerChatThreadsShareable();
      await createThread(owner, { id: "unbound", orgId });
      await createThread(owner, { id: "bound", orgId, teamGroupId: "team-1" });
      await createThread(owner, { id: "second", orgId });
      await pg.query(
        "UPDATE chat_threads SET message_count = 1 WHERE id IN ('unbound', 'bound', 'second')",
      );
    });
  });

  afterEach(async () => pg.close());

  it("grants one viewer team without changing binding or non-team shares, then revokes", async () => {
    await as(owner, () =>
      shareResource.run(
        {
          resourceType: "chat_thread",
          resourceId: "unbound",
          principalType: "group",
          principalId: "ordinary",
          role: "editor",
          notify: false,
        },
        { userEmail: owner, orgId },
      ),
    );
    expect(await list()).toMatchObject({ threads: [] });
    await expect(
      as(viewer, () =>
        resolveThreadAccess(viewer, "bound", "viewer", { orgId }),
      ),
    ).resolves.toBeNull();
    expect(await grant("unbound")).toMatchObject({ shared: true });
    expect(await grant("unbound")).toMatchObject({ shared: true });
    expect(
      (
        await pg.query(
          "SELECT team_group_id FROM chat_threads WHERE id = 'unbound'",
        )
      ).rows[0]?.team_group_id,
    ).toBeNull();
    expect(
      (
        await pg.query(
          "SELECT principal_id FROM chat_thread_shares WHERE resource_id = 'unbound' ORDER BY principal_id",
        )
      ).rows.map((row) => row.principal_id),
    ).toEqual(["ordinary", "team-1"]);
    expect((await list()).threads.map((thread) => thread.id)).toEqual([
      "unbound",
    ]);
    await grant("bound");
    await expect(
      as(viewer, () =>
        resolveThreadAccess(viewer, "bound", "editor", { orgId }),
      ),
    ).resolves.toBeNull();
    await as(owner, () =>
      unshareTeam.run(
        { threadId: "unbound", teamGroupId: "team-1" },
        { userEmail: owner, orgId },
      ),
    );
    expect((await list()).threads.map((thread) => thread.id)).toEqual([
      "bound",
    ]);
    expect(
      (
        await pg.query(
          "SELECT principal_id FROM chat_thread_shares WHERE resource_id = 'unbound'",
        )
      ).rows[0]?.principal_id,
    ).toBe("ordinary");
  });

  it("serializes competing team recipients and keeps the first grant", async () => {
    const outcomes = await Promise.allSettled([
      grant("unbound", "team-1"),
      grant("unbound", "team-2"),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (
        await pg.query(
          "SELECT principal_id FROM chat_thread_shares WHERE resource_id = 'unbound'",
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("does not accept a caller-supplied team role", () => {
    for (const role of ["viewer", "commenter", "editor", "admin"]) {
      expect(
        shareTeam.schema.safeParse({
          threadId: "unbound",
          teamGroupId: "team-1",
          role,
        }).success,
      ).toBe(false);
    }
  });

  it("keeps converted group grants read-only and prevents a second team recipient", async () => {
    await as(owner, () =>
      shareResource.run(
        {
          resourceType: "chat_thread",
          resourceId: "unbound",
          principalType: "group",
          principalId: "ordinary",
          role: "admin",
          notify: false,
        },
        { userEmail: owner, orgId },
      ),
    );
    await pg.query("UPDATE org_members SET role = 'owner' WHERE email = ?", [
      owner,
    ]);
    await as(owner, () =>
      upsertWorkspaceUserGroup({
        id: "ordinary",
        name: "Ordinary",
        memberEmails: [owner, viewer],
        isTeam: true,
      }),
    );
    expect(
      await as(viewer, () =>
        callerHasThreadAccess(viewer, "unbound", "viewer", { orgId }),
      ),
    ).toBe(true);
    expect(
      await as(viewer, () =>
        callerHasThreadAccess(viewer, "unbound", "editor", { orgId }),
      ),
    ).toBe(false);
    expect((await list("ordinary")).threads.map((thread) => thread.id)).toEqual(
      ["unbound"],
    );
    await expect(grant("unbound", "team-1")).rejects.toThrow();
  });

  it("rejects converting a second shared group into a team without dropping its grants", async () => {
    await grant("unbound");
    await as(owner, () =>
      shareResource.run(
        {
          resourceType: "chat_thread",
          resourceId: "unbound",
          principalType: "group",
          principalId: "ordinary",
          role: "viewer",
          notify: false,
        },
        { userEmail: owner, orgId },
      ),
    );
    await pg.query("UPDATE org_members SET role = 'owner' WHERE email = ?", [
      owner,
    ]);
    await expect(
      as(owner, () =>
        upsertWorkspaceUserGroup({
          id: "ordinary",
          name: "Ordinary",
          memberEmails: [owner, viewer],
          isTeam: true,
        }),
      ),
    ).rejects.toThrow(
      "Convert only after removing conflicting conversation team shares.",
    );
    expect(
      (
        await pg.query(
          "SELECT is_team FROM workspace_user_groups WHERE id = 'ordinary'",
        )
      ).rows[0]?.is_team,
    ).toBe(false);
    expect(
      (
        await pg.query(
          "SELECT principal_id FROM chat_thread_shares WHERE resource_id = 'unbound'",
        )
      ).rows,
    ).toHaveLength(2);
  });

  it("keeps unbound public links and linked-run reads without viewer controls", async () => {
    const link = await as(owner, () =>
      createThreadShareLink("unbound", { ownerEmail: owner }),
    );
    expect(link?.token).toBeTruthy();
    await grant("unbound");
    expect(
      (await as(owner, () => getThreadByShareToken(link!.token)))?.id,
    ).toBe("unbound");
    expect(
      await as(viewer, () =>
        callerHasThreadAccess(viewer, "unbound", "viewer", { orgId }),
      ),
    ).toBe(true);
    expect(
      await as(viewer, () =>
        callerHasThreadAccess(viewer, "unbound", "owner", { orgId }),
      ),
    ).toBe(false);
    await as(owner, () =>
      unshareTeam.run(
        { threadId: "unbound", teamGroupId: "team-1" },
        { userEmail: owner, orgId },
      ),
    );
    expect(
      (await as(owner, () => getThreadByShareToken(link!.token)))?.id,
    ).toBe("unbound");
  });

  it("closes generic sharing and visibility bypasses for bound conversations", async () => {
    await expect(
      as(owner, () =>
        shareResource.run(
          {
            resourceType: "chat_thread",
            resourceId: "bound",
            principalType: "group",
            principalId: "ordinary",
            role: "viewer",
            notify: false,
          },
          { userEmail: owner, orgId },
        ),
      ),
    ).rejects.toThrow("Bound conversations can only be shared");
    await expect(
      as(owner, () =>
        shareResource.run(
          {
            resourceType: "chat_thread",
            resourceId: "bound",
            principalType: "user",
            principalId: viewer,
            role: "admin",
            notify: false,
          },
          { userEmail: owner, orgId },
        ),
      ),
    ).rejects.toThrow("Bound conversations can only be shared");
    await expect(
      as(owner, () =>
        setResourceVisibility.run(
          {
            resourceType: "chat_thread",
            resourceId: "bound",
            visibility: "org",
          },
          { userEmail: owner, orgId },
        ),
      ),
    ).rejects.toThrow("Bound conversations cannot be made visible");
    expect((await list()).threads).toEqual([]);
  });

  it("does not let legacy resource admins or departed owners manage bound grants", async () => {
    await pg.query(
      "INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by, created_at) VALUES ('legacy-admin', 'bound', 'user', ?, 'admin', ?, '2026-01-01')",
      [outsider, owner],
    );
    await expect(
      as(outsider, () =>
        unshareResource.run(
          {
            resourceType: "chat_thread",
            resourceId: "bound",
            principalType: "user",
            principalId: outsider,
          },
          { userEmail: outsider, orgId },
        ),
      ),
    ).rejects.toThrow("Only the current owner");
    await expect(
      as(outsider, () =>
        setResourceVisibility.run(
          {
            resourceType: "chat_thread",
            resourceId: "bound",
            visibility: "private",
          },
          { userEmail: outsider, orgId },
        ),
      ),
    ).rejects.toThrow();
    await pg.query(
      "UPDATE workspace_user_groups SET member_emails_json = ? WHERE id = 'team-1'",
      [JSON.stringify([viewer])],
    );
    await expect(
      as(owner, () =>
        unshareResource.run(
          {
            resourceType: "chat_thread",
            resourceId: "bound",
            principalType: "user",
            principalId: outsider,
          },
          { userEmail: owner, orgId },
        ),
      ),
    ).rejects.toThrow("Only the current owner");
  });

  it("allows shared viewers after the bound owner departs, without giving them management", async () => {
    await grant("bound");
    await pg.query(
      "UPDATE workspace_user_groups SET member_emails_json = ? WHERE id = 'team-1'",
      [JSON.stringify([viewer])],
    );
    expect(
      await as(owner, () =>
        callerHasThreadAccess(owner, "bound", "viewer", { orgId }),
      ),
    ).toBe(false);
    expect(
      await as(viewer, () =>
        callerHasThreadAccess(viewer, "bound", "viewer", { orgId }),
      ),
    ).toBe(true);
    expect(
      await as(viewer, () =>
        callerHasThreadAccess(viewer, "bound", "editor", { orgId }),
      ),
    ).toBe(false);
    expect((await list()).threads.map((thread) => thread.id)).toEqual([
      "bound",
    ]);
    await expect(
      as(owner, () =>
        unshareTeam.run(
          { threadId: "bound", teamGroupId: "team-1" },
          { userEmail: owner, orgId },
        ),
      ),
    ).rejects.toThrow();
  });

  it("rejects generic team grants/revokes, invalid targets, nonowners and owner departure", async () => {
    await expect(
      as(owner, () =>
        shareResource.run(
          {
            resourceType: "chat_thread",
            resourceId: "unbound",
            principalType: "group",
            principalId: "team-1",
            role: "admin",
            notify: false,
          },
          { userEmail: owner, orgId },
        ),
      ),
    ).rejects.toThrow();
    await expect(grant("bound", "team-2")).rejects.toThrow();
    await expect(grant("unbound", "ordinary")).rejects.toThrow();
    await expect(grant("unbound", "other-org")).rejects.toThrow();
    await expect(
      as(viewer, () =>
        shareTeam.run(
          { threadId: "unbound", teamGroupId: "team-1" },
          { userEmail: viewer, orgId },
        ),
      ),
    ).rejects.toThrow();
    await grant("unbound");
    await as(owner, () =>
      shareResource.run(
        {
          resourceType: "chat_thread",
          resourceId: "unbound",
          principalType: "user",
          principalId: outsider,
          role: "admin",
          notify: false,
        },
        { userEmail: owner, orgId },
      ),
    );
    await expect(
      as(outsider, () =>
        shareResource.run(
          {
            resourceType: "chat_thread",
            resourceId: "unbound",
            principalType: "group",
            principalId: "team-1",
            role: "viewer",
            notify: false,
          },
          { userEmail: outsider, orgId },
        ),
      ),
    ).rejects.toThrow();
    await expect(
      as(outsider, () =>
        unshareResource.run(
          {
            resourceType: "chat_thread",
            resourceId: "unbound",
            principalType: "group",
            principalId: "team-1",
          },
          { userEmail: outsider, orgId },
        ),
      ),
    ).rejects.toThrow();
    expect(
      (
        await pg.query(
          "SELECT role FROM chat_thread_shares WHERE resource_id = 'unbound' AND principal_id = 'team-1'",
        )
      ).rows[0]?.role,
    ).toBe("viewer");
    await expect(
      as(owner, () =>
        unshareResource.run(
          {
            resourceType: "chat_thread",
            resourceId: "unbound",
            principalType: "group",
            principalId: "team-1",
          },
          { userEmail: owner, orgId },
        ),
      ),
    ).rejects.toThrow();
    await pg.query(
      "UPDATE workspace_user_groups SET member_emails_json = ? WHERE id = 'team-1'",
      [JSON.stringify([viewer])],
    );
    await expect(grant("unbound")).rejects.toThrow();
    await expect(
      as(owner, () =>
        unshareTeam.run(
          { threadId: "unbound", teamGroupId: "team-1" },
          { userEmail: owner, orgId },
        ),
      ),
    ).rejects.toThrow();
  });

  it("pages explicit grants and rechecks membership and deletion", async () => {
    await grant("unbound");
    await grant("second");
    expect((await list("team-1", 1, 0)).threads).toHaveLength(1);
    expect((await list("team-1", 1, 0)).nextOffset).toBe(1);
    expect((await list("team-1", 1, 1)).nextOffset).toBeNull();
    await pg.query(
      "UPDATE workspace_user_groups SET member_emails_json = ? WHERE id = 'team-1'",
      [JSON.stringify([owner])],
    );
    await expect(list()).rejects.toThrow();
    await pg.query(
      "UPDATE workspace_user_groups SET member_emails_json = ? WHERE id = 'team-1'",
      [JSON.stringify([owner, viewer])],
    );
    await pg.query("DELETE FROM org_members WHERE email = ?", [viewer]);
    await expect(list()).rejects.toThrow();
    await expect(
      as(viewer, () =>
        resolveThreadAccess(viewer, "second", "viewer", { orgId }),
      ),
    ).resolves.toBeNull();
    await pg.query(
      "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ('m-viewer', ?, ?, 'member', 1)",
      [orgId, viewer],
    );
    await as(owner, () => deleteThread("unbound", owner));
    expect((await list()).threads.map((thread) => thread.id)).toEqual([
      "second",
    ]);
    await pg.query("DELETE FROM workspace_user_groups WHERE id = 'team-1'");
    await expect(list()).rejects.toThrow();
  });

  it("retains bound data after team deletion while unbound owner access survives a stale grant", async () => {
    await grant("bound");
    await grant("unbound");
    await pg.query("UPDATE org_members SET role = 'owner' WHERE email = ?", [
      owner,
    ]);
    const before = (
      await pg.query(
        "SELECT id, owner_email, team_group_id, thread_data FROM chat_threads WHERE id IN ('bound', 'unbound') ORDER BY id",
      )
    ).rows;
    expect(before).toMatchObject([
      { id: "bound", team_group_id: "team-1" },
      { id: "unbound", team_group_id: null },
    ]);

    expect(
      await as(owner, () =>
        deleteGroup.run({ id: "team-1" }, { userEmail: owner, orgId }),
      ),
    ).toEqual({ id: "team-1", deleted: true });
    expect(
      (
        await pg.query(
          "SELECT id, owner_email, team_group_id, thread_data FROM chat_threads WHERE id IN ('bound', 'unbound') ORDER BY id",
        )
      ).rows,
    ).toEqual(before);
    expect(
      await as(owner, () =>
        resolveThreadAccess(owner, "bound", "viewer", { orgId }),
      ),
    ).toBeNull();
    expect(
      await as(viewer, () =>
        resolveThreadAccess(viewer, "bound", "viewer", { orgId }),
      ),
    ).toBeNull();
    expect(
      await as(owner, () =>
        resolveThreadAccess(owner, "unbound", "owner", { orgId }),
      ),
    ).toMatchObject({ id: "unbound", teamGroupId: null });
    expect(
      await as(viewer, () =>
        resolveThreadAccess(viewer, "unbound", "viewer", { orgId }),
      ),
    ).toBeNull();
    expect(
      (
        await pg.query(
          "SELECT principal_id FROM chat_thread_shares WHERE resource_id = 'bound'",
        )
      ).rows,
    ).toEqual([{ principal_id: "team-1" }]);
    await expect(
      as(owner, () =>
        upsertWorkspaceUserGroup({
          id: "team-1",
          name: "Team 1",
          memberEmails: [owner],
          isTeam: true,
        }),
      ),
    ).rejects.toThrow(/not found/);
    const replacement = await as(owner, () =>
      upsertWorkspaceUserGroup({
        name: "Team 1",
        memberEmails: [owner],
        isTeam: true,
      }),
    );
    expect(replacement.id).not.toBe("team-1");
    expect(
      await as(owner, () =>
        resolveThreadAccess(owner, "bound", "viewer", { orgId }),
      ),
    ).toBeNull();
  });
});
