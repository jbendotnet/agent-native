import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as runStore from "../agent/run-store.js";
import {
  createThread,
  registerChatThreadsShareable,
} from "../chat-threads/store.js";
import { getDbExec } from "../db/client.js";
import { runWithRequestContext } from "./request-context.js";

const appState = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const tmpRoots: string[] = [];

const withTaskThread = <T>(
  threadId: string,
  test: () => Promise<T>,
  orgId?: string,
) =>
  runWithRequestContext({ userEmail: "alice@example.com", orgId }, async () => {
    registerChatThreadsShareable();
    await getDbExec().execute({
      sql: "CREATE TABLE IF NOT EXISTS org_members (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', joined_at BIGINT NOT NULL, federation_removal_pending_at BIGINT)",
      args: [],
    });
    await getDbExec().execute({
      sql: "CREATE TABLE IF NOT EXISTS workspace_user_groups (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', normalized_name TEXT, member_emails_json TEXT NOT NULL DEFAULT '[]', is_team BOOLEAN NOT NULL DEFAULT false, lead_emails_json TEXT NOT NULL DEFAULT '[]', created_by_email TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0)",
      args: [],
    });
    if (orgId) {
      await getDbExec().execute({
        sql: "INSERT INTO org_members (id, org_id, email, joined_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM org_members WHERE org_id = ? AND email = ?)",
        args: [
          `member-${orgId}-alice`,
          orgId,
          "alice@example.com",
          Date.now(),
          orgId,
          "alice@example.com",
        ],
      });
    }
    await createThread("alice@example.com", { id: threadId });
    try {
      return await test();
    } finally {
      await getDbExec().execute({
        sql: "DELETE FROM chat_threads WHERE id = ?",
        args: [threadId],
      });
    }
  });

vi.mock("../application-state/script-helpers.js", () => ({
  readAppState: vi.fn(async (key: string) => {
    const value = appState.get(key);
    return value == null ? null : structuredClone(value);
  }),
  writeAppState: vi.fn(async (key: string, value: Record<string, unknown>) => {
    appState.set(key, structuredClone(value));
  }),
  compareAndSetAppState: vi.fn(
    async (
      key: string,
      expectedValue: Record<string, unknown> | null,
      nextValue: Record<string, unknown> | null,
    ) => {
      const currentValue = appState.get(key) ?? null;
      if (JSON.stringify(currentValue) !== JSON.stringify(expectedValue)) {
        return false;
      }
      if (nextValue === null) appState.delete(key);
      else appState.set(key, structuredClone(nextValue));
      return true;
    },
  ),
  compareAndSetManyAppState: vi.fn(async (operations: any[]) => {
    if (
      operations.some((operation) => {
        const currentValue = appState.get(operation.key) ?? null;
        return (
          JSON.stringify(currentValue) !==
          JSON.stringify(operation.expectedValue)
        );
      })
    ) {
      return false;
    }
    for (const operation of operations) {
      if (operation.nextValue === null) appState.delete(operation.key);
      else appState.set(operation.key, structuredClone(operation.nextValue));
    }
    return true;
  }),
  deleteAppState: vi.fn(async (key: string) => appState.delete(key)),
  listAppState: vi.fn(async (prefix: string) =>
    [...appState.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: structuredClone(value) })),
  ),
  listAppStateAcrossSessions: vi.fn(
    async (prefix: string, limit: number, exact = false) =>
      [...appState.entries()]
        .filter(([key]) => (exact ? key === prefix : key.startsWith(prefix)))
        .slice(0, limit)
        .map(([key, value]) => ({ key, value })),
  ),
}));

