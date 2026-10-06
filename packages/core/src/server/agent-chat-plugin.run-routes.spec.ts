import { createApp, type EventHandler } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { saveAgentHarnessSession } from "../agent/harness/store.js";
import { startRun } from "../agent/run-manager.js";
import {
  insertRun,
  insertRunEvent,
  updateRunStatusIfRunning,
} from "../agent/run-store.js";
import {
  deleteAppState,
  writeAppState,
} from "../application-state/script-helpers.js";
import {
  appStateDeleteByPrefix,
  appStatePut,
} from "../application-state/store.js";
import { createThread } from "../chat-threads/store.js";
import { getDbExec } from "../db/client.js";
import { createAgentChatPlugin } from "./agent-chat-plugin.js";
import { runWithRequestContext } from "./request-context.js";

const auth = vi.hoisted(() => ({ email: "owner@example.test" }));
const routeHarness = vi.hoisted(() => ({
  initPromises: [] as Promise<void>[],
}));
vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  getSession: vi.fn(async () => ({ email: auth.email, orgId: "org-run-test" })),
}));
vi.mock("./framework-request-handler.js", () => ({
  awaitBootstrap: () => Promise.resolve(),
  getH3App: (app: { h3App: ReturnType<typeof createApp> }) => ({
    use(path: string, handler: EventHandler) {
      app.h3App.use((event, next) =>
        event.url.pathname === path || event.url.pathname.startsWith(`${path}/`)
          ? handler(event)
          : next(),
      );
    },
  }),
  markDefaultPluginProvided: vi.fn(),
  trackPluginInit: (_app: unknown, promise: Promise<void>) => {
    routeHarness.initPromises.push(promise);
  },
}));

const orgId = "org-run-test";
const owner = "owner@example.test";
const viewer = "viewer@example.test";
const teamId = "team-run-test";
const base = "http://example.test/_agent-native/agent-chat/runs";

async function request(app: ReturnType<typeof createApp>, path: string) {
  return runWithRequestContext({ userEmail: auth.email, orgId }, () =>
    app.fetch(new Request(`${base}${path}`)),
  );
}

