import { createApp, type EventHandler } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AGENT_CHAT_PROCESS_RUN_PATH } from "../agent/durable-background.js";
import * as runStore from "../agent/run-store.js";
import { createThread } from "../chat-threads/store.js";
import { getDbExec } from "../db/client.js";
import { signInternalToken } from "../integrations/internal-token.js";
import { createAgentChatPlugin } from "./agent-chat-plugin.js";
import { runWithRequestContext } from "./request-context.js";

const routeHarness = vi.hoisted(() => ({
  initPromises: [] as Promise<void>[],
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

describe("registered durable chat worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    routeHarness.initPromises.length = 0;
  });

  it("denies revoked or missing linked conversations before loading persisted dispatch payload", async () => {
    const db = getDbExec();
    const owner = "worker-owner@example.test";
    const orgId = `worker-org-${crypto.randomUUID()}`;
    const teamId = `worker-team-${crypto.randomUUID()}`;
    const threadId = `worker-thread-${crypto.randomUUID()}`;
    const runId = `worker-run-${crypto.randomUUID()}`;
    const previousSecret = process.env.A2A_SECRET;
    process.env.A2A_SECRET = "worker-test-only-secret";
    await db.execute({
      sql: "CREATE TABLE IF NOT EXISTS org_members (org_id TEXT, email TEXT, role TEXT DEFAULT 'member', federation_removal_pending_at BIGINT)",
      args: [],
    });
    await db.execute({
      sql: "CREATE TABLE IF NOT EXISTS workspace_user_groups (id TEXT, org_id TEXT, is_team BOOLEAN, member_emails_json TEXT)",
      args: [],
    });
    try {
      await db.execute({
        sql: "INSERT INTO org_members (org_id, email) VALUES (?, ?)",
        args: [orgId, owner],
      });
      await db.execute({
        sql: "INSERT INTO workspace_user_groups (id, org_id, is_team, member_emails_json) VALUES (?, ?, true, ?)",
        args: [teamId, orgId, JSON.stringify([owner])],
      });
      await runWithRequestContext({ userEmail: owner, orgId }, () =>
        createThread(owner, { id: threadId, teamGroupId: teamId }),
      );
      const initiator = vi
        .spyOn(runStore, "getTurnInitiatorByRun")
        .mockResolvedValue({
          email: owner,
          orgId,
          orgScope: null,
          anonymous: false,
          firstRunId: runId,
        });
      const payload = vi.spyOn(runStore, "readRunDispatchPayload");
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
      if (!initialized) throw new Error("Worker route did not initialize");
      await initialized;
      await runStore.insertRun(runId, threadId, runId, {
        dispatchMode: "background",
        dispatchPayload: JSON.stringify({
          threadId,
          turnId: runId,
          message: "cached private result",
        }),
      });
      const request = () =>
        app.fetch(
          new Request(`http://example.test${AGENT_CHAT_PROCESS_RUN_PATH}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${signInternalToken(runId)}`,
            },
            body: JSON.stringify({
              taskId: runId,
              __backgroundRun: { runId, payloadRef: true },
            }),
          }),
        );
      const workerErrors = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const boundWithPayload = await request();
      expect(initiator).toHaveBeenCalledWith(runId);
      expect(payload).toHaveBeenCalledTimes(1);
      expect(boundWithPayload.status).toBe(403);
      expect(await boundWithPayload.json()).toEqual({
        error: "Team-bound chat execution requires team context support",
      });
      expect(workerErrors).not.toHaveBeenCalled();
      await db.execute({
        sql: "UPDATE workspace_user_groups SET member_emails_json = '[]' WHERE id = ?",
        args: [teamId],
      });
      payload.mockClear();
      const revoked = await request();
      expect(revoked.status).toBe(404);
      expect(await revoked.json()).toEqual({ error: "Run not found" });
      expect(payload).not.toHaveBeenCalled();
      await db.execute({
        sql: "UPDATE workspace_user_groups SET member_emails_json = ? WHERE id = ?",
        args: [JSON.stringify([owner]), teamId],
      });
      await db.execute({
        sql: "DELETE FROM org_members WHERE org_id = ? AND email = ?",
        args: [orgId, owner],
      });
      expect((await request()).status).toBe(404);
      expect(payload).not.toHaveBeenCalled();
      await db.execute({
        sql: "INSERT INTO org_members (org_id, email) VALUES (?, ?)",
        args: [orgId, owner],
      });
      await db.execute({
        sql: "DELETE FROM workspace_user_groups WHERE id = ?",
        args: [teamId],
      });
      expect((await request()).status).toBe(404);
      expect(payload).not.toHaveBeenCalled();
      await db.execute({
        sql: "DELETE FROM chat_threads WHERE id = ?",
        args: [threadId],
      });
      const missing = await request();
      expect(missing.status).toBe(404);
      expect(payload).not.toHaveBeenCalled();
    } finally {
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
      if (previousSecret === undefined) delete process.env.A2A_SECRET;
      else process.env.A2A_SECRET = previousSecret;
    }
  });

  it("rechecks an unbound completed run before returning its cached worker result", async () => {
    const db = getDbExec();
    const owner = "worker-personal@example.test";
    const threadId = `worker-personal-thread-${crypto.randomUUID()}`;
    const runId = `worker-personal-run-${crypto.randomUUID()}`;
    const savedSecret = process.env.A2A_SECRET;
    process.env.A2A_SECRET = "worker-test-only-secret";
    try {
      await runWithRequestContext({ userEmail: owner }, () =>
        createThread(owner, { id: threadId }),
      );
      vi.spyOn(runStore, "getTurnInitiatorByRun").mockResolvedValue({
        email: owner,
        orgId: null,
        orgScope: null,
        anonymous: false,
        firstRunId: runId,
      });
      const cachedPayload = JSON.stringify({
        threadId,
        turnId: runId,
        message: "cached private response",
      });
      await runStore.insertRun(runId, threadId, runId, {
        dispatchMode: "background",
        dispatchPayload: cachedPayload,
      });
      await runStore.updateRunStatusIfRunning(runId, "completed");
      await db.execute({
        sql: "UPDATE agent_runs SET dispatch_payload = ? WHERE id = ?",
        args: [cachedPayload, runId],
      });
      const payload = vi.spyOn(runStore, "readRunDispatchPayload");
      const app = createApp();
      createAgentChatPlugin({
        actions: () => ({}),
        a2aAgentDelegation: false,
        frameworkTools: "minimal",
        leanPrompt: true,
        mcp: { enabled: false },
      })({ h3App: app, hooks: { hook: vi.fn() } });
      const initialized = routeHarness.initPromises.at(-1);
      if (!initialized) throw new Error("Worker route did not initialize");
      await initialized;
      const request = () =>
        app.fetch(
          new Request(`http://example.test${AGENT_CHAT_PROCESS_RUN_PATH}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${signInternalToken(runId)}`,
            },
            body: JSON.stringify({
              taskId: runId,
              __backgroundRun: { runId, payloadRef: true },
            }),
          }),
        );
      const permitted = await request();
      expect(permitted.status).toBe(200);
      expect(await permitted.json()).toMatchObject({
        ok: true,
        skipped: "already-claimed",
      });
      expect(payload).toHaveBeenCalledWith(runId);
      payload.mockClear();
      await db.execute({
        sql: "DELETE FROM chat_threads WHERE id = ?",
        args: [threadId],
      });
      const revoked = await request();
      expect(revoked.status).toBe(404);
      expect(await revoked.json()).toEqual({ error: "Run not found" });
      expect(payload).not.toHaveBeenCalled();
    } finally {
      await db.execute({
        sql: "DELETE FROM agent_runs WHERE id = ?",
        args: [runId],
      });
      await db.execute({
        sql: "DELETE FROM chat_threads WHERE id = ?",
        args: [threadId],
      });
      if (savedSecret === undefined) delete process.env.A2A_SECRET;
      else process.env.A2A_SECRET = savedSecret;
    }
  });
});
