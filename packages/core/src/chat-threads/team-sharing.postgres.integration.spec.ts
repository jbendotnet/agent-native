import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import shareResource from "../sharing/actions/share-resource.js";
import unshareResource from "../sharing/actions/unshare-resource.js";
import { upsertWorkspaceUserGroup } from "../workspace-connections/groups.js";
import shareTeam from "./actions/share-chat-thread-with-team.js";
import { createThread, registerChatThreadsShareable } from "./store.js";

const url = process.env.TEST_CHAT_SHARING_POSTGRES_URL;
const localOnly =
  url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const integration = localOnly ? describe : describe.skip;

integration("chat team sharing with independent PostgreSQL connections", () => {
  const observer = postgres(url!, { max: 1 });
  const blocker = postgres(url!, { max: 1 });
  const suffix = randomUUID();
  const orgId = `sharing-org-${suffix}`;
  const owner = `sharing-owner-${suffix}@example.test`;
  const teamId = `sharing-team-${suffix}`;
  const groupId = `sharing-group-${suffix}`;
  const convertingGroupId = `sharing-converting-${suffix}`;
  const threadId = `sharing-thread-${suffix}`;
  const otherThreadId = `sharing-other-${suffix}`;

  const asOwner = <T>(run: () => Promise<T>) =>
    runWithRequestContext({ userEmail: owner, orgId }, run);

  const waitForLock = async (query: string) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await observer.unsafe(
        `SELECT pid FROM pg_stat_activity WHERE datname = current_database()
         AND wait_event_type = 'Lock' AND query ILIKE $1`,
        [`%${query}%`],
      );
      if (rows.length) return Number(rows[0].pid);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`No independent PostgreSQL connection blocked on ${query}`);
  };

  const shareOrdinary = (target = groupId, resourceId = threadId) =>
    asOwner(() =>
      shareResource.run(
        {
          resourceType: "chat_thread",
          resourceId,
          principalType: "group",
          principalId: target,
          role: "viewer",
          notify: false,
        },
        { userEmail: owner, orgId },
      ),
    );
  const revokeOrdinary = () =>
    asOwner(() =>
      unshareResource.run(
        {
          resourceType: "chat_thread",
          resourceId: threadId,
          principalType: "group",
          principalId: groupId,
        },
        { userEmail: owner, orgId },
      ),
    );
  const convert = (target = groupId) =>
    asOwner(() =>
      upsertWorkspaceUserGroup({
        id: target,
        name: target === convertingGroupId ? "Converting" : "Ordinary",
        memberEmails: [owner],
        isTeam: true,
      }),
    );

  const blockShareWrites = async () => {
    let release!: () => void;
    let ready!: () => void;
    let blockerPid!: number;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const pending = blocker.begin(async (tx) => {
      await tx.unsafe("LOCK TABLE chat_thread_shares IN SHARE MODE");
      const [session] = await tx.unsafe("SELECT pg_backend_pid() AS pid");
      blockerPid = Number(session.pid);
      ready();
      await released;
    });
    await acquired;
    return { release, pending, blockerPid };
  };

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== url) {
      throw new Error(
        "Point DATABASE_URL and TEST_CHAT_SHARING_POSTGRES_URL at the same disposable local PostgreSQL database.",
      );
    }
    await observer.unsafe(`
      CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT);
      CREATE TABLE IF NOT EXISTS org_members (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL, federation_removal_pending_at BIGINT);
      CREATE TABLE IF NOT EXISTS workspace_user_groups (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT, member_emails_json TEXT NOT NULL DEFAULT '[]', is_team BOOLEAN NOT NULL DEFAULT false, lead_emails_json TEXT NOT NULL DEFAULT '[]', created_by_email TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS org_invitations (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL);
    `);
    await observer.unsafe(
      "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, 'Sharing test', $2, 1)",
      [orgId, owner],
    );
    await observer.unsafe(
      "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, 'owner', 1)",
      [`member-${suffix}`, orgId, owner],
    );
    await observer.unsafe(
      "INSERT INTO workspace_user_groups (id, org_id, name, member_emails_json, is_team) VALUES ($1, $4, 'Team', $5, true), ($2, $4, 'Ordinary', $5, false), ($3, $4, 'Converting', $5, false)",
      [teamId, groupId, convertingGroupId, orgId, JSON.stringify([owner])],
    );
    await asOwner(async () => {
      registerChatThreadsShareable();
      await createThread(owner, { id: threadId, orgId });
      await createThread(owner, { id: otherThreadId, orgId });
      await shareTeam.run(
        { threadId, teamGroupId: teamId },
        { userEmail: owner, orgId },
      );
      await upsertWorkspaceUserGroup({
        id: groupId,
        name: "Ordinary",
        memberEmails: [owner],
        isTeam: false,
      });
    });
  });

  afterAll(async () => {
    await blocker.end();
    await observer.end();
  });

  it("blocks conversion behind a generic grant and rejects a second team", async () => {
    const held = await blockShareWrites();
    let grant: Promise<unknown> | undefined;
    let conversion: Promise<unknown> | undefined;
    try {
      grant = shareOrdinary();
      const grantPid = await waitForLock("chat_thread_shares");
      expect(grantPid).not.toBe(held.blockerPid);
      conversion = convert();
      const conversionPid = await waitForLock("workspace_user_groups");
      expect(conversionPid).not.toBe(grantPid);
      expect(conversionPid).not.toBe(held.blockerPid);
    } finally {
      held.release();
      await held.pending;
    }
    await expect(grant).resolves.toBeDefined();
    await expect(conversion).rejects.toThrow(
      "conflicting conversation team shares",
    );
    const [group] = await observer.unsafe(
      "SELECT is_team FROM workspace_user_groups WHERE id = $1",
      [groupId],
    );
    expect(group?.is_team).toBe(false);
    const shares = await observer.unsafe(
      "SELECT principal_id FROM chat_thread_shares WHERE resource_id = $1 AND principal_type = 'group'",
      [threadId],
    );
    expect(shares.map((row) => row.principal_id).sort()).toEqual(
      [groupId, teamId].sort(),
    );
  });

  it("blocks conversion behind a generic revoke, then converts without a grant", async () => {
    const held = await blockShareWrites();
    let revoke: Promise<unknown> | undefined;
    let conversion: Promise<unknown> | undefined;
    try {
      revoke = revokeOrdinary();
      const revokePid = await waitForLock("chat_thread_shares");
      expect(revokePid).not.toBe(held.blockerPid);
      conversion = convert();
      const conversionPid = await waitForLock("workspace_user_groups");
      expect(conversionPid).not.toBe(revokePid);
      expect(conversionPid).not.toBe(held.blockerPid);
    } finally {
      held.release();
      await held.pending;
    }
    await expect(revoke).resolves.toBeDefined();
    await expect(conversion).resolves.toMatchObject({ isTeam: true });
    await expect(revokeOrdinary()).rejects.toThrow(
      "unshare-chat-thread-from-team",
    );
    const shares = await observer.unsafe(
      "SELECT principal_id FROM chat_thread_shares WHERE resource_id = $1 AND principal_type = 'group'",
      [threadId],
    );
    expect(shares.map((row) => row.principal_id)).toEqual([teamId]);
  });

  it("rechecks the marked team after conversion wins the group lock", async () => {
    await shareOrdinary(convertingGroupId, otherThreadId);
    let release!: () => void;
    let ready!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = blocker.begin(async (tx) => {
      await tx.unsafe("SELECT id FROM chat_threads WHERE id = $1 FOR UPDATE", [
        otherThreadId,
      ]);
      ready();
      await released;
    });
    await acquired;
    let conversion: Promise<unknown> | undefined;
    let grant: Promise<unknown> | undefined;
    try {
      conversion = convert(convertingGroupId);
      const conversionPid = await waitForLock("chat_threads");
      grant = shareOrdinary(convertingGroupId);
      const grantPid = await waitForLock("workspace_user_groups");
      expect(grantPid).not.toBe(conversionPid);
    } finally {
      release();
      await held;
    }
    await expect(conversion).resolves.toMatchObject({ isTeam: true });
    await expect(grant).rejects.toThrow(
      "Share conversations with a team through share-chat-thread-with-team",
    );
    const shares = await observer.unsafe(
      "SELECT principal_id FROM chat_thread_shares WHERE resource_id = $1 AND principal_type = 'group'",
      [threadId],
    );
    expect(shares.map((row) => row.principal_id)).toEqual([teamId]);
  });
});