describe("mounted linked run routes", () => {
  afterEach(() => {
    auth.email = owner;
    routeHarness.initPromises.length = 0;
  });

  it("rechecks a bound run for each request, but lets an open stream complete", async () => {
    const db = getDbExec();
    await db.execute({
      sql: "CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT, allowed_domain TEXT, identity_authority TEXT, identity_id TEXT)",
      args: [],
    });
    await db.execute({
      sql: "CREATE TABLE IF NOT EXISTS org_members (org_id TEXT, email TEXT, role TEXT DEFAULT 'member', federation_removal_pending_at BIGINT)",
      args: [],
    });
    await db.execute({
      sql: "CREATE TABLE IF NOT EXISTS workspace_user_groups (id TEXT, org_id TEXT, is_team BOOLEAN, member_emails_json TEXT)",
      args: [],
    });
    await db.execute({
      sql: "INSERT INTO organizations (id, name) VALUES (?, ?)",
      args: [orgId, "Run test"],
    });
    for (const email of [owner, viewer]) {
      await db.execute({
        sql: "INSERT INTO org_members (org_id, email, role) VALUES (?, ?, 'member')",
        args: [orgId, email],
      });
    }
    await db.execute({
      sql: "INSERT INTO workspace_user_groups (id, org_id, is_team, member_emails_json) VALUES (?, ?, true, ?)",
      args: [teamId, orgId, JSON.stringify([owner, viewer])],
    });
    const threadId = `linked-run-thread-${crypto.randomUUID()}`;
    const taskId = `linked-task-${crypto.randomUUID()}`;
    const taskRunId = `run-task-${taskId}`;
    const runId = taskRunId;
    const harnessRunId = `linked-harness-${crypto.randomUUID()}`;
    const sessionId = `linked-session-${crypto.randomUUID()}`;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      await runWithRequestContext({ userEmail: owner, orgId }, () =>
        createThread(owner, { id: threadId, teamGroupId: teamId }),
      );
      await db.execute({
        sql: "INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by) VALUES (?, ?, 'group', ?, 'viewer', ?)",
        args: [`share-${runId}`, threadId, teamId, owner],
      });
      const app = createApp();
      createAgentChatPlugin({
        actions: () => ({}),
        a2aAgentDelegation: false,
        frameworkTools: "minimal",
        leanPrompt: true,
        mcp: { enabled: false },
        resolveOrgId: () => orgId,
      })({ h3App: app, hooks: { hook: vi.fn() } });
      const initialized = routeHarness.initPromises.at(-1);
      if (!initialized) throw new Error("Run routes did not initialize");
      await initialized;

      const started = startRun(runId, threadId, async (send) => {
        send({ type: "text", text: "before revocation" });
        await gate;
        send({ type: "text", text: "after revocation" });
        send({ type: "done" });
      });
      auth.email = viewer;
      for (const path of [
        `/latest?threadId=${threadId}`,
        `/active?threadId=${threadId}`,
      ]) {
        const response = await request(app, path);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain(runId);
      }
      await runWithRequestContext({ userEmail: owner, orgId }, () =>
        writeAppState(`agent-task:${taskId}`, {
          taskId,
          threadId,
          ownerEmail: owner,
          orgId,
          description: "cached task",
          status: "completed",
          preview: "cached preview",
          summary: "cached result",
          currentStep: "",
          createdAt: Date.now(),
        }),
      );
      for (let i = 0; i < 201; i += 1) {
        await appStatePut(
          "unrelated@example.test",
          `agent-task:unrelated-${i}`,
          {
            taskId: `unrelated-${i}`,
            threadId: `private-${i}`,
            ownerEmail: "unrelated@example.test",
            orgId,
          },
        );
      }
      await insertRun(harnessRunId, threadId);
      await insertRunEvent(
        harnessRunId,
        0,
        JSON.stringify({ type: "text", text: "cached harness transcript" }),
      );
      await updateRunStatusIfRunning(harnessRunId, "completed");
      await saveAgentHarnessSession({
        id: sessionId,
        harnessName: "test",
        threadId,
        runId: harnessRunId,
        ownerEmail: owner,
        orgId,
        status: "running",
      });
      auth.email = viewer;
      const direct = await request(app, `/${runId}/events?after=0`);
      expect(direct.status).toBe(200);
      expect(direct.headers.get("content-type")).toContain("text/event-stream");
      const stream = direct.text();

      const viewerList = await request(app, "/list?goalId=agent-harness");
      expect(viewerList.status).toBe(200);
      expect((await viewerList.json()).runs).toEqual([
        expect.objectContaining({ id: harnessRunId, kind: "harness" }),
      ]);
      const viewerTranscript = await request(
        app,
        `/${harnessRunId}/background-events`,
      );
      expect(viewerTranscript.status).toBe(200);
      expect((await viewerTranscript.json()).events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: "cached harness transcript" }),
        ]),
      );
      auth.email = owner;
      const taskList = await request(app, "/list?goalId=agent-team");
      auth.email = viewer;
      const sharedTaskList = await request(app, "/list?goalId=agent-team");
      expect(sharedTaskList.status).toBe(200);
      expect((await sharedTaskList.json()).runs).toEqual([
        expect.objectContaining({ id: taskRunId, kind: "agent-team" }),
      ]);
      auth.email = owner;
      expect(taskList.status).toBe(200);
      expect((await taskList.json()).runs).toEqual([
        expect.objectContaining({
          id: taskRunId,
          metadata: expect.objectContaining({ latestText: "cached result" }),
        }),
      ]);
      const taskTranscript = await request(
        app,
        `/${taskRunId}/background-events`,
      );
      expect(taskTranscript.status).toBe(200);
      expect((await taskTranscript.json()).events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: "before revocation" }),
        ]),
      );
      auth.email = viewer;

      await db.execute({
        sql: "DELETE FROM chat_thread_shares WHERE resource_id = ?",
        args: [threadId],
      });
      expect((await request(app, `/${runId}/events?after=0`)).status).toBe(404);
      expect((await request(app, `/${runId}/events?after=1`)).status).toBe(404);
      expect((await request(app, `/latest?threadId=${threadId}`)).status).toBe(
        404,
      );
      expect(
        await (await request(app, `/active?threadId=${threadId}`)).json(),
      ).toMatchObject({ active: false, status: "idle" });
      expect(
        (await (await request(app, "/list?goalId=agent-team")).json()).runs,
      ).toEqual([]);
      expect(
        (await (await request(app, "/list?goalId=agent-harness")).json()).runs,
      ).toEqual([]);
      expect((await request(app, `/${runId}/background-events`)).status).toBe(
        404,
      );
      expect(
        (await request(app, `/${harnessRunId}/background-events`)).status,
      ).toBe(404);

      await db.execute({
        sql: "INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by) VALUES (?, ?, 'group', ?, 'viewer', ?)",
        args: [`share-restored-${runId}`, threadId, teamId, owner],
      });
      await db.execute({
        sql: "UPDATE workspace_user_groups SET member_emails_json = ? WHERE id = ?",
        args: [JSON.stringify([owner]), teamId],
      });
      expect((await request(app, `/${runId}/events?after=0`)).status).toBe(404);
      expect(
        (await (await request(app, "/list?goalId=agent-harness")).json()).runs,
      ).toEqual([]);
      await db.execute({
        sql: "UPDATE workspace_user_groups SET member_emails_json = ? WHERE id = ?",
        args: [JSON.stringify([owner, viewer]), teamId],
      });
      await db.execute({
        sql: "DELETE FROM org_members WHERE org_id = ? AND email = ?",
        args: [orgId, viewer],
      });
      expect((await request(app, `/${runId}/events?after=0`)).status).toBe(404);
      expect((await request(app, `/${runId}/background-events`)).status).toBe(
        404,
      );
      auth.email = owner;
      const ownerStream = await request(app, `/${runId}/events?after=0`);
      expect(ownerStream.status).toBe(200);
      await ownerStream.body?.cancel();
      await db.execute({
        sql: "DELETE FROM workspace_user_groups WHERE id = ?",
        args: [teamId],
      });
      expect((await request(app, `/${runId}/events?after=0`)).status).toBe(404);
      expect((await request(app, `/latest?threadId=${threadId}`)).status).toBe(
        404,
      );
      expect(
        (await (await request(app, "/list?goalId=agent-team")).json()).runs,
      ).toEqual([]);
      expect(
        (await request(app, `/${taskRunId}/background-events`)).status,
      ).toBe(404);

      finish();
      expect(await stream).toContain("after revocation");
      await started.finalized;
      await db.execute({
        sql: "DELETE FROM chat_threads WHERE id = ?",
        args: [threadId],
      });
      expect((await request(app, `/${runId}/events?after=0`)).status).toBe(404);
    } finally {
      finish();
      await appStateDeleteByPrefix(
        "unrelated@example.test",
        "agent-task:unrelated-",
      );
      await runWithRequestContext({ userEmail: owner, orgId }, () =>
        deleteAppState(`agent-task:${taskId}`),
      );
      await db.execute({
        sql: "DELETE FROM agent_harness_sessions WHERE id = ?",
        args: [sessionId],
      });
      await db.execute({
        sql: "DELETE FROM chat_thread_shares WHERE resource_id = ?",
        args: [threadId],
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
      await db.execute({
        sql: "DELETE FROM organizations WHERE id = ?",
        args: [orgId],
      });
    }
  });
});
