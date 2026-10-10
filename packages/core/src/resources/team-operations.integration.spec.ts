import { getHeader } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";

const state = vi.hoisted(() => ({
  groups: new Map<
    string,
    { orgId: string; members: string[]; isTeam: boolean }
  >(),
  orgMembers: new Set<string>(),
  resources: new Map<
    string,
    {
      id: string;
      owner: string;
      path: string;
      content: string;
      mimeType: string;
      size: number;
      createdAt: number;
      updatedAt: number;
      createdBy: "user";
      visibility: "workspace";
      threadId: null;
      runId: null;
      expiresAt: null;
      metadata: null;
    }
  >(),
  lookupFailure: false,
  writes: vi.fn(),
  deletes: vi.fn(),
  seeds: vi.fn(),
  nextId: 0,
}));

vi.mock("../org/membership.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/membership.js")>()),
  isOrgMember: async (orgId: string, email: string) =>
    state.orgMembers.has(`${orgId}:${email}`),
}));

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  isProductionServerlessFunctionRuntime: () => true,
  getDbExec: () => ({
    execute: async ({ sql, args }: { sql: string; args: unknown[] }) => {
      if (sql.includes("SELECT * FROM public.workspace_user_groups")) {
        if (state.lookupFailure) throw new Error("team lookup unavailable");
        const [orgId, id] = args;
        const group = state.groups.get(String(id));
        return {
          rows:
            group && group.orgId === orgId
              ? [
                  {
                    id,
                    org_id: group.orgId,
                    name: "Example",
                    member_emails_json: JSON.stringify(group.members),
                    is_team: group.isTeam,
                    lead_emails_json: "[]",
                    created_at: 0,
                    updated_at: 0,
                  },
                ]
              : [],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 0 };
    },
  }),
}));

vi.mock("../server/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/auth.js")>()),
  getSession: async (event: Parameters<typeof getHeader>[0]) => ({
    email: getHeader(event, "x-test-actor"),
  }),
}));

vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/context.js")>()),
  getOrgContext: async (event: Parameters<typeof getHeader>[0]) => ({
    orgId: getHeader(event, "x-test-org"),
    role: getHeader(event, "x-test-role") ?? "member",
  }),
}));

vi.mock("./store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store.js")>()),
  ensurePersonalDefaults: () => state.seeds(),
  resourceGetByPath: async (owner: string, path: string) =>
    state.resources.get(`${owner}:${path}`) ?? null,
  resourceGet: async (id: string) =>
    [...state.resources.values()].find((row) => row.id === id) ?? null,
  resourceList: async (owner: string, prefix?: string) =>
    [...state.resources.values()]
      .filter(
        (row) =>
          row.owner === owner && (!prefix || row.path.startsWith(prefix)),
      )
      .map(({ content: _content, ...meta }) => meta),
  resourcePut: async (
    owner: string,
    path: string,
    content: string,
    mimeType = "text/markdown",
  ) => {
    state.writes();
    const old = state.resources.get(`${owner}:${path}`);
    const row = {
      id: old?.id ?? `r${++state.nextId}`,
      owner,
      path,
      content,
      mimeType,
      size: content.length,
      createdAt: old?.createdAt ?? 1,
      updatedAt: (old?.updatedAt ?? 0) + 1,
      createdBy: "user" as const,
      visibility: "workspace" as const,
      threadId: null,
      runId: null,
      expiresAt: null,
      metadata: null,
    };
    state.resources.set(`${owner}:${path}`, row);
    return row;
  },
  resourceMove: async (id: string, path: string) => {
    const entry = [...state.resources.entries()].find(
      ([, row]) => row.id === id,
    );
    if (!entry) return false;
    state.resources.delete(entry[0]);
    state.resources.set(`${entry[1].owner}:${path}`, { ...entry[1], path });
    return true;
  },
  resourceDeleteIfCurrent: async (resource: {
    owner: string;
    path: string;
    id: string;
    updatedAt: number;
  }) => {
    state.deletes();
    const key = `${resource.owner}:${resource.path}`;
    const row = state.resources.get(key);
    if (!row || row.id !== resource.id || row.updatedAt !== resource.updatedAt)
      return false;
    state.resources.delete(key);
    return true;
  },
}));

import { createResourceScriptEntries } from "../server/agent-chat/script-entries.js";
import { createResourcesPlugin } from "../server/resources-plugin.js";

const root = "/_agent-native/resources";
const member = "member@example.test";
const teamOwner = "__team__:team-a";
const path = "notes/team.md";

