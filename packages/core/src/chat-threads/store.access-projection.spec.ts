import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());
const getWorkspaceTeamForMemberMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../sharing/access.js", () => ({
  resolveAccess: resolveAccessMock,
}));
vi.mock("../workspace-connections/groups.js", () => ({
  getWorkspaceTeamForMember: getWorkspaceTeamForMemberMock,
}));

vi.mock("./emitter.js", () => ({ emitChatThreadChange: vi.fn() }));

import { resolveThreadAccess } from "./store.js";

const THREAD_ROW = {
  id: "t1",
  owner_email: "owner@example.com",
  title: "Thread",
  preview: "",
  thread_data: JSON.stringify({ messages: [] }),
  message_count: 0,
  created_at: 1,
  updated_at: 1,
  org_id: null,
  team_group_id: null,
  visibility: "private" as const,
};

describe("resolveThreadAccess loads the ACL without the conversation blob", () => {
  beforeEach(() => {
    executeMock.mockReset();
    resolveAccessMock.mockReset();
    getWorkspaceTeamForMemberMock.mockReset();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });
  });

  it("asks resolveAccess for the projected row, not the full thread", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "owner",
      resource: {
        id: "t1",
        ownerEmail: "owner@example.com",
        orgId: null,
        visibility: "private",
      },
    });
    executeMock.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (/^SELECT .* FROM chat_threads WHERE id = \?/.test(sql)) {
        return { rows: [THREAD_ROW], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    });

    const thread = await resolveThreadAccess("owner@example.com", "t1");

    expect(thread?.id).toBe("t1");
    expect(resolveAccessMock).toHaveBeenCalledTimes(1);
    expect(resolveAccessMock.mock.calls[0][3]).toEqual({
      skipResourceBody: true,
    });
  });

  it("still denies a caller whose role does not satisfy the minimum", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "t1",
        ownerEmail: "owner@example.com",
        orgId: null,
        visibility: "private",
      },
    });

    await expect(
      resolveThreadAccess("viewer@example.com", "t1", "editor"),
    ).resolves.toBeNull();
  });

  it("returns null without loading the transcript when access is refused", async () => {
    resolveAccessMock.mockResolvedValue(null);

    await expect(resolveThreadAccess("nobody@example.com", "t1")).resolves.toBe(
      null,
    );
    const threadReads = executeMock.mock.calls.filter(([query]) => {
      const sql = typeof query === "string" ? query : query?.sql;
      return typeof sql === "string" && /FROM chat_threads WHERE id/.test(sql);
    });
    expect(threadReads).toHaveLength(1);
    expect(threadReads[0]?.[0].sql).not.toContain("thread_data");
  });

  it("checks current bound membership before generic owner or admin access", async () => {
    executeMock.mockImplementation(async (query: { sql: string }) => ({
      rows: query.sql.includes("FROM chat_threads WHERE id = ?")
        ? [{ ...THREAD_ROW, org_id: "org-1", team_group_id: "team-1" }]
        : [],
      rowsAffected: 0,
    }));
    resolveAccessMock.mockResolvedValue({
      role: "owner",
      resource: { id: "t1" },
    });
    await expect(
      resolveThreadAccess("owner@example.com", "t1", "viewer", {
        orgId: "org-1",
      }),
    ).resolves.toBeNull();
    expect(getWorkspaceTeamForMemberMock).toHaveBeenCalledWith(
      "org-1",
      "team-1",
      "owner@example.com",
    );
    expect(resolveAccessMock).not.toHaveBeenCalled();

    getWorkspaceTeamForMemberMock.mockResolvedValue({ id: "team-1" });
    await expect(
      resolveThreadAccess("owner@example.com", "t1", "owner", {
        orgId: "org-2",
      }),
    ).resolves.toBeNull();
    expect(resolveAccessMock).not.toHaveBeenCalled();

    const restored = await resolveThreadAccess(
      "owner@example.com",
      "t1",
      "owner",
      { orgId: "org-1" },
    );
    expect(restored?.teamGroupId).toBe("team-1");
  });

  it("allows a shared team member to read but never continue or manage", async () => {
    executeMock.mockImplementation(async (query: { sql: string }) => ({
      rows: query.sql.includes("FROM chat_threads WHERE id = ?")
        ? [{ ...THREAD_ROW, org_id: "org-1", team_group_id: "team-1" }]
        : query.sql.includes("FROM chat_thread_shares")
          ? [{ 1: 1 }]
          : [],
      rowsAffected: 0,
    }));
    getWorkspaceTeamForMemberMock.mockResolvedValue({ id: "team-1" });
    resolveAccessMock.mockResolvedValue({
      role: "admin",
      resource: { id: "t1" },
    });
    await expect(
      resolveThreadAccess("viewer@example.com", "t1", "editor", {
        orgId: "org-1",
      }),
    ).resolves.toBeNull();
    expect(resolveAccessMock).not.toHaveBeenCalled();
    resolveAccessMock.mockResolvedValue(null);
    expect(
      (
        await resolveThreadAccess("viewer@example.com", "t1", "viewer", {
          orgId: "org-1",
        })
      )?.id,
    ).toBe("t1");
    executeMock.mockImplementation(async (query: { sql: string }) => ({
      rows: query.sql.includes("FROM chat_threads WHERE id = ?")
        ? [{ ...THREAD_ROW, org_id: "org-1", team_group_id: "team-1" }]
        : [],
      rowsAffected: 0,
    }));
    await expect(
      resolveThreadAccess("private@example.com", "t1", "viewer", {
        orgId: "org-1",
      }),
    ).resolves.toBeNull();
  });
});
