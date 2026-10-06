import { describe, expect, it, vi } from "vitest";

import {
  createThread,
  registerChatThreadsShareable,
} from "../../chat-threads/store.js";
import { getDbExec } from "../../db/client.js";
import { runWithRequestContext } from "../../server/request-context.js";
import * as runStore from "../run-store.js";
import {
  createAgentHarnessBackgroundAgentController,
  getAgentHarnessBackgroundRun,
  listAgentHarnessBackgroundRuns,
  listAgentHarnessBackgroundTranscriptEvents,
  stopAgentHarnessBackgroundRun,
} from "./background.js";
import { saveAgentHarnessSession } from "./store.js";

describe("exported harness background access", () => {
  it("rechecks a shared conversation before service and controller reads, and restricts controls to the owner", async () => {
    const db = getDbExec();
    const orgId = `harness-org-${crypto.randomUUID()}`;
    const teamId = `harness-team-${crypto.randomUUID()}`;
    const threadId = `harness-thread-${crypto.randomUUID()}`;
    const runId = `harness-run-${crypto.randomUUID()}`;
    const sessionId = `harness-session-${crypto.randomUUID()}`;
    const owner = "owner@example.test";
    const viewer = "viewer@example.test";
    const as = <T>(email: string, fn: () => Promise<T>) =>
      runWithRequestContext({ userEmail: email, orgId }, fn);
    const events = vi.spyOn(runStore, "getRunEventsSince").mockResolvedValue([
      {
        seq: 1,
        eventData: JSON.stringify({ type: "text", text: "private transcript" }),
      },
    ]);
    registerChatThreadsShareable();
    await db.execute({
      sql: "CREATE TABLE IF NOT EXISTS org_members (org_id TEXT, email TEXT, role TEXT DEFAULT 'member', federation_removal_pending_at BIGINT)",
      args: [],
    });
    await db.execute({
      sql: "CREATE TABLE IF NOT EXISTS workspace_user_groups (id TEXT, org_id TEXT, is_team BOOLEAN, member_emails_json TEXT)",
      args: [],
    });
    try {
      for (const email of [owner, viewer]) {
        await db.execute({
          sql: "INSERT INTO org_members (org_id, email) VALUES (?, ?)",
          args: [orgId, email],
        });
      }
      await db.execute({
        sql: "INSERT INTO workspace_user_groups (id, org_id, is_team, member_emails_json) VALUES (?, ?, true, ?)",
        args: [teamId, orgId, JSON.stringify([owner, viewer])],
      });
      await as(owner, () =>
        createThread(owner, { id: threadId, teamGroupId: teamId }),
      );
      await saveAgentHarnessSession({
        id: sessionId,
        harnessName: "test",
        threadId,
        runId,
        ownerEmail: owner,
        orgId,
        status: "idle",
      });
      await db.execute({
        sql: "INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by) VALUES (?, ?, 'group', ?, 'viewer', ?)",
        args: [`share-${sessionId}`, threadId, teamId, owner],
      });
      const read = (email: string, allowed: boolean) =>
        as(email, async () => {
          const scope = { ownerEmail: email, orgId };
          const controller = createAgentHarnessBackgroundAgentController(scope);
          expect(await listAgentHarnessBackgroundRuns(scope)).toHaveLength(
            allowed ? 1 : 0,
          );
          expect(
            Boolean(await getAgentHarnessBackgroundRun(runId, scope)),
          ).toBe(allowed);
          expect(
            await listAgentHarnessBackgroundTranscriptEvents(runId, scope),
          ).toHaveLength(allowed ? 1 : 0);
          expect(await controller.list()).toHaveLength(allowed ? 1 : 0);
          expect(Boolean(await controller.get(runId))).toBe(allowed);
          expect(await controller.transcript(runId)).toHaveLength(
            allowed ? 1 : 0,
          );
        });
      await read(owner, true);
      await read(viewer, true);
      await as(viewer, async () => {
        const scope = { ownerEmail: viewer, orgId };
        expect(await stopAgentHarnessBackgroundRun(runId, scope)).toMatchObject(
          { ok: false },
        );
        const controller = createAgentHarnessBackgroundAgentController(scope);
        expect(
          await controller.sendFollowUp({ runId, prompt: "no" }),
        ).toMatchObject({ ok: false });
        expect(
          await controller.control({ runId, command: "stop" }),
        ).toMatchObject({ ok: false });
        expect(
          await controller.control({ runId, command: "approve" }),
        ).toMatchObject({ ok: false });
      });
      await as(owner, async () => {
        expect(
          await createAgentHarnessBackgroundAgentController({
            ownerEmail: owner,
            orgId,
          }).control({ runId, command: "stop" }),
        ).toMatchObject({ ok: true });
      });
      await db.execute({
        sql: "DELETE FROM chat_thread_shares WHERE resource_id = ?",
        args: [threadId],
      });
      events.mockClear();
      await read(viewer, false);
      expect(events).not.toHaveBeenCalled();
      await db.execute({
        sql: "INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by) VALUES (?, ?, 'group', ?, 'viewer', ?)",
        args: [`restored-${sessionId}`, threadId, teamId, owner],
      });
      await db.execute({
        sql: "UPDATE workspace_user_groups SET member_emails_json = ? WHERE id = ?",
        args: [JSON.stringify([owner]), teamId],
      });
      await read(viewer, false);
      await db.execute({
        sql: "DELETE FROM org_members WHERE org_id = ? AND email = ?",
        args: [orgId, owner],
      });
      await read(owner, false);
      await as(owner, async () => {
        const scope = { ownerEmail: owner, orgId };
        expect(await stopAgentHarnessBackgroundRun(runId, scope)).toMatchObject(
          { ok: false },
        );
        expect(
          await createAgentHarnessBackgroundAgentController(scope).control({
            runId,
            command: "approve",
          }),
        ).toMatchObject({ ok: false });
      });
      await db.execute({
        sql: "DELETE FROM workspace_user_groups WHERE id = ?",
        args: [teamId],
      });
      await read(viewer, false);
      await db.execute({
        sql: "DELETE FROM chat_threads WHERE id = ?",
        args: [threadId],
      });
      await read(owner, false);
      expect(
        await stopAgentHarnessBackgroundRun(runId, {
          ownerEmail: owner,
          orgId,
        }),
      ).toMatchObject({ ok: false });
    } finally {
      vi.restoreAllMocks();
      await db.execute({
        sql: "DELETE FROM chat_thread_shares WHERE resource_id = ?",
        args: [threadId],
      });
      await db.execute({
        sql: "DELETE FROM agent_harness_sessions WHERE id = ?",
        args: [sessionId],
      });
      await db.execute({
        sql: "DELETE FROM chat_threads WHERE id = ?",
        args: [threadId],
      });
      await db.execute({
        sql: "DELETE FROM workspace_user_groups WHERE id = ?",
        args: [teamId],
      });
      await db.execute({
        sql: "DELETE FROM org_members WHERE org_id = ?",
        args: [orgId],
      });
    }
  });
});