describe("agent teams message queue", () => {
  beforeEach(() => {
    appState.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
    for (const root of tmpRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it(
    "appends task messages instead of overwriting and reports queue depth",
    () =>
      withTaskThread("thread-1", async () => {
        const { sendToTask } = await import("./agent-teams.js");
        appState.set("agent-task:task-1", {
          taskId: "task-1",
          threadId: "thread-1",
          ownerEmail: "alice@example.com",
          description: "do work",
          status: "running",
          preview: "",
          summary: "",
          currentStep: "",
          createdAt: Date.now(),
        });

        const first = await sendToTask("task-1", "first update");
        const second = await sendToTask("task-1", "second update");

        expect(first).toMatchObject({ ok: true, queuedCount: 1 });
        expect(second).toMatchObject({ ok: true, queuedCount: 2 });
        expect(first.messageId).toMatch(/^msg-/);
        expect(second.messageId).toMatch(/^msg-/);
        expect(first.messageId).not.toBe(second.messageId);
        expect(
          [...appState.keys()].filter((key) =>
            key.startsWith("task-message:task-1:"),
          ),
        ).toHaveLength(2);
      }),
    30_000,
  );

  it("scopes task reads and controls by owner and organization", () =>
    withTaskThread(
      "thread-private",
      async () => {
        const { getTask, listTasks, sendToTask } =
          await import("./agent-teams.js");
        appState.set("agent-task:private", {
          taskId: "private",
          threadId: "thread-private",
          ownerEmail: "alice@example.com",
          orgId: "org-a",
          description: "private work",
          status: "running",
          preview: "",
          summary: "",
          currentStep: "",
          createdAt: Date.now(),
        });

        await expect(
          getTask("private", {
            ownerEmail: "alice@example.com",
            orgId: "org-a",
          }),
        ).resolves.toMatchObject({ taskId: "private" });
        await expect(
          getTask("private", {
            ownerEmail: "mallory@example.com",
            orgId: "org-a",
          }),
        ).resolves.toBeUndefined();
        await expect(
          listTasks({ ownerEmail: "alice@example.com", orgId: "org-a" }),
        ).resolves.toHaveLength(1);
        await expect(
          sendToTask("private", "read this", {
            ownerEmail: "mallory@example.com",
            orgId: "org-a",
          }),
        ).resolves.toEqual({ ok: false, error: "Task not found" });
      },
      "org-a",
    ));

  it("denies exported task and controller reads and controls when the linked conversation is missing", () =>
    withTaskThread("thread-removed", async () => {
      const {
        getTask,
        listTasks,
        listAgentTeamBackgroundRuns,
        getAgentTeamBackgroundRun,
        listAgentTeamBackgroundTranscriptEvents,
        sendToTask,
        stopAgentTeamBackgroundRun,
        createAgentTeamBackgroundAgentController,
      } = await import("./agent-teams.js");
      appState.set("agent-task:removed", {
        taskId: "removed",
        threadId: "thread-removed",
        ownerEmail: "alice@example.com",
        description: "private work",
        status: "running",
        preview: "cached preview",
        summary: "cached result",
        currentStep: "",
        createdAt: Date.now(),
      });
      await getDbExec().execute({
        sql: "DELETE FROM chat_threads WHERE id = ?",
        args: ["thread-removed"],
      });
      expect(await getTask("removed")).toBeUndefined();
      expect(await listTasks()).toEqual([]);
      expect(await listAgentTeamBackgroundRuns()).toEqual([]);
      expect(await getAgentTeamBackgroundRun("run-task-removed")).toBeNull();
      expect(
        await listAgentTeamBackgroundTranscriptEvents("run-task-removed"),
      ).toEqual([]);
      expect(await sendToTask("removed", "follow up")).toMatchObject({
        ok: false,
      });
      expect(
        await stopAgentTeamBackgroundRun("run-task-removed"),
      ).toMatchObject({ ok: false });
      const controller = createAgentTeamBackgroundAgentController();
      expect(await controller.list()).toEqual([]);
      expect(await controller.get("run-task-removed")).toBeNull();
      expect(await controller.transcript("run-task-removed")).toEqual([]);
      expect(
        await controller.sendFollowUp({
          runId: "run-task-removed",
          prompt: "follow up",
        }),
      ).toMatchObject({ ok: false });
      expect(
        await controller.control({
          runId: "run-task-removed",
          command: "stop",
        }),
      ).toMatchObject({ ok: false });
    }));

  it("fails loudly instead of returning a truncated background task list", async () => {
    const { listTasks } = await import("./agent-teams.js");
    for (let i = 0; i < 201; i += 1) {
      appState.set(`agent-task:limit-${i}`, {
        taskId: `limit-${i}`,
        threadId: `thread-${i}`,
      });
    }
    await expect(
      listTasks({ ownerEmail: "alice@example.com" }),
    ).rejects.toThrow("200-item limit");
  });

  it("rechecks team task service and controller reads while keeping viewer controls owner-only", async () => {
    const db = getDbExec();
    const orgId = `task-org-${crypto.randomUUID()}`;
    const teamId = `task-team-${crypto.randomUUID()}`;
    const threadId = `task-thread-${crypto.randomUUID()}`;
    const taskId = `task-${crypto.randomUUID()}`;
    const runId = `run-task-${taskId}`;
    const owner = "alice@example.com";
    const viewer = "viewer@example.com";
    const scope = (email: string) => ({ ownerEmail: email, orgId });
    const as = <T>(email: string, fn: () => Promise<T>) =>
      runWithRequestContext({ userEmail: email, orgId }, fn);
    const events = vi.spyOn(runStore, "getRunEventsSince").mockResolvedValue([
      {
        seq: 1,
        eventData: JSON.stringify({
          type: "text",
          text: "private task transcript",
        }),
      },
    ]);
    const {
      getTask,
      getTaskByThread,
      listTasks,
      sendToTask,
      listAgentTeamBackgroundRuns,
      getAgentTeamBackgroundRun,
      listAgentTeamBackgroundTranscriptEvents,
      stopAgentTeamBackgroundRun,
      createAgentTeamBackgroundAgentController,
    } = await import("./agent-teams.js");
    registerChatThreadsShareable();
    await db.execute({
      sql: "CREATE TABLE IF NOT EXISTS org_members (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', joined_at BIGINT NOT NULL, federation_removal_pending_at BIGINT)",
      args: [],
    });
    await db.execute({
      sql: "CREATE TABLE IF NOT EXISTS workspace_user_groups (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', normalized_name TEXT, member_emails_json TEXT NOT NULL DEFAULT '[]', is_team BOOLEAN NOT NULL DEFAULT false, lead_emails_json TEXT NOT NULL DEFAULT '[]', created_by_email TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0)",
      args: [],
    });
    try {
      for (const email of [owner, viewer]) {
        await db.execute({
          sql: "INSERT INTO org_members (id, org_id, email, joined_at) VALUES (?, ?, ?, ?)",
          args: [`member-${orgId}-${email}`, orgId, email, Date.now()],
        });
      }
      await db.execute({
        sql: "INSERT INTO workspace_user_groups (id, org_id, name, is_team, member_emails_json) VALUES (?, ?, 'Task team', true, ?)",
        args: [teamId, orgId, JSON.stringify([owner, viewer])],
      });
      await as(owner, () =>
        createThread(owner, { id: threadId, teamGroupId: teamId }),
      );
      appState.set(`agent-task:${taskId}`, {
        taskId,
        threadId,
        ownerEmail: owner,
        orgId,
        description: "shared task",
        status: "running",
        preview: "cached preview",
        summary: "cached result",
        currentStep: "",
        createdAt: Date.now(),
      });
      appState.set(`agent-task-thread:${threadId}`, { taskId });
      await db.execute({
        sql: "INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by) VALUES (?, ?, 'group', ?, 'viewer', ?)",
        args: [`share-${taskId}`, threadId, teamId, owner],
      });
      const read = async (email: string, allowed: boolean) =>
        as(email, async () => {
          const controller = createAgentTeamBackgroundAgentController();
          expect(Boolean(await getTask(taskId, scope(email)))).toBe(allowed);
          expect(Boolean(await getTaskByThread(threadId, scope(email)))).toBe(
            allowed,
          );
          expect(await listTasks(scope(email))).toHaveLength(allowed ? 1 : 0);
          expect(await listAgentTeamBackgroundRuns(scope(email))).toHaveLength(
            allowed ? 1 : 0,
          );
          expect(
            Boolean(await getAgentTeamBackgroundRun(runId, scope(email))),
          ).toBe(allowed);
          expect(
            await listAgentTeamBackgroundTranscriptEvents(runId, scope(email)),
          ).toHaveLength(allowed ? 2 : 0);
          expect(await controller.list()).toHaveLength(allowed ? 1 : 0);
          expect(Boolean(await controller.get(runId))).toBe(allowed);
          expect(await controller.transcript(runId)).toHaveLength(
            allowed ? 2 : 0,
          );
        });
      await read(owner, true);
      await read(viewer, true);
      appState.set("agent-task:viewer-no-reconcile", {
        taskId: "viewer-no-reconcile",
        threadId,
        ownerEmail: owner,
        orgId,
        description: "stale owner task",
        status: "running",
        runId: "orphaned-run",
        startedAt: Date.now() - 120_000,
        createdAt: Date.now() - 120_000,
      });
      await as(viewer, () => getTask("viewer-no-reconcile", scope(viewer)));
      expect(appState.get("agent-task:viewer-no-reconcile")?.status).toBe(
        "running",
      );
      appState.delete("agent-task:viewer-no-reconcile");
      await as(viewer, async () => {
        expect(await sendToTask(taskId, "no", scope(viewer))).toMatchObject({
          ok: false,
        });
        expect(
          await stopAgentTeamBackgroundRun(runId, "user", scope(viewer)),
        ).toMatchObject({ ok: false });
        const controller = createAgentTeamBackgroundAgentController();
        expect(
          await controller.sendFollowUp({ runId, prompt: "no" }),
        ).toMatchObject({ ok: false });
        expect(
          await controller.control({ runId, command: "stop" }),
        ).toMatchObject({ ok: false });
      });
      await as(owner, async () => {
        expect(
          await sendToTask(taskId, "owner update", scope(owner)),
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
        args: [`restored-${taskId}`, threadId, teamId, owner],
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
        expect(await sendToTask(taskId, "no", scope(owner))).toMatchObject({
          ok: false,
        });
        expect(
          await stopAgentTeamBackgroundRun(runId, "user", scope(owner)),
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
    } finally {
      vi.restoreAllMocks();
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
    }
  });

  it(
    "drains queued messages into the next tool result once",
    () =>
      withTaskThread("thread-1", async () => {
        const { sendToTask, _agentTeamsQueueForTests } =
          await import("./agent-teams.js");
        appState.set("agent-task:task-1", {
          taskId: "task-1",
          threadId: "thread-1",
          ownerEmail: "alice@example.com",
          description: "do work",
          status: "running",
          preview: "",
          summary: "",
          currentStep: "",
          createdAt: Date.now(),
        });
        await sendToTask("task-1", "change direction");

        const actions = _agentTeamsQueueForTests.createMessageAwareActions(
          "task-1",
          {
            "do-work": {
              tool: { description: "Do work", parameters: { type: "object" } },
              run: async () => "tool result",
            },
          },
        );

        await expect(actions["do-work"].run({})).resolves.toContain(
          "change direction",
        );
        await expect(actions["do-work"].run({})).resolves.toBe("tool result");
      }),
    30_000,
  );

  it("uses the final response guard to deliver queued messages before completion", () =>
    withTaskThread("thread-1", async () => {
      const { sendToTask, _agentTeamsQueueForTests } =
        await import("./agent-teams.js");
      appState.set("agent-task:task-1", {
        taskId: "task-1",
        threadId: "thread-1",
        ownerEmail: "alice@example.com",
        description: "do work",
        status: "running",
        preview: "",
        summary: "",
        currentStep: "",
        createdAt: Date.now(),
      });
      await sendToTask("task-1", "one last constraint");

      const guard =
        _agentTeamsQueueForTests.createTaskMessageFinalGuard("task-1");
      const result = await guard({
        messages: [],
        assistantContent: [],
        text: "done",
        toolCalls: [],
        toolResults: [],
        retryCount: 0,
      });

      expect(result).toMatchObject({
        retryMessage: expect.stringContaining("one last constraint"),
        expandToolSurface: true,
      });
      await expect(
        _agentTeamsQueueForTests.drainQueuedTaskMessages("task-1"),
      ).resolves.toEqual([]);
    }));

  it("maps aborted and errored child runs to non-success task outcomes", async () => {
    const { _agentTeamsQueueForTests } = await import("./agent-teams.js");

    expect(
      _agentTeamsQueueForTests.resolveTaskCompletion(
        { status: "aborted", abortReason: "user" },
        "",
      ),
    ).toMatchObject({
      taskStatus: "errored",
      progressStatus: "cancelled",
      summary: "Task stopped.",
    });
    expect(
      _agentTeamsQueueForTests.resolveTaskCompletion(
        { status: "errored" },
        "partial failure detail",
      ),
    ).toMatchObject({
      taskStatus: "errored",
      progressStatus: "failed",
      summary: "partial failure detail",
    });
    expect(
      _agentTeamsQueueForTests.resolveTaskCompletion(
        { status: "completed" },
        "finished",
      ),
    ).toMatchObject({
      taskStatus: "completed",
      progressStatus: "succeeded",
      summary: "finished",
    });
  });

  it("preserves long sub-agent output up to 50 000 chars without truncation", async () => {
    const { _agentTeamsQueueForTests } = await import("./agent-teams.js");

    const short = "A".repeat(10_000);
    const shortResult = _agentTeamsQueueForTests.resolveTaskCompletion(
      { status: "completed" },
      short,
    );
    expect(shortResult.summary).toBe(short);
    expect(shortResult.summary.length).toBe(10_000);

    const atCap = "B".repeat(50_000);
    expect(
      _agentTeamsQueueForTests.resolveTaskCompletion(
        { status: "completed" },
        atCap,
      ).summary,
    ).toBe(atCap);

    const overCap = "X".repeat(10_000) + "Y".repeat(50_000);
    const overResult = _agentTeamsQueueForTests.resolveTaskCompletion(
      { status: "completed" },
      overCap,
    );
    expect(overResult.summary.length).toBe(50_000);
    expect(overResult.summary).toBe("Y".repeat(50_000));
  });

  it("marks the summary with [hit-continuation-limit] when the absolute cap fires", async () => {
    const { _agentTeamsQueueForTests } = await import("./agent-teams.js");

    const result = _agentTeamsQueueForTests.resolveTaskCompletion(
      { status: "completed" },
      "partial output",
      { hitContinuationLimit: true },
    );
    expect(result.summary).toContain("[hit-continuation-limit]");
    expect(result.summary).toContain("partial output");
    expect(result.taskStatus).toBe("completed");
  });

  it("maps tasks into the shared background run vocabulary", () =>
    withTaskThread("thread-1", async () => {
      const {
        getAgentTeamBackgroundRun,
        listAgentTeamBackgroundRuns,
        toAgentTaskBackgroundRun,
      } = await import("./agent-teams.js");
      const task = {
        taskId: "task-1",
        threadId: "thread-1",
        ownerEmail: "alice@example.com",
        description: "Review the launch plan",
        status: "running" as const,
        preview: "Checking milestones",
        summary: "",
        currentStep: "Reading docs",
        createdAt: Date.parse("2026-05-16T10:00:00.000Z"),
      };
      appState.set("agent-task:task-1", task);

      expect(toAgentTaskBackgroundRun(task)).toMatchObject({
        schemaVersion: 1,
        id: "run-task-task-1",
        kind: "agent-team",
        source: "hosted-agent-team",
        sourceLabel: "Agent Teams",
        sourceRecord: {
          type: "agent-team-task",
          id: "task-1",
          threadId: "thread-1",
        },
        title: "Review the launch plan",
        subtitle: "Reading docs",
        status: "running",
        phase: "Reading docs",
        createdAt: "2026-05-16T10:00:00.000Z",
        updatedAt: "2026-05-16T10:00:00.000Z",
        goalId: "agent-team",
        needsInput: false,
        needsApproval: false,
        surfaceUrl: "agent-native://threads/thread-1",
        metadata: {
          taskId: "task-1",
          threadId: "thread-1",
          latestText: "Checking milestones",
        },
      });
      await expect(listAgentTeamBackgroundRuns()).resolves.toMatchObject([
        { id: "run-task-task-1", kind: "agent-team" },
      ]);
      await expect(
        getAgentTeamBackgroundRun("run-task-task-1"),
      ).resolves.toMatchObject({
        id: "run-task-task-1",
        sourceRecord: { id: "task-1" },
      });
      await expect(getAgentTeamBackgroundRun("missing")).resolves.toBeNull();
    }));

  it("maps task run events into shared background transcript events", async () => {
    const { toAgentTaskBackgroundTranscriptEvent } =
      await import("./agent-teams.js");

    expect(
      toAgentTaskBackgroundTranscriptEvent("run-task-task-1", {
        seq: 7,
        event: { type: "text", text: "Reviewed the launch plan." },
      }),
    ).toMatchObject({
      schemaVersion: 1,
      id: "run-task-task-1:7",
      runId: "run-task-task-1",
      kind: "note",
      source: "hosted-agent-team",
      sourceRecord: {
        type: "agent-team-run-event",
        id: "run-task-task-1:7",
        seq: 7,
      },
      message: "Reviewed the launch plan.",
      metadata: { seq: 7, sourceSeq: 7 },
    });

    expect(
      toAgentTaskBackgroundTranscriptEvent(
        "run-task-task-1",
        {
          seq: 2,
          event: { type: "text", text: "Continued in the next chunk." },
        },
        { seq: 12, sourceRunId: "run-task-task-1-c1" },
      ),
    ).toMatchObject({
      id: "run-task-task-1-c1:2",
      runId: "run-task-task-1",
      sourceRecord: {
        type: "agent-team-run-event",
        id: "run-task-task-1-c1:2",
        seq: 12,
      },
      metadata: {
        seq: 12,
        sourceSeq: 2,
        sourceRunId: "run-task-task-1-c1",
      },
    });

    expect(
      toAgentTaskBackgroundTranscriptEvent("run-task-task-1", {
        seq: 8,
        event: { type: "clear" },
      }),
    ).toMatchObject({
      id: "run-task-task-1:8",
      kind: "status",
      message: "",
      metadata: {
        agentChatEventType: "clear",
        seq: 8,
        sourceSeq: 8,
      },
      sourceRecord: {
        type: "agent-team-run-event",
        id: "run-task-task-1:8",
        seq: 8,
      },
    });
  });

  it("sends background-run follow-ups through the existing task queue", () =>
    withTaskThread("thread-1", async () => {
      const { sendToAgentTeamBackgroundRun } = await import("./agent-teams.js");
      appState.set("agent-task:task-1", {
        taskId: "task-1",
        threadId: "thread-1",
        ownerEmail: "alice@example.com",
        description: "do work",
        status: "running",
        preview: "",
        summary: "",
        currentStep: "",
        createdAt: Date.now(),
      });

      const result = await sendToAgentTeamBackgroundRun(
        "run-task-task-1",
        "use the newer brief",
      );

      expect(result).toMatchObject({ ok: true, queuedCount: 1 });
      expect(
        [...appState.values()].some(
          (value) => value.message === "use the newer brief",
        ),
      ).toBe(true);
    }));

  it("exposes Agent Teams through the shared background controller interface", () =>
    withTaskThread("thread-1", async () => {
      const { createAgentTeamBackgroundAgentController } =
        await import("./agent-teams.js");
      appState.set("agent-task:task-1", {
        taskId: "task-1",
        threadId: "thread-1",
        ownerEmail: "alice@example.com",
        description: "review docs",
        status: "running",
        preview: "reading",
        summary: "",
        currentStep: "Scanning",
        createdAt: Date.parse("2026-05-16T10:00:00.000Z"),
      });

      const controller = createAgentTeamBackgroundAgentController();

      await expect(
        Promise.resolve(controller.list({ goalId: "agent-team" })),
      ).resolves.toEqual([
        expect.objectContaining({
          id: "run-task-task-1",
          kind: "agent-team",
          source: "hosted-agent-team",
        }),
      ]);
      await expect(
        controller.sendFollowUp({
          runId: "run-task-task-1",
          prompt: "use the updated brief",
        }),
      ).resolves.toMatchObject({
        ok: true,
        queued: true,
        run: { id: "run-task-task-1" },
      });
      await expect(
        controller.control({ runId: "run-task-task-1", command: "stop" }),
      ).resolves.toMatchObject({
        ok: true,
        run: { status: "errored", phase: "Task stopped." },
      });
    }));

  it("preserves source labels when local Code and Agent Teams runs are mixed", () =>
    withTaskThread("thread-1", async () => {
      const {
        createCodeAgentRunRecord,
        createCompositeBackgroundAgentController,
        createLocalCodeBackgroundAgentController,
      } = await import("../code-agents/index.js");
      const { createAgentTeamBackgroundAgentController } =
        await import("./agent-teams.js");
      useTempCodeAgentsHome();
      const localRun = createCodeAgentRunRecord({
        goalId: "task",
        title: "Fix auth tests",
        status: "paused",
        phase: "review",
        cwd: "/repo",
      });
      appState.set("agent-task:task-1", {
        taskId: "task-1",
        threadId: "thread-1",
        ownerEmail: "alice@example.com",
        description: "Review the launch plan",
        status: "running",
        preview: "Checking milestones",
        summary: "",
        currentStep: "Reading docs",
        createdAt: Date.parse("2026-05-16T10:00:00.000Z"),
      });

      const controller = createCompositeBackgroundAgentController([
        createLocalCodeBackgroundAgentController(),
        createAgentTeamBackgroundAgentController(),
      ]);

      await expect(Promise.resolve(controller.list())).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: localRun.id,
            kind: "code",
            source: "local-code",
            sourceLabel: "Local Code",
          }),
          expect.objectContaining({
            id: "run-task-task-1",
            kind: "agent-team",
            source: "hosted-agent-team",
            sourceLabel: "Agent Teams",
          }),
        ]),
      );
      await expect(
        Promise.resolve(controller.get(localRun.id)),
      ).resolves.toEqual(
        expect.objectContaining({
          id: localRun.id,
          sourceLabel: "Local Code",
        }),
      );
      await expect(
        Promise.resolve(controller.get("run-task-task-1")),
      ).resolves.toEqual(
        expect.objectContaining({
          id: "run-task-task-1",
          sourceLabel: "Agent Teams",
        }),
      );
    }));

  it("appends a parent-completion injection when parentThreadId is set", async () => {
    const {
      drainParentCompletionInjections,
      formatParentCompletionInjections,
    } = await import("./agent-teams.js");

    const injKey = "parent-completion:parent-thread-1:inj-test-001";
    appState.set(injKey, {
      id: "inj-test-001",
      taskId: "task-sub-1",
      taskName: "Research task",
      status: "completed",
      hitContinuationLimit: false,
      summaryExcerpt: "Found 10 results.",
      fullSummaryAvailable: false,
      timestamp: Date.now(),
    });

    const injections = await drainParentCompletionInjections("parent-thread-1");

    expect(injections).toHaveLength(1);
    expect(injections[0]).toMatchObject({
      taskId: "task-sub-1",
      taskName: "Research task",
      status: "completed",
      summaryExcerpt: "Found 10 results.",
    });
    await expect(
      drainParentCompletionInjections("parent-thread-1"),
    ).resolves.toEqual([]);

    const formatted = formatParentCompletionInjections(injections);
    expect(formatted).toContain("Research task");
    expect(formatted).toContain("Found 10 results.");
    expect(formatted).toContain("completed");
  });

  it("formats completion injections with a pointer for long summaries", async () => {
    const {
      drainParentCompletionInjections,
      formatParentCompletionInjections,
    } = await import("./agent-teams.js");

    const injKey = "parent-completion:parent-thread-2:inj-long-001";
    appState.set(injKey, {
      id: "inj-long-001",
      taskId: "task-big",
      taskName: "Big analysis",
      status: "completed",
      hitContinuationLimit: false,
      summaryExcerpt: "A".repeat(2000),
      fullSummaryAvailable: true,
      timestamp: Date.now(),
    });

    const injections = await drainParentCompletionInjections("parent-thread-2");
    const formatted = formatParentCompletionInjections(injections);

    expect(formatted).toContain("read-result");
    expect(formatted).toContain("task-big");
  });

  it("formats hit-continuation-limit completions with a descriptive label", async () => {
    const {
      drainParentCompletionInjections,
      formatParentCompletionInjections,
    } = await import("./agent-teams.js");

    const injKey = "parent-completion:parent-thread-3:inj-limit-001";
    appState.set(injKey, {
      id: "inj-limit-001",
      taskId: "task-limited",
      status: "completed",
      hitContinuationLimit: true,
      summaryExcerpt: "Partial work done.",
      fullSummaryAvailable: false,
      timestamp: Date.now(),
    });

    const injections = await drainParentCompletionInjections("parent-thread-3");
    const formatted = formatParentCompletionInjections(injections);

    expect(formatted).toContain("continuation limit");
  });

  it("drains multiple injections in timestamp order", async () => {
    const { drainParentCompletionInjections } =
      await import("./agent-teams.js");

    const now = Date.now();
    appState.set("parent-completion:parent-thread-4:inj-b", {
      id: "inj-b",
      taskId: "task-b",
      status: "completed",
      hitContinuationLimit: false,
      summaryExcerpt: "B done",
      fullSummaryAvailable: false,
      timestamp: now + 100,
    });
    appState.set("parent-completion:parent-thread-4:inj-a", {
      id: "inj-a",
      taskId: "task-a",
      status: "errored",
      hitContinuationLimit: false,
      summaryExcerpt: "A failed",
      fullSummaryAvailable: false,
      timestamp: now,
    });

    const injections = await drainParentCompletionInjections("parent-thread-4");
    expect(injections.map((i) => i.taskId)).toEqual(["task-a", "task-b"]);
  });
});

describe("getCurrentDelegationDepth", () => {
  it("returns 0 outside any delegation scope (top-level chat)", async () => {
    const { getCurrentDelegationDepth } = await import("./agent-teams.js");
    expect(getCurrentDelegationDepth()).toBe(0);
  });

  it("reflects the ambient depth set by runWithDelegationDepth", async () => {
    const { getCurrentDelegationDepth, _agentTeamsQueueForTests } =
      await import("./agent-teams.js");
    const { runWithDelegationDepth } = _agentTeamsQueueForTests;

    const seen: number[] = [];
    await runWithDelegationDepth(2, async () => {
      seen.push(getCurrentDelegationDepth());
      await runWithDelegationDepth(3, async () => {
        seen.push(getCurrentDelegationDepth());
      });
      seen.push(getCurrentDelegationDepth());
    });
    seen.push(getCurrentDelegationDepth());

    expect(seen).toEqual([2, 3, 2, 0]);
  });
});

function useTempCodeAgentsHome(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-teams-code-"));
  tmpRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = root;
  return root;
}