describe("team resources through the mounted HTTP and agent operations", () => {
  let nitroApp: {
    h3: {
      "~middleware": Array<
        (event: unknown, next: () => Promise<unknown>) => Promise<unknown>
      >;
    };
  };
  let agent: Awaited<
    ReturnType<typeof createResourceScriptEntries>
  >["resources"];

  beforeEach(async () => {
    state.groups.clear();
    state.orgMembers.clear();
    state.resources.clear();
    state.lookupFailure = false;
    state.writes.mockClear();
    state.deletes.mockClear();
    state.seeds.mockClear();
    state.nextId = 0;
    state.groups.set("team-a", {
      orgId: "org-a",
      members: [member],
      isTeam: true,
    });
    state.groups.set("team-b", {
      orgId: "org-a",
      members: [member],
      isTeam: true,
    });
    state.orgMembers.add(`org-a:${member}`);
    state.orgMembers.add("org-a:admin@example.test");
    nitroApp = { h3: { "~middleware": [] } };
    await createResourcesPlugin()(nitroApp);
    agent = (await createResourceScriptEntries()).resources;
  });

  const as = <T>(actor: string, orgId: string, run: () => Promise<T>) =>
    runWithRequestContext({ userEmail: actor, orgId }, run);

  async function http(
    actor: string,
    orgId: string,
    suffix: string,
    method = "GET",
    body?: object,
    role = "member",
  ) {
    const request = new Request(`https://example.test${root}${suffix}`, {
      method,
      headers: {
        "x-test-actor": actor,
        "x-test-org": orgId,
        "x-test-role": role,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const event = {
      method,
      req: request,
      url: new URL(request.url),
      path: `${root}${suffix}`,
      context: {},
      res: { status: 200, headers: new Headers() },
    };
    let index = 0;
    const next = async (): Promise<unknown> => {
      const middleware = nitroApp.h3["~middleware"][index++];
      return middleware ? middleware(event, next) : { error: "Not found" };
    };
    const result = await next();
    return result instanceof Response
      ? result
      : new Response(JSON.stringify(result), { status: event.res.status });
  }

  it("shares one member's agent list/read/write/delete and mounted list/tree/ID CRUD", async () => {
    expect(
      await (
        await http(member, "org-a", "?scope=team&teamGroupId=team-a")
      ).json(),
    ).toEqual({ resources: [] });
    expect(
      await as(member, "org-a", () =>
        agent.run({
          action: "list",
          scope: "team",
          teamGroupId: "team-a",
          format: "json",
        }),
      ),
    ).toBe("[]");
    expect(
      await as(member, "org-a", () =>
        agent.run({
          action: "write",
          scope: "team",
          teamGroupId: "team-a",
          path,
          content: "agent content",
        }),
      ),
    ).toContain("Wrote resource");
    const id = state.resources.get(`${teamOwner}:${path}`)?.id;
    expect(id).toBeTruthy();
    expect(
      await as(member, "org-a", () =>
        agent.run({
          action: "read",
          scope: "team",
          teamGroupId: "team-a",
          path,
        }),
      ),
    ).toBe("agent content");
    expect(
      (
        await (
          await http(member, "org-a", "/tree?scope=team&teamGroupId=team-a")
        ).json()
      ).tree[0].name,
    ).toBe("notes");
    const idResponse = await http(member, "org-a", `/${id}?teamGroupId=team-a`);
    expect({
      status: idResponse.status,
      body: await idResponse.json(),
    }).toMatchObject({
      status: 200,
      body: { content: "agent content" },
    });
    expect(
      (
        await (
          await http(member, "org-a", `/${id}`, "PUT", {
            teamGroupId: "team-a",
            content: "http content",
          })
        ).json()
      ).content,
    ).toBe("http content");
    expect(
      (
        await (
          await http(
            member,
            "org-a",
            "?scope=team&teamGroupId=team-a&prefix=notes%2F",
          )
        ).json()
      ).resources,
    ).toHaveLength(1);
    expect(
      await as(member, "org-a", () =>
        agent.run({
          action: "delete",
          scope: "team",
          teamGroupId: "team-a",
          path,
        }),
      ),
    ).toContain("Deleted resource");
    expect(
      await http(member, "org-a", "/", "POST", {
        teamGroupId: "team-a",
        path,
        content: "new content",
      }),
    ).toHaveProperty("status", 201);
    const nextId = state.resources.get(`${teamOwner}:${path}`)?.id;
    expect(
      await http(member, "org-a", `/${nextId}?teamGroupId=team-a`, "DELETE"),
    ).toHaveProperty("status", 200);
    expect(state.resources.has(`${teamOwner}:${path}`)).toBe(false);
  });

  it("returns valid team content beginning with Error: without treating stdout as failure", async () => {
    const content = "Error: legitimate text";
    await as(member, "org-a", () =>
      agent.run({
        action: "write",
        scope: "team",
        teamGroupId: "team-a",
        path,
        content,
      }),
    );
    expect(
      await as(member, "org-a", () =>
        agent.run({
          action: "read",
          scope: "team",
          teamGroupId: "team-a",
          path,
        }),
      ),
    ).toBe(content);
    const id = state.resources.get(`${teamOwner}:${path}`)?.id;
    expect(
      (await (await http(member, "org-a", `/${id}?teamGroupId=team-a`)).json())
        .content,
    ).toBe(content);
  });

  it.each([
    ["nonmember", "other@example.test", "org-a", "team-a", "member"],
    ["admin nonmember", "admin@example.test", "org-a", "team-a", "admin"],
    ["wrong org", member, "org-b", "team-a", "member"],
    ["unmarked", member, "org-a", "team-a", "member"],
    ["unknown", member, "org-a", "missing", "member"],
    ["malformed ID", member, "org-a", " team-a", "member"],
  ])(
    "denies %s before returning content or writing",
    async (kind, actor, orgId, groupId, role) => {
      if (kind === "unmarked") state.groups.get("team-a")!.isTeam = false;
      const seeded = await as(member, "org-a", () =>
        agent.run({
          action: "write",
          scope: "team",
          teamGroupId: "team-b",
          path,
          content: "retained",
        }),
      );
      expect(seeded).toContain("Wrote resource");
      state.writes.mockClear();
      const id = state.resources.get(`__team__:team-b:${path}`)?.id;
      for (const action of ["list", "read", "write", "delete"] as const) {
        await expect(
          as(actor, orgId, () =>
            agent.run({
              action,
              scope: "team",
              teamGroupId: groupId,
              path,
              content: "leak",
            }),
          ),
        ).rejects.toThrow();
      }
      expect(
        (
          await http(
            actor,
            orgId,
            `?scope=team&teamGroupId=${encodeURIComponent(groupId)}`,
            "GET",
            undefined,
            role,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            actor,
            orgId,
            `/tree?scope=team&teamGroupId=${encodeURIComponent(groupId)}`,
            "GET",
            undefined,
            role,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            actor,
            orgId,
            `/${id}?teamGroupId=${encodeURIComponent(groupId)}`,
            "GET",
            undefined,
            role,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            actor,
            orgId,
            `/`,
            "POST",
            { teamGroupId: groupId, path, content: "leak" },
            role,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            actor,
            orgId,
            `/${id}`,
            "PUT",
            { teamGroupId: groupId, content: "leak" },
            role,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            actor,
            orgId,
            `/${id}?teamGroupId=${encodeURIComponent(groupId)}`,
            "DELETE",
            undefined,
            role,
          )
        ).status,
      ).toBe(404);
      expect(state.writes).not.toHaveBeenCalled();
      expect(state.deletes).not.toHaveBeenCalled();
      expect(state.seeds).not.toHaveBeenCalled();
      expect(state.resources.get(`__team__:team-b:${path}`)?.content).toBe(
        "retained",
      );
    },
  );

  it.each(["team removal", "org departure", "team deletion"])(
    "denies retained rows after %s",
    async (loss) => {
      await as(member, "org-a", () =>
        agent.run({
          action: "write",
          scope: "team",
          teamGroupId: "team-a",
          path,
          content: "retained",
        }),
      );
      const id = state.resources.get(`${teamOwner}:${path}`)?.id;
      if (loss === "team removal") state.groups.get("team-a")!.members = [];
      if (loss === "org departure") state.orgMembers.delete(`org-a:${member}`);
      if (loss === "team deletion") state.groups.delete("team-a");
      state.writes.mockClear();
      await expect(
        as(member, "org-a", () =>
          agent.run({
            action: "read",
            scope: "team",
            teamGroupId: "team-a",
            path,
          }),
        ),
      ).rejects.toThrow();
      expect(
        (await http(member, "org-a", `/${id}?teamGroupId=team-a`)).status,
      ).toBe(404);
      expect(
        (await http(member, "org-a", `/${id}?teamGroupId=team-a`, "DELETE"))
          .status,
      ).toBe(404);
      expect(state.resources.get(`${teamOwner}:${path}`)?.content).toBe(
        "retained",
      );
      expect(state.writes).not.toHaveBeenCalled();
      expect(state.deletes).not.toHaveBeenCalled();
    },
  );

  it("does not confuse an operational lookup failure with an authorized empty team", async () => {
    expect(
      (
        await (
          await http(member, "org-a", "?scope=team&teamGroupId=team-a")
        ).json()
      ).resources,
    ).toEqual([]);
    state.lookupFailure = true;
    await expect(
      as(member, "org-a", () =>
        agent.run({ action: "list", scope: "team", teamGroupId: "team-a" }),
      ),
    ).rejects.toThrow("team lookup unavailable");
    expect(
      (await http(member, "org-a", "?scope=team&teamGroupId=team-a")).status,
    ).toBe(500);
    expect(state.seeds).not.toHaveBeenCalled();
  });
});
