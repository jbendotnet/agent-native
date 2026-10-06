import type { H3Event } from "h3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

import { createTestPglite } from "../a2a/test-pglite.js";

const memberships = new Map<string, Set<string>>([
  ["org-a", new Set(["alice@example.com", "bob@example.com"])],
  ["org-b", new Set(["alice@example.com"])],
]);
const teams = new Map<string, Set<string>>([
  ["org-a", new Set(["team-a:alice@example.com"])],
  ["org-b", new Set(["team-b:alice@example.com"])],
]);

vi.mock("./groups.js", () => ({
  workspaceUserGroupRole: async (orgId: string, email: string) =>
    memberships.get(orgId)?.has(email) ? "member" : null,
  getWorkspaceTeamForMember: async (orgId: string, id: string, email: string) =>
    teams.get(orgId)?.has(`${id}:${email}`) ? { id, isTeam: true } : null,
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: async (event: H3Event) => ({
    orgId:
      (await getUserSetting(String(event.context.testEmail), "active-org-id"))
        ?.orgId ?? "org-a",
  }),
  markActiveOrgSelectionChanged: vi.fn(),
}));

let db: Awaited<ReturnType<typeof createTestPglite>>;
const client = {
  execute: async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await db.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const result = await db.query(input.sql, input.args);
    return {
      rows: result.rows,
      rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
    };
  },
};

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => client,
  isLocalDatabase: () => true,
}));

import { appStateGet } from "../application-state/store.js";
import { setActiveOrgId } from "../org/active-org.js";
import { authSessionHandler } from "../server/auth.js";
import { getUserSetting } from "../settings/user-settings.js";
import getAction from "./actions/get-active-workspace-team.js";
import setAction from "./actions/set-active-workspace-team.js";

function request(email: string): H3Event {
  const url = "http://localhost/_agent-native/auth/session";
  const event = {
    req: { method: "GET", url, headers: new Headers({ host: "localhost" }) },
    res: { headers: new Headers(), status: 200 },
    node: {
      req: { method: "GET", url, headers: { host: "localhost" } },
      res: { setHeader: vi.fn(), getHeader: vi.fn(), appendHeader: vi.fn() },
    },
    url: new URL(url),
    headers: new Headers({ host: "localhost" }),
    context: {},
    path: "/_agent-native/auth/session",
  } as unknown as H3Event;
  // Bypass the auth provider only: the real session handler and stores run.
  event.context.__anSessionCache = Promise.resolve({ email });
  event.context.testEmail = email;
  return event;
}

async function sqlValue(table: string, column: string, value: string) {
  const result = await db.query(
    `SELECT value FROM ${table} WHERE ${column} = ?`,
    [value],
  );
  return result.rows.length
    ? JSON.parse((result.rows[0] as { value: string }).value)
    : null;
}

async function sqlMirror(email: string) {
  const { rows } = await db.query(
    "SELECT value FROM application_state WHERE session_id = ? AND key = ?",
    [email, "active-workspace-team"],
  );
  return rows.length ? JSON.parse((rows[0] as { value: string }).value) : null;
}

const context = (email: string, orgId: string) => ({
  caller: "http" as const,
  userEmail: email,
  orgId,
});

describe("active team SQL selection and session hydration", () => {
  beforeAll(async () => {
    db = await createTestPglite();
    await db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL);
      CREATE TABLE application_state (session_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (session_id, key));`);
  });
  afterAll(async () => {
    await db.close();
  });

  it("persists per user and org, restores on new requests and switches, and clears stale choices", async () => {
    const alice = "alice@example.com";
    const bob = "bob@example.com";
    const schema = (setAction as unknown as { schema: ZodType }).schema;
    expect(schema.safeParse({ teamGroupId: undefined }).success).toBe(false);
    expect(schema.safeParse({ teamGroupId: 7 }).success).toBe(false);
    await expect(
      setAction.run({ teamGroupId: "team-a" }, context(bob, "org-a")),
    ).rejects.toThrow("membership");
    expect(
      await sqlValue("settings", "key", `u:${bob}:active-workspace-teams`),
    ).toBeNull();

    expect(
      await setAction.run({ teamGroupId: "team-a" }, context(alice, "org-a")),
    ).toEqual({ orgId: "org-a", teamGroupId: "team-a" });
    expect(
      await sqlValue("settings", "key", `u:${alice}:active-workspace-teams`),
    ).toEqual({ byOrg: { "org-a": "team-a" } });
    expect(await sqlMirror(alice)).toEqual({
      orgId: "org-a",
      teamGroupId: "team-a",
    });
    expect(await appStateGet(alice, "active-workspace-team")).toEqual({
      orgId: "org-a",
      teamGroupId: "team-a",
    });
    expect(await sqlMirror(bob)).toBeNull();

    const first = request(alice);
    expect(await authSessionHandler(first)).toMatchObject({ email: alice });
    const second = request(alice);
    expect(await authSessionHandler(second)).toMatchObject({ email: alice });
    expect(first).not.toBe(second);
    expect(await authSessionHandler(request(bob))).toMatchObject({
      email: bob,
    });
    expect(await sqlMirror(bob)).toEqual({ orgId: "org-a", teamGroupId: null });
    expect(
      await sqlValue("settings", "key", `u:${bob}:active-workspace-teams`),
    ).toBeNull();
    expect(await sqlMirror(alice)).toEqual({
      orgId: "org-a",
      teamGroupId: "team-a",
    });
    expect(await getAction.run({}, context(alice, "org-a"))).toEqual({
      orgId: "org-a",
      teamGroupId: "team-a",
    });

    await setActiveOrgId(alice, "org-b", "integration test switch", second);
    expect(await sqlMirror(alice)).toEqual({
      orgId: "org-b",
      teamGroupId: null,
    });
    expect(
      await setAction.run({ teamGroupId: "team-b" }, context(alice, "org-b")),
    ).toEqual({ orgId: "org-b", teamGroupId: "team-b" });
    expect(
      await sqlValue("settings", "key", `u:${alice}:active-workspace-teams`),
    ).toEqual({ byOrg: { "org-a": "team-a", "org-b": "team-b" } });
    expect(await sqlMirror(alice)).toEqual({
      orgId: "org-b",
      teamGroupId: "team-b",
    });

    await setActiveOrgId(
      alice,
      "org-a",
      "integration test switch",
      request(alice),
    );
    expect(await sqlMirror(alice)).toEqual({
      orgId: "org-a",
      teamGroupId: "team-a",
    });
    teams.get("org-a")?.delete(`team-a:${alice}`);
    expect(await authSessionHandler(request(alice))).toMatchObject({
      email: alice,
    });
    expect(
      await sqlValue("settings", "key", `u:${alice}:active-workspace-teams`),
    ).toEqual({ byOrg: { "org-b": "team-b" } });
    expect(await sqlMirror(alice)).toEqual({
      orgId: "org-a",
      teamGroupId: null,
    });

    await setActiveOrgId(
      alice,
      "org-b",
      "integration test switch",
      request(alice),
    );
    expect(
      await setAction.run({ teamGroupId: null }, context(alice, "org-b")),
    ).toEqual({ orgId: "org-b", teamGroupId: null });
    expect(
      await sqlValue("settings", "key", `u:${alice}:active-workspace-teams`),
    ).toEqual({ byOrg: {} });
    expect(await sqlMirror(alice)).toEqual({
      orgId: "org-b",
      teamGroupId: null,
    });
  });
});
