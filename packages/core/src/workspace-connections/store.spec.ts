import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getMethod: (event: { _method: string }) => event._method,
  getHeader: (event: { _headers?: Record<string, string> }, name: string) =>
    event._headers?.[name.toLowerCase()],
  getRequestHeader: (
    event: { _headers?: Record<string, string> },
    name: string,
  ) => event._headers?.[name.toLowerCase()],
  getQuery: () => ({}),
  getRequestURL: () =>
    new URL(
      "http://localhost/_agent-native/actions/bulk-update-workspace-user-groups",
    ),
  setResponseStatus: (event: { _status?: number }, status: number) => {
    event._status = status;
  },
  setResponseHeader: () => {},
}));

vi.mock("../server/framework-request-handler.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/framework-request-handler.js")
  >()),
  getH3App: (app: unknown) => app,
}));

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => sharedClient,
    isProductionServerlessFunctionRuntime:
      actual.isProductionServerlessFunctionRuntime,
    retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
  };
});

interface FrameworkClient {
  execute(arg: string | { sql: string; args?: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
  transaction?<T>(fn: (tx: FrameworkClient) => Promise<T>): Promise<T>;
}

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};
let previousSecretsEncryptionKey: string | undefined;

beforeAll(async () => {
  previousSecretsEncryptionKey = process.env.SECRETS_ENCRYPTION_KEY;
  process.env.SECRETS_ENCRYPTION_KEY = "workspace-connections-test-key";
  pglite = await createTestPglite();
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = await pglite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = (await stmt.all(...args)) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = await stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
    transaction: (fn) =>
      pglite.db.transaction(async (tx) =>
        fn({
          execute: async (arg) => {
            const sql = typeof arg === "string" ? arg : arg.sql;
            const args = typeof arg === "string" ? [] : (arg.args ?? []);
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
});

beforeEach(async () => {
  delete process.env.SLACK_BOT_TOKEN;
  try {
    await pglite.prepare("DELETE FROM workspace_connection_grants").run();
  } catch {
    // The first test creates the table through the store initializer.
  }
  try {
    await pglite.prepare("DELETE FROM workspace_connections").run();
  } catch {
    // The first test creates the table through the store initializer.
  }
  try {
    await pglite.prepare("DELETE FROM workspace_user_groups").run();
  } catch {
    // Group tests create the table on demand.
  }
  try {
    await pglite.prepare("DELETE FROM org_members").run();
  } catch {
    // Most store tests do not need organization membership rows.
  }
  try {
    await pglite.prepare("DELETE FROM app_secrets").run();
  } catch {
    // The first secret-backed test creates the table through the store.
  }
  try {
    await pglite.prepare("DELETE FROM settings").run();
  } catch {
    // Credential fallback tests create the settings table on demand.
  }
});

afterAll(async () => {
  if (previousSecretsEncryptionKey === undefined) {
    delete process.env.SECRETS_ENCRYPTION_KEY;
  } else {
    process.env.SECRETS_ENCRYPTION_KEY = previousSecretsEncryptionKey;
  }
  await pglite.close();
});

describe("workspace connection store", () => {
  it("does not run runtime schema DDL in hosted function invocations", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousNetlifyFunctionName = process.env.NETLIFY_FUNCTION_NAME;
    process.env.NODE_ENV = "production";
    process.env.NETLIFY_FUNCTION_NAME = "workspace-groups-test";
    const execute = vi.spyOn(sharedClient, "execute");
    try {
      const { ensureWorkspaceUserGroupsTable } = await import("./groups.js");
      await ensureWorkspaceUserGroupsTable();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousNetlifyFunctionName === undefined) {
        delete process.env.NETLIFY_FUNCTION_NAME;
      } else {
        process.env.NETLIFY_FUNCTION_NAME = previousNetlifyFunctionName;
      }
    }
  });

  it("describes app-level access semantics", async () => {
    const { getWorkspaceConnectionAppAccess } = await import("./store.js");
    const baseConnection = {
      id: "conn-1",
      label: "Team Slack",
      allowedApps: ["dispatch"],
    };

    expect(
      getWorkspaceConnectionAppAccess(
        { ...baseConnection, allowedApps: [] },
        "brain",
      ),
    ).toMatchObject({
      available: true,
      mode: "all-apps",
      grantId: null,
    });

    expect(
      getWorkspaceConnectionAppAccess(
        { ...baseConnection, allowedApps: ["brain"] },
        "brain",
      ),
    ).toMatchObject({
      available: true,
      mode: "allowed-app",
      grantId: null,
    });

    expect(
      getWorkspaceConnectionAppAccess(baseConnection, "brain", [
        { id: "grant-1", connectionId: "conn-1", appId: "brain" },
      ]),
    ).toMatchObject({
      available: true,
      mode: "explicit-grant",
      grantId: "grant-1",
    });

    expect(
      getWorkspaceConnectionAppAccess(baseConnection, "brain"),
    ).toMatchObject({
      available: false,
      mode: "unavailable",
      grantId: null,
    });
  });

  it("summarizes provider access for an app without exposing secret values", async () => {
    const { summarizeWorkspaceConnectionProviderForApp } =
      await import("./store.js");
    const summary = summarizeWorkspaceConnectionProviderForApp({
      providerId: "slack",
      appId: "brain",
      includeConnections: "all",
      connections: [
        {
          id: "conn-open",
          provider: "slack",
          label: "Open Slack",
          accountId: null,
          accountLabel: "Acme",
          status: "connected",
          scopes: [],
          config: {},
          allowedApps: [],
          allowedUsers: [],
          credentialRefs: [
            {
              key: "SLACK_BOT_TOKEN",
              scope: "org",
              value: "xoxb-should-not-leak",
            },
          ],
          ownerEmail: "alice@example.com",
          orgId: "org-1",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastCheckedAt: null,
          lastError: null,
        },
        {
          id: "conn-dispatch",
          provider: "slack",
          label: "Dispatch Slack",
          accountId: null,
          accountLabel: null,
          status: "needs_reauth",
          scopes: [],
          config: {},
          allowedApps: ["dispatch"],
          allowedUsers: [],
          credentialRefs: [],
          ownerEmail: "alice@example.com",
          orgId: "org-1",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastCheckedAt: null,
          lastError: "Expired token",
        },
      ],
      grants: [],
    });

    expect(summary).toMatchObject({
      appId: "brain",
      provider: "slack",
      grantState: "connected",
      grantAvailability: "available",
      connectionCount: 2,
      grantedConnectionCount: 1,
      activeConnectionCount: 1,
      ungrantedConnectionCount: 1,
      unhealthyGrantedConnectionCount: 0,
      hasWorkspaceConnection: true,
      hasGrantedWorkspaceConnection: true,
      hasActiveWorkspaceConnection: true,
    });
    expect(summary.connections).toHaveLength(2);
    expect(summary.connections[0].credentialRefs[0]).toEqual({
      key: "SLACK_BOT_TOKEN",
      scope: "org",
      provider: undefined,
      label: undefined,
      source: "connection",
    });
    expect(JSON.stringify(summary)).not.toContain("xoxb-should-not-leak");
  });

  it("summarizes provider readiness with required credential refs and app grants", async () => {
    const { summarizeWorkspaceConnectionProviderReadiness } =
      await import("./store.js");
    const readinessInput = {
      provider: {
        id: "github",
        credentialKeys: [
          { key: "GITHUB_TOKEN", required: true },
          { key: "GITHUB_WEBHOOK_SECRET", required: false },
        ],
      },
      appId: "analytics",
      connections: [
        {
          id: "conn-github",
          provider: "github",
          label: "GitHub",
          accountId: null,
          accountLabel: null,
          status: "connected",
          scopes: [],
          config: {},
          allowedApps: ["brain"],
          allowedUsers: [],
          credentialRefs: [],
          ownerEmail: "alice@example.com",
          orgId: "org-1",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastCheckedAt: null,
          lastError: null,
        },
      ],
      grants: [
        {
          id: "grant-analytics",
          connectionId: "conn-github",
          provider: "github",
          appId: "analytics",
          scopes: [],
          config: {},
          credentialRefs: [],
          grantedByEmail: "alice@example.com",
          ownerEmail: "alice@example.com",
          orgId: "org-1",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    } satisfies Parameters<
      typeof summarizeWorkspaceConnectionProviderReadiness
    >[0];
    const readiness =
      summarizeWorkspaceConnectionProviderReadiness(readinessInput);

    expect(readiness).toMatchObject({
      status: "needs_credentials",
      connectionCount: 1,
      activeConnectionCount: 1,
      readyConnectionCount: 0,
      requiredCredentialKeys: ["GITHUB_TOKEN"],
      missingRequiredCredentialKeys: ["GITHUB_TOKEN"],
      appGrant: {
        grantState: "connected",
        grantAvailability: "available",
        grantedConnectionCount: 1,
        explicitGrantCount: 1,
      },
    });

    const grantScopedRefReadiness =
      summarizeWorkspaceConnectionProviderReadiness({
        ...readinessInput,
        grants: [
          {
            ...readinessInput.grants[0],
            credentialRefs: [{ key: "GITHUB_TOKEN", scope: "org" }],
          },
        ],
      });

    expect(grantScopedRefReadiness).toMatchObject({
      status: "ready",
      readyConnectionCount: 1,
      missingRequiredCredentialKeys: [],
    });
  });

  it("scopes personal list, upsert, and delete to the request user", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      deleteWorkspaceConnection,
      listWorkspaceConnections,
      upsertWorkspaceConnection,
    } = await import("./store.js");
    const { registerWorkspaceConnectionLifecycleListener } =
      await import("./lifecycle.js");
    const lifecycle = vi.fn();
    const unregister = registerWorkspaceConnectionLifecycleListener(lifecycle);

    await runWithRequestContext({ userEmail: "alice@example.com" }, () =>
      upsertWorkspaceConnection({
        id: "conn-personal",
        provider: "google",
        label: "Alice Google",
      }),
    );

    const aliceList = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      () => listWorkspaceConnections(),
    );
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0]).toMatchObject({
      id: "conn-personal",
      ownerEmail: "alice@example.com",
      orgId: null,
    });

    await expect(
      runWithRequestContext({ userEmail: "bob@example.com" }, () =>
        upsertWorkspaceConnection({
          id: "conn-personal",
          provider: "google",
          label: "Bob Google",
        }),
      ),
    ).rejects.toThrow(/outside the current request scope/i);

    const bobList = await runWithRequestContext(
      { userEmail: "bob@example.com" },
      () => listWorkspaceConnections(),
    );
    expect(bobList).toEqual([]);

    const bobDeleted = await runWithRequestContext(
      { userEmail: "bob@example.com" },
      () => deleteWorkspaceConnection("conn-personal"),
    );
    expect(bobDeleted).toBe(false);
    expect(lifecycle).not.toHaveBeenCalled();

    const aliceDeleted = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      () => deleteWorkspaceConnection("conn-personal"),
    );
    expect(aliceDeleted).toBe(true);
    expect(lifecycle).toHaveBeenCalledWith({
      type: "connection-deleted",
      connectionId: "conn-personal",
      ownerEmail: "alice@example.com",
      orgId: null,
    });
    unregister();
  });

  it("uses active org scope when present", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      getWorkspaceConnection,
      listWorkspaceConnections,
      upsertWorkspaceConnection,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-org",
          provider: "slack",
          label: "Team Slack",
          allowedApps: ["dispatch"],
        }),
    );

    const bobList = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ appId: "dispatch" }),
    );
    expect(bobList).toHaveLength(1);
    expect(bobList[0]).toMatchObject({
      id: "conn-org",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });

    const updated = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-org",
          provider: "slack",
          label: "Updated Team Slack",
        }),
    );
    expect(updated.label).toBe("Updated Team Slack");

    const otherOrg = await runWithRequestContext(
      { userEmail: "carol@example.com", orgId: "org-2" },
      () => getWorkspaceConnection("conn-org"),
    );
    expect(otherOrg).toBeNull();
  });

  it("normalizes and enforces connection-level user allowlists", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnections,
      listWorkspaceConnectionsForUser,
      listWorkspaceConnectionsForApp,
      normalizeWorkspaceConnectionAllowedUsers,
      resolveWorkspaceConnectionForApp,
      upsertWorkspaceConnection,
    } = await import("./store.js");

    expect(
      normalizeWorkspaceConnectionAllowedUsers([
        " Alice@Example.com ",
        "alice@example.com",
        "BOB@example.com",
        "",
      ]),
    ).toEqual(["alice@example.com", "bob@example.com"]);

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-user-open",
          provider: "slack",
          label: "Everyone Slack",
        });
        await upsertWorkspaceConnection({
          id: "conn-user-alice",
          provider: "slack",
          label: "Alice Slack",
          allowedUsers: [" Alice@Example.com ", "alice@example.com"],
        });
        await upsertWorkspaceConnection({
          id: "conn-user-bob",
          provider: "slack",
          label: "Bob Slack",
          allowedUsers: ["BOB@example.com"],
        });

        const updated = await upsertWorkspaceConnection({
          id: "conn-user-alice",
          provider: "slack",
          label: "Alice Slack renamed",
        });
        expect(updated.allowedUsers).toEqual(["alice@example.com"]);
      },
    );

    const managementConnections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ provider: "slack" }),
    );
    expect(
      managementConnections.map((connection) => connection.id).sort(),
    ).toEqual(["conn-user-alice", "conn-user-bob", "conn-user-open"]);

    const bobVisibleConnections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnectionsForUser({ provider: "slack" }),
    );
    expect(
      bobVisibleConnections.map((connection) => connection.id).sort(),
    ).toEqual(["conn-user-bob", "conn-user-open"]);

    const bobConnections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ provider: "slack", appId: "brain" }),
    );
    expect(bobConnections.map((connection) => connection.id).sort()).toEqual([
      "conn-user-bob",
      "conn-user-open",
    ]);

    const bobAppConnections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        listWorkspaceConnectionsForApp({ appId: "brain", provider: "slack" }),
    );
    expect(bobAppConnections.map((connection) => connection.id).sort()).toEqual(
      ["conn-user-bob", "conn-user-open"],
    );

    const bobCannotResolveAlice = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "slack",
          connectionId: "conn-user-alice",
        }),
    );
    expect(bobCannotResolveAlice).toMatchObject({
      available: false,
      connection: null,
      appAccess: null,
    });
    expect(bobCannotResolveAlice.reason).toMatch(/not found/i);

    const aliceCanResolve = await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "slack",
          connectionId: "conn-user-alice",
        }),
    );
    expect(aliceCanResolve).toMatchObject({
      available: true,
      connection: {
        id: "conn-user-alice",
        allowedUsers: ["alice@example.com"],
      },
    });
  });

  it("resolves connection access through mutable workspace user groups", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { upsertWorkspaceUserGroup } = await import("./groups.js");
    const { upsertWorkspaceConnection, resolveWorkspaceConnectionForApp } =
      await import("./store.js");

    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS org_members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at BIGINT NOT NULL DEFAULT 0,
        federation_removal_pending_at INTEGER
      )
    `);
    await pglite
      .prepare(
        "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("member-alice", "org-groups", "alice@example.com", "owner", 1);
    await pglite
      .prepare(
        "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("member-bob", "org-groups", "bob@example.com", "member", 2);

    const connectionId = await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-groups" },
      async () => {
        const group = await upsertWorkspaceUserGroup({
          name: "Rev Ops",
          memberEmails: ["bob@example.com"],
        });
        const connection = await upsertWorkspaceConnection({
          id: "conn-rev-ops",
          provider: "hubspot",
          label: "Rev Ops HubSpot",
          allowedUserGroups: [group.id],
        });
        return connection.id;
      },
    );

    const bobCanResolve = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-groups" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "dispatch",
          provider: "hubspot",
          connectionId,
        }),
    );
    expect(bobCanResolve.available).toBe(true);

    await pglite
      .prepare("DELETE FROM org_members WHERE id = ?")
      .run("member-bob");
    const bobAfterOrgRemoval = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-groups" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "dispatch",
          provider: "hubspot",
          connectionId,
        }),
    );
    expect(bobAfterOrgRemoval.available).toBe(false);
    await pglite
      .prepare(
        "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("member-bob", "org-groups", "bob@example.com", "member", 2);

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-groups" },
      async () => {
        const groups = await import("./groups.js");
        const [group] = await groups.listWorkspaceUserGroups();
        await groups.upsertWorkspaceUserGroup({
          id: group.id,
          name: group.name,
          memberEmails: [],
        });
      },
    );

    const bobAfterRemoval = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-groups" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "dispatch",
          provider: "hubspot",
          connectionId,
        }),
    );
    expect(bobAfterRemoval.available).toBe(false);
  });

  it("converts and deletes a group without losing grants or opening restricted connections", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { upsertWorkspaceUserGroup, workspaceUserGroupsIncludeUser } =
      await import("./groups.js");
    const deleteAction = (
      await import("./actions/delete-workspace-user-group.js")
    ).default;
    const upsertAction = (
      await import("./actions/upsert-workspace-user-group.js")
    ).default;
    const { upsertWorkspaceConnection, resolveWorkspaceConnectionForApp } =
      await import("./store.js");
    await pglite.exec(`CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', joined_at BIGINT NOT NULL DEFAULT 0,
      federation_removal_pending_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS lifecycle_resources (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lifecycle_shares (resource_id TEXT, principal_id TEXT, role TEXT);`);
    await pglite.exec(
      "DELETE FROM lifecycle_resources; DELETE FROM lifecycle_shares",
    );
    for (const [id, email, role] of [
      ["owner", "owner@example.com", "owner"],
      ["member", "member@example.com", "member"],
    ]) {
      await pglite
        .prepare(
          "INSERT INTO org_members (id, org_id, email, role) VALUES (?, ?, ?, ?)",
        )
        .run(id, "org-lifecycle", email, role);
    }
    const asOwner = <T>(run: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "owner@example.com", orgId: "org-lifecycle" },
        run,
      );
    const asMember = <T>(run: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "member@example.com", orgId: "org-lifecycle" },
        run,
      );
    const group = await asOwner(() =>
      upsertWorkspaceUserGroup({
        name: "Existing group",
        memberEmails: ["member@example.com"],
      }),
    );
    const other = await asOwner(() =>
      upsertWorkspaceUserGroup({
        name: "Other group",
        memberEmails: [],
      }),
    );
    await pglite
      .prepare("INSERT INTO lifecycle_resources (id, payload) VALUES (?, ?)")
      .run("private-resource", "retained payload");
    await pglite
      .prepare("INSERT INTO lifecycle_shares VALUES (?, ?, ?)")
      .run("private-resource", group.id, "viewer");
    await asOwner(() =>
      upsertWorkspaceConnection({
        id: "conn-lifecycle",
        provider: "github",
        allowedUserGroups: [group.id, other.id],
      }),
    );
    await asOwner(() =>
      upsertWorkspaceConnection({
        id: "conn-last-group",
        provider: "github",
        allowedUserGroups: [group.id],
      }),
    );
    const row = async (
      table:
        | "workspace_user_groups"
        | "workspace_connections"
        | "lifecycle_shares"
        | "lifecycle_resources",
      id: string,
    ) =>
      pglite
        .prepare(
          `SELECT * FROM ${table} WHERE ${table === "lifecycle_shares" ? "resource_id" : "id"} = ?`,
        )
        .get(id);
    const beforeGroup = await row("workspace_user_groups", group.id);
    const beforeConnection = await row(
      "workspace_connections",
      "conn-lifecycle",
    );
    const beforeShare = await row("lifecycle_shares", "private-resource");
    const access = () =>
      asMember(() =>
        resolveWorkspaceConnectionForApp({
          appId: "dispatch",
          connectionId: "conn-lifecycle",
        }),
      );
    expect((await access()).available).toBe(true);
    expect(
      await workspaceUserGroupsIncludeUser(
        "org-lifecycle",
        [group.id],
        "member@example.com",
      ),
    ).toBe(true);

    const converted = await asOwner(() =>
      upsertAction.run(
        {
          id: group.id,
          name: group.name,
          memberEmails: group.memberEmails,
          isTeam: true,
        },
        { userEmail: "owner@example.com", orgId: "org-lifecycle" },
      ),
    );
    expect(converted).toMatchObject({
      id: group.id,
      isTeam: true,
      memberEmails: group.memberEmails,
      leadEmails: [],
    });
    expect(await row("workspace_user_groups", group.id)).toMatchObject({
      id: group.id,
      org_id: "org-lifecycle",
      name: beforeGroup?.name,
      member_emails_json: beforeGroup?.member_emails_json,
      created_by_email: beforeGroup?.created_by_email,
      created_at: beforeGroup?.created_at,
      is_team: true,
    });
    expect(await row("workspace_connections", "conn-lifecycle")).toEqual(
      beforeConnection,
    );
    expect(await row("lifecycle_shares", "private-resource")).toEqual(
      beforeShare,
    );
    expect((await access()).available).toBe(true);

    const originalTransaction = sharedClient.transaction!.bind(sharedClient);
    const failingCleanup = vi
      .spyOn(sharedClient, "transaction")
      .mockImplementation((fn) =>
        originalTransaction((tx) =>
          fn({
            execute: async (arg) => {
              const sql = typeof arg === "string" ? arg : arg.sql;
              if (
                /UPDATE public\.workspace_connections SET allowed_user_groups_json/.test(
                  sql,
                ) &&
                typeof arg !== "string" &&
                arg.args?.includes("conn-last-group")
              )
                throw new Error("Connection cleanup failed");
              return tx.execute(arg);
            },
          }),
        ),
      );
    try {
      await expect(
        asOwner(() =>
          deleteAction.run(
            { id: group.id },
            {
              userEmail: "owner@example.com",
              orgId: "org-lifecycle",
            },
          ),
        ),
      ).rejects.toThrow(/Connection cleanup failed/);
    } finally {
      failingCleanup.mockRestore();
    }
    expect(await row("workspace_user_groups", group.id)).not.toBeNull();
    expect(await row("workspace_connections", "conn-lifecycle")).toEqual(
      beforeConnection,
    );
    expect(await row("workspace_connections", "conn-last-group")).toMatchObject(
      {
        allowed_user_groups_json: JSON.stringify([group.id]),
        status: "connected",
      },
    );

    await expect(
      asMember(() =>
        deleteAction.run(
          { id: group.id },
          {
            userEmail: "member@example.com",
            orgId: "org-lifecycle",
          },
        ),
      ),
    ).rejects.toThrow(/admins/);
    expect(
      await asOwner(() =>
        deleteAction.run(
          { id: group.id },
          {
            userEmail: "owner@example.com",
            orgId: "org-lifecycle",
          },
        ),
      ),
    ).toEqual({ id: group.id, deleted: true });
    expect(await row("workspace_user_groups", group.id)).toBeFalsy();
    expect(await row("workspace_user_groups", other.id)).not.toBeNull();
    expect(await row("workspace_connections", "conn-lifecycle")).toMatchObject({
      allowed_user_groups_json: JSON.stringify([other.id]),
    });
    expect(await row("workspace_connections", "conn-last-group")).toMatchObject(
      {
        allowed_user_groups_json: "[]",
        status: "disabled",
      },
    );
    expect((await access()).available).toBe(false);
    expect(
      (
        await asMember(() =>
          resolveWorkspaceConnectionForApp({
            appId: "dispatch",
            connectionId: "conn-last-group",
          }),
        )
      ).available,
    ).toBe(false);
    expect(
      await workspaceUserGroupsIncludeUser(
        "org-lifecycle",
        [group.id],
        "member@example.com",
      ),
    ).toBe(false);
    expect(await row("lifecycle_shares", "private-resource")).toEqual(
      beforeShare,
    );
    expect(await row("lifecycle_resources", "private-resource")).toMatchObject({
      payload: "retained payload",
    });
    await expect(
      asOwner(() =>
        upsertWorkspaceUserGroup({
          id: group.id,
          name: group.name,
          memberEmails: [],
          isTeam: true,
        }),
      ),
    ).rejects.toThrow(/not found/);
  });

  it("rejects duplicate workspace user group names within an org", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { upsertWorkspaceUserGroup } = await import("./groups.js");

    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS org_members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at BIGINT NOT NULL DEFAULT 0,
        federation_removal_pending_at INTEGER
      )
    `);
    await pglite
      .prepare(
        "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("member-owner", "org-groups", "owner@example.com", "owner", 1);

    await runWithRequestContext(
      { userEmail: "owner@example.com", orgId: "org-groups" },
      () =>
        upsertWorkspaceUserGroup({
          name: "Rev Ops",
          memberEmails: [],
        }),
    );

    await expect(
      runWithRequestContext(
        { userEmail: "owner@example.com", orgId: "org-groups" },
        () =>
          upsertWorkspaceUserGroup({
            name: " rev ops ",
            memberEmails: [],
          }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects concurrent case-variant workspace group writes", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { listWorkspaceUserGroupsForOrg, upsertWorkspaceUserGroup } =
      await import("./groups.js");

    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS org_members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at BIGINT NOT NULL DEFAULT 0,
        federation_removal_pending_at INTEGER
      )
    `);

    for (let attempt = 0; attempt < 10; attempt++) {
      const orgId = `org-groups-concurrent-${attempt}`;
      await pglite
        .prepare(
          "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          `member-owner-${attempt}`,
          orgId,
          "owner@example.com",
          "owner",
          attempt,
        );

      const results = await Promise.allSettled(
        ["Finance", "finance"].map((name) =>
          runWithRequestContext({ userEmail: "owner@example.com", orgId }, () =>
            upsertWorkspaceUserGroup({
              name,
              memberEmails: [],
            }),
          ),
        ),
      );
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<unknown> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(
        String(rejected[0]?.reason?.message ?? rejected[0]?.reason),
      ).toMatch(/already exists/i);
      expect(await listWorkspaceUserGroupsForOrg(orgId)).toHaveLength(1);
    }
  });

  it("keeps group identity, team fields, and scoped update-only IDs", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      deleteWorkspaceUserGroup,
      listWorkspaceUserGroupsForOrg,
      updateWorkspaceUserGroupMembers,
      upsertWorkspaceUserGroup,
    } = await import("./groups.js");
    await pglite.exec(`CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', joined_at BIGINT NOT NULL DEFAULT 0,
      federation_removal_pending_at INTEGER
    )`);
    for (const [id, orgId, email] of [
      ["team-owner", "org-team", "owner@example.com"],
      ["team-member", "org-team", "member@example.com"],
      ["other-owner", "org-other", "owner@example.com"],
    ]) {
      await pglite
        .prepare("INSERT INTO org_members (id, org_id, email) VALUES (?, ?, ?)")
        .run(id, orgId, email);
    }
    await pglite
      .prepare("UPDATE org_members SET role = 'owner' WHERE id IN (?, ?)")
      .run("team-owner", "other-owner");
    const inOrg = <T>(orgId: string, operation: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "owner@example.com", orgId },
        operation,
      );
    const original = await inOrg("org-team", () =>
      upsertWorkspaceUserGroup({
        name: "Finance",
        memberEmails: [" Member@Example.com "],
      }),
    );
    expect(original.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(original).toMatchObject({
      isTeam: false,
      leadEmails: [],
      memberEmails: ["member@example.com"],
    });
    const converted = await inOrg("org-team", () =>
      upsertWorkspaceUserGroup({
        id: original.id,
        name: "Finance",
        memberEmails: original.memberEmails,
        isTeam: true,
        leadEmails: [" Member@Example.com ", "member@example.com"],
      }),
    );
    expect(converted).toMatchObject({
      id: original.id,
      isTeam: true,
      leadEmails: ["member@example.com"],
    });
    expect(
      (
        await inOrg("org-team", () => listWorkspaceUserGroupsForOrg("org-team"))
      )[0],
    ).toMatchObject(converted);
    const stored = await pglite
      .prepare(
        "SELECT is_team, lead_emails_json FROM workspace_user_groups WHERE id = ?",
      )
      .get(original.id);
    expect(stored).toMatchObject({
      is_team: true,
      lead_emails_json: '["member@example.com"]',
    });
    const renamed = await inOrg("org-team", () =>
      upsertWorkspaceUserGroup({
        id: original.id,
        name: "Finance Team",
        memberEmails: original.memberEmails,
      }),
    );
    expect(renamed).toMatchObject({
      id: original.id,
      isTeam: true,
      leadEmails: ["member@example.com"],
    });
    const removed = await inOrg("org-team", () =>
      updateWorkspaceUserGroupMembers({
        id: original.id,
        operation: "remove",
        memberEmails: ["member@example.com"],
      }),
    );
    expect(removed).toMatchObject({
      isTeam: true,
      memberEmails: [],
      leadEmails: [],
    });
    await expect(
      inOrg("org-team", () =>
        upsertWorkspaceUserGroup({
          id: original.id,
          name: "Finance Team",
          memberEmails: [],
          isTeam: false,
        }),
      ),
    ).rejects.toThrow(/cannot be converted back/i);
    await expect(
      inOrg("org-team", () =>
        upsertWorkspaceUserGroup({
          id: original.id,
          name: "Finance Team",
          memberEmails: [],
          leadEmails: ["missing@example.com"],
        }),
      ),
    ).rejects.toThrow(/must be group members/i);
    await expect(
      inOrg("org-other", () =>
        upsertWorkspaceUserGroup({
          id: original.id,
          name: "Finance Team",
          memberEmails: [],
        }),
      ),
    ).rejects.toThrow(/not found/i);
    expect(
      await inOrg("org-other", () =>
        listWorkspaceUserGroupsForOrg("org-other"),
      ),
    ).toEqual([]);
    await expect(
      inOrg("org-team", () =>
        upsertWorkspaceUserGroup({
          id: "missing-team-id",
          name: "Finance Team",
          memberEmails: [],
        }),
      ),
    ).rejects.toThrow(/not found/i);
    expect(
      await inOrg("org-team", () => listWorkspaceUserGroupsForOrg("org-team")),
    ).toEqual([removed]);
    expect(
      await inOrg("org-team", () => deleteWorkspaceUserGroup(original.id)),
    ).toBe(true);
    await expect(
      inOrg("org-team", () =>
        upsertWorkspaceUserGroup({
          id: original.id,
          name: "Finance Team",
          memberEmails: [],
        }),
      ),
    ).rejects.toThrow(/not found/i);
    const replacement = await inOrg("org-team", () =>
      upsertWorkspaceUserGroup({ name: "Finance Team", memberEmails: [] }),
    );
    expect(replacement.id).not.toBe(original.id);
    expect(
      await inOrg("org-team", () => listWorkspaceUserGroupsForOrg("org-team")),
    ).toEqual([replacement]);
  });

  it("serializes conversion with a concurrent group update", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { upsertWorkspaceUserGroup } = await import("./groups.js");
    await pglite.exec(`CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', joined_at BIGINT NOT NULL DEFAULT 0,
      federation_removal_pending_at INTEGER
    )`);
    await pglite
      .prepare("INSERT INTO org_members (id, org_id, email) VALUES (?, ?, ?)")
      .run("race-member", "org-race", "member@example.com");
    await pglite
      .prepare("UPDATE org_members SET role = 'owner' WHERE id = ?")
      .run("race-member");
    const inOrg = <T>(operation: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "member@example.com", orgId: "org-race" },
        operation,
      );
    const group = await inOrg(() =>
      upsertWorkspaceUserGroup({
        name: "Finance",
        memberEmails: ["member@example.com"],
      }),
    );
    const results = await Promise.all([
      inOrg(() =>
        upsertWorkspaceUserGroup({
          id: group.id,
          name: "Finance",
          memberEmails: group.memberEmails,
          isTeam: true,
          leadEmails: ["member@example.com"],
        }),
      ),
      inOrg(() =>
        upsertWorkspaceUserGroup({
          id: group.id,
          name: "Renamed Finance",
          memberEmails: group.memberEmails,
        }),
      ),
    ]);
    const row = await pglite
      .prepare(
        "SELECT name, is_team, lead_emails_json FROM workspace_user_groups WHERE id = ?",
      )
      .get(group.id);
    expect(results).toHaveLength(2);
    expect(row).toMatchObject({
      is_team: true,
      lead_emails_json: '["member@example.com"]',
    });
  });

  it("enforces team roles on direct and action writes and audits only committed deltas", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      upsertWorkspaceUserGroup,
      updateWorkspaceUserGroupMembers,
      setWorkspaceTeamLeads,
      getWorkspaceTeamForMember,
    } = await import("./groups.js");
    const bulk = (
      await import("./actions/bulk-update-workspace-user-groups.js")
    ).default;
    const upsertAction = (
      await import("./actions/upsert-workspace-user-group.js")
    ).default;
    const leadsAction = (await import("./actions/set-workspace-team-leads.js"))
      .default;
    const listGroupsAction = (
      await import("./actions/list-workspace-user-groups.js")
    ).default;
    await pglite.exec(`CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', joined_at BIGINT NOT NULL DEFAULT 0,
      federation_removal_pending_at INTEGER
    )`);
    for (const [id, orgId, role] of [
      ["owner", "org-policy", "owner"],
      ["admin", "org-policy", "admin"],
      ["lead", "org-policy", "member"],
      ["member", "org-policy", "member"],
      ["other", "org-policy", "member"],
      ["extra", "org-policy", "member"],
      ["outsider", "org-other", "owner"],
    ]) {
      await pglite
        .prepare(
          "INSERT INTO org_members (id, org_id, email, role) VALUES (?, ?, ?, ?)",
        )
        .run(id, orgId, `${id}@example.com`, role);
    }
    const as = <T>(
      actor: string,
      operation: () => Promise<T>,
      orgId = "org-policy",
    ) =>
      runWithRequestContext(
        { userEmail: `${actor}@example.com`, orgId },
        operation,
      );
    await expect(
      as("outsider", () =>
        listGroupsAction.run(
          {},
          { userEmail: "outsider@example.com", orgId: "org-policy" },
        ),
      ),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "action_failed",
      statusCode: 403,
      message: "Workspace membership is required.",
    });
    const team = await as("owner", () =>
      upsertWorkspaceUserGroup({
        name: "Policy team",
        isTeam: true,
        memberEmails: ["lead@example.com", "member@example.com"],
        leadEmails: ["lead@example.com"],
      }),
    );
    const ordinaryGroup = await as("owner", () =>
      upsertWorkspaceUserGroup({
        name: "Access list",
        memberEmails: ["lead@example.com"],
      }),
    );
    const listedForLead = await as("lead", () =>
      listGroupsAction.run(
        {},
        { userEmail: "lead@example.com", orgId: "org-policy" },
      ),
    );
    expect(listedForLead.find((group) => group.id === team.id)).toMatchObject({
      memberEmails: ["lead@example.com", "member@example.com"],
      leadEmails: ["lead@example.com"],
    });
    expect(
      listedForLead.find((group) => group.id === ordinaryGroup.id),
    ).toMatchObject({
      memberEmails: [],
      leadEmails: [],
    });
    const listedForOther = await as("other", () =>
      listGroupsAction.run(
        {},
        { userEmail: "other@example.com", orgId: "org-policy" },
      ),
    );
    expect(listedForOther.find((group) => group.id === team.id)).toMatchObject({
      memberEmails: [],
      leadEmails: [],
    });
    expect(
      await getWorkspaceTeamForMember(
        "org-policy",
        team.id,
        "admin@example.com",
      ),
    ).toBeNull();
    expect(
      await getWorkspaceTeamForMember("org-policy", "", "lead@example.com"),
    ).toBeNull();
    expect(
      await getWorkspaceTeamForMember(
        "org-policy",
        team.id,
        "lead@example.com",
      ),
    ).toMatchObject({ id: team.id });
    await expect(
      as("member", () =>
        updateWorkspaceUserGroupMembers({
          id: team.id,
          operation: "add",
          memberEmails: ["other@example.com"],
        }),
      ),
    ).rejects.toThrow(/admins or team leads/);
    await expect(
      as("lead", () =>
        upsertWorkspaceUserGroup({
          id: team.id,
          name: "Hijack",
          memberEmails: [],
        }),
      ),
    ).rejects.toThrow(/admins/);
    await expect(
      as("lead", () =>
        upsertAction.run(
          { id: team.id, name: "Hijack", memberEmails: [], isTeam: false },
          { userEmail: "lead@example.com", orgId: "org-policy" },
        ),
      ),
    ).rejects.toThrow(/admins/);
    await expect(
      as("lead", () =>
        updateWorkspaceUserGroupMembers({
          id: team.id,
          operation: "remove",
          memberEmails: ["lead@example.com"],
        }),
      ),
    ).rejects.toThrow(/cannot remove team leads/);
    const { mountActionRoutes } = await import("../server/action-routes.js");
    const mounted: Array<{
      path: string;
      handler: (event: unknown) => Promise<unknown>;
    }> = [];
    mountActionRoutes(
      {
        use: (path: string, handler: (event: unknown) => Promise<unknown>) =>
          mounted.push({ path, handler }),
      },
      { "bulk-update-workspace-user-groups": bulk },
      { getOwnerFromEvent: async () => "lead@example.com" },
    );
    const event = {
      _method: "POST",
      _headers: {},
      context: {},
      req: {
        url: "http://localhost/_agent-native/actions/bulk-update-workspace-user-groups",
        json: async () => ({
          groupId: team.id,
          operation: "remove",
          memberEmails: ["lead@example.com"],
        }),
      },
    };
    const denial = await mounted
      .find((route) =>
        route.path.endsWith("bulk-update-workspace-user-groups"),
      )!
      .handler(event);
    expect(event).toMatchObject({ _status: 403 });
    expect(denial).toMatchObject({
      error: "Team leads cannot remove team leads.",
      errorCode: "action_failed",
    });
    expect(
      await getWorkspaceTeamForMember(
        "org-policy",
        team.id,
        "lead@example.com",
      ),
    ).toMatchObject({
      memberEmails: ["lead@example.com", "member@example.com"],
      leadEmails: ["lead@example.com"],
    });
    await expect(
      as("lead", () =>
        updateWorkspaceUserGroupMembers({
          id: team.id,
          operation: "add",
          memberEmails: ["outsider@example.com"],
        }),
      ),
    ).rejects.toThrow(/belong to this workspace/);
    await expect(
      as("lead", () =>
        setWorkspaceTeamLeads({ teamGroupId: team.id, leadEmails: [] }),
      ),
    ).rejects.toThrow(/admins/);
    await expect(
      as("owner", () =>
        setWorkspaceTeamLeads({
          teamGroupId: team.id,
          leadEmails: ["other@example.com"],
        }),
      ),
    ).rejects.toThrow(/must be group members/);
    await expect(
      as("outsider", () =>
        updateWorkspaceUserGroupMembers({
          id: team.id,
          operation: "add",
          memberEmails: ["other@example.com"],
        }),
      ),
    ).rejects.toThrow(/current workspace members/);
    await pglite
      .prepare(
        "UPDATE org_members SET federation_removal_pending_at = 1 WHERE id = ?",
      )
      .run("lead");
    await expect(
      as("lead", () =>
        updateWorkspaceUserGroupMembers({
          id: team.id,
          operation: "add",
          memberEmails: ["other@example.com"],
        }),
      ),
    ).rejects.toThrow(/current workspace members/);
    await pglite
      .prepare(
        "UPDATE org_members SET federation_removal_pending_at = NULL WHERE id = ?",
      )
      .run("lead");
    const added = await as("lead", () =>
      bulk.run(
        {
          groupId: team.id,
          operation: "add",
          memberEmails: ["other@example.com"],
        },
        { userEmail: "lead@example.com", orgId: "org-policy" },
      ),
    );
    expect(added.memberEmails).toContain("other@example.com");
    await as("admin", () =>
      leadsAction.run(
        {
          teamGroupId: team.id,
          leadEmails: ["lead@example.com", "other@example.com"],
        },
        { userEmail: "admin@example.com", orgId: "org-policy" },
      ),
    );
    const removed = await as("admin", () =>
      updateWorkspaceUserGroupMembers({
        id: team.id,
        operation: "remove",
        memberEmails: ["other@example.com"],
      }),
    );
    expect(removed).toMatchObject({
      leadEmails: ["lead@example.com"],
      memberEmails: ["lead@example.com", "member@example.com"],
    });
    const audits = (await pglite
      .prepare(
        "SELECT input FROM agent_audit_log WHERE target_id = ? ORDER BY created_at",
      )
      .all(team.id)) as Array<{ input: string }>;
    expect(audits).toHaveLength(4);
    expect(audits.map((row) => JSON.parse(row.input))).toContainEqual(
      expect.objectContaining({
        removedMembers: ["other@example.com"],
        removedLeads: ["other@example.com"],
      }),
    );
    const concurrent = await Promise.all([
      as("lead", () =>
        updateWorkspaceUserGroupMembers({
          id: team.id,
          operation: "add",
          memberEmails: ["other@example.com"],
        }),
      ),
      as("lead", () =>
        updateWorkspaceUserGroupMembers({
          id: team.id,
          operation: "add",
          memberEmails: ["extra@example.com"],
        }),
      ),
    ]);
    expect(concurrent).toHaveLength(2);
    const afterConcurrent = await getWorkspaceTeamForMember(
      "org-policy",
      team.id,
      "lead@example.com",
    );
    expect(afterConcurrent?.memberEmails).toEqual(
      expect.arrayContaining(["other@example.com", "extra@example.com"]),
    );
    expect(afterConcurrent?.leadEmails).toEqual(["lead@example.com"]);
    const leadRemoved = await as("lead", () =>
      bulk.run(
        {
          groupId: team.id,
          operation: "remove",
          memberEmails: ["other@example.com"],
        },
        { userEmail: "lead@example.com", orgId: "org-policy" },
      ),
    );
    expect(leadRemoved.memberEmails).not.toContain("other@example.com");
  });

  it("rechecks locked org authority and recipients after prevalidation and rolls back an audit failure", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      upsertWorkspaceUserGroup,
      updateWorkspaceUserGroupMembers,
      deleteWorkspaceUserGroup,
    } = await import("./groups.js");
    await pglite.exec(`CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', joined_at BIGINT NOT NULL DEFAULT 0,
      federation_removal_pending_at INTEGER
    )`);
    for (const [id, role] of [
      ["owner", "owner"],
      ["recipient", "member"],
    ]) {
      await pglite
        .prepare(
          "INSERT INTO org_members (id, org_id, email, role) VALUES (?, ?, ?, ?)",
        )
        .run(`race-${id}`, "org-locks", `${id}@example.com`, role);
    }
    const asOwner = <T>(run: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "owner@example.com", orgId: "org-locks" },
        run,
      );
    const group = await asOwner(() =>
      upsertWorkspaceUserGroup({
        name: "Locked team",
        isTeam: true,
        memberEmails: ["owner@example.com"],
        leadEmails: ["owner@example.com"],
      }),
    );
    const original = sharedClient.transaction!.bind(sharedClient);
    const auditRows = async () =>
      (
        await pglite
          .prepare("SELECT id FROM agent_audit_log WHERE target_id = ?")
          .all(group.id)
      ).length;
    const beforeAudits = await auditRows();

    for (const email of ["owner@example.com", "recipient@example.com"]) {
      const statements: Array<{ sql: string; args: unknown[] }> = [];
      const spy = vi
        .spyOn(sharedClient, "transaction")
        .mockImplementation((fn) =>
          original(async (tx) => {
            await tx.execute({
              sql: "UPDATE org_members SET federation_removal_pending_at = 1 WHERE org_id = ? AND LOWER(email) = ?",
              args: ["org-locks", email],
            });
            return fn({
              execute: (arg) => {
                const sql = typeof arg === "string" ? arg : arg.sql;
                statements.push({
                  sql,
                  args: typeof arg === "string" ? [] : (arg.args ?? []),
                });
                return tx.execute(arg);
              },
            });
          }),
        );
      try {
        await expect(
          asOwner(() =>
            updateWorkspaceUserGroupMembers({
              id: group.id,
              operation: "add",
              memberEmails: ["recipient@example.com"],
            }),
          ),
        ).rejects.toThrow(
          email === "owner@example.com"
            ? /current workspace members/
            : /belong to this workspace/,
        );
      } finally {
        spy.mockRestore();
      }
      expect(statements[0]?.sql).toMatch(
        /FROM org_members[\s\S]*ORDER BY LOWER\(email\), id FOR UPDATE/,
      );
      expect(statements[0]?.args).toEqual([
        "org-locks",
        "owner@example.com",
        "recipient@example.com",
      ]);
      if (email === "recipient@example.com") {
        expect(statements[1]?.sql).toMatch(
          /workspace_user_groups[\s\S]*FOR UPDATE/,
        );
      }
      expect(await auditRows()).toBe(beforeAudits);
      await pglite
        .prepare(
          "UPDATE org_members SET federation_removal_pending_at = NULL WHERE org_id = ? AND LOWER(email) = ?",
        )
        .run("org-locks", email);
    }

    const deleteSpy = vi
      .spyOn(sharedClient, "transaction")
      .mockImplementation((fn) =>
        original(async (tx) => {
          await tx.execute({
            sql: "UPDATE org_members SET role = 'member' WHERE org_id = ? AND LOWER(email) = ?",
            args: ["org-locks", "owner@example.com"],
          });
          return fn(tx);
        }),
      );
    try {
      await expect(
        asOwner(() => deleteWorkspaceUserGroup(group.id)),
      ).rejects.toThrow(/admins/);
    } finally {
      deleteSpy.mockRestore();
    }
    expect(
      await pglite
        .prepare("SELECT id FROM workspace_user_groups WHERE id = ?")
        .get(group.id),
    ).toMatchObject({ id: group.id });

    const spy = vi.spyOn(sharedClient, "transaction").mockImplementation((fn) =>
      original((tx) =>
        fn({
          execute: (arg) => {
            const sql = typeof arg === "string" ? arg : arg.sql;
            if (/INSERT INTO agent_audit_log/.test(sql))
              throw new Error("Audit insert failed");
            return tx.execute(arg);
          },
        }),
      ),
    );
    try {
      await expect(
        asOwner(() =>
          updateWorkspaceUserGroupMembers({
            id: group.id,
            operation: "add",
            memberEmails: ["recipient@example.com"],
          }),
        ),
      ).rejects.toThrow(/Audit insert failed/);
    } finally {
      spy.mockRestore();
    }
    expect(await auditRows()).toBe(beforeAudits);
    expect(
      await pglite
        .prepare(
          "SELECT member_emails_json, lead_emails_json FROM workspace_user_groups WHERE id = ?",
        )
        .get(group.id),
    ).toMatchObject({
      member_emails_json: '["owner@example.com"]',
      lead_emails_json: '["owner@example.com"]',
    });
  });

  it("normalizes names for writers that do not know the derived column", async () => {
    const { ensureWorkspaceUserGroupsTable } = await import("./groups.js");
    const id = "legacy-writer-group";
    const orgId = "org-groups-legacy-writer";

    await ensureWorkspaceUserGroupsTable();
    await pglite
      .prepare(
        `INSERT INTO workspace_user_groups
          (id, org_id, name, member_emails_json, created_by_email, created_at, updated_at)
         VALUES (?, ?, ?, '[]', '', 0, 0)`,
      )
      .run(id, orgId, "Finance");

    const inserted = await pglite
      .prepare("SELECT normalized_name FROM workspace_user_groups WHERE id = ?")
      .all(id);
    expect(inserted[0]?.normalized_name).toBe("finance");

    await pglite
      .prepare(
        "UPDATE workspace_user_groups SET name = ?, normalized_name = NULL WHERE id = ?",
      )
      .run("Finance Team", id);
    const updated = await pglite
      .prepare("SELECT normalized_name FROM workspace_user_groups WHERE id = ?")
      .all(id);
    expect(updated[0]?.normalized_name).toBe("finance team");
  });

  it("scopes workspace connection grants to the active org", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      getWorkspaceConnectionGrant,
      listWorkspaceConnectionGrants,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-shared",
          provider: "github",
          label: "Team GitHub",
          allowedApps: ["brain"],
        });
        await upsertWorkspaceConnectionGrant({
          connectionId: "conn-shared",
          appId: "dispatch",
          scopes: ["repo:read"],
        });
      },
    );

    const bobGrants = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnectionGrants({ appId: "dispatch" }),
    );
    expect(bobGrants).toHaveLength(1);
    expect(bobGrants[0]).toMatchObject({
      connectionId: "conn-shared",
      provider: "github",
      appId: "dispatch",
      ownerEmail: "alice@example.com",
      grantedByEmail: "alice@example.com",
      orgId: "org-1",
      scopes: ["repo:read"],
    });

    const bobGrant = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => getWorkspaceConnectionGrant("conn-shared", "dispatch"),
    );
    expect(bobGrant?.id).toBe(bobGrants[0].id);

    const otherOrgGrants = await runWithRequestContext(
      { userEmail: "carol@example.com", orgId: "org-2" },
      () => listWorkspaceConnectionGrants({ appId: "dispatch" }),
    );
    expect(otherOrgGrants).toEqual([]);
  });

  it("marks scoped workspace connection and grant usage metadata", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnectionProviderCatalogForApp,
      listWorkspaceConnectionGrants,
      listWorkspaceConnections,
      markWorkspaceConnectionUsed,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-used",
          provider: "slack",
          label: "Team Slack",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnectionGrant({
          id: "grant-brain",
          connectionId: "conn-used",
          appId: "brain",
          credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
        });
      },
    );

    const usedAt = "2026-05-16T12:34:56.000Z";
    const marked = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        markWorkspaceConnectionUsed({
          connectionId: "conn-used",
          appId: "brain",
          usedAt,
        }),
    );
    expect(marked).toEqual({
      connectionUpdated: true,
      grantUpdated: true,
      lastUsedAt: usedAt,
    });

    const [connections, grants, catalog] = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        Promise.all([
          listWorkspaceConnections({ provider: "slack" }),
          listWorkspaceConnectionGrants({ connectionId: "conn-used" }),
          listWorkspaceConnectionProviderCatalogForApp({
            appId: "brain",
            provider: "slack",
          }),
        ]),
    );

    expect(connections[0]).toMatchObject({
      id: "conn-used",
      lastUsedAt: usedAt,
    });
    expect(grants[0]).toMatchObject({
      id: "grant-brain",
      lastUsedAt: usedAt,
    });
    expect(catalog.providers[0].workspaceConnection).toMatchObject({
      lastUsedAt: usedAt,
      connections: [
        expect.objectContaining({
          id: "conn-used",
          lastUsedAt: usedAt,
          explicitGrant: expect.objectContaining({
            id: "grant-brain",
            lastUsedAt: usedAt,
          }),
        }),
      ],
    });
  });

  it("filters connections by legacy allowed apps and explicit grants", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnections,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-open",
          provider: "slack",
          label: "Open Slack",
        });
        await upsertWorkspaceConnection({
          id: "conn-legacy-dispatch",
          provider: "gmail",
          label: "Legacy Dispatch Gmail",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnection({
          id: "conn-granted-dispatch",
          provider: "github",
          label: "Granted GitHub",
          allowedApps: ["brain"],
        });
        await upsertWorkspaceConnection({
          id: "conn-brain-only",
          provider: "notion",
          label: "Brain Notion",
          allowedApps: ["brain"],
        });
        await upsertWorkspaceConnectionGrant({
          connectionId: "conn-granted-dispatch",
          appId: "dispatch",
        });
      },
    );

    const dispatchConnections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ appId: "dispatch" }),
    );
    expect(
      dispatchConnections.map((connection) => connection.id).sort(),
    ).toEqual(["conn-granted-dispatch", "conn-legacy-dispatch", "conn-open"]);

    const brainConnections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ appId: "brain" }),
    );
    expect(brainConnections.map((connection) => connection.id).sort()).toEqual([
      "conn-brain-only",
      "conn-granted-dispatch",
      "conn-open",
    ]);
  });

  it("lists app-available workspace connections with access metadata", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnectionsForApp,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-open",
          provider: "slack",
          label: "Open Slack",
          config: { token: "xoxb-open-should-not-leak" },
          credentialRefs: [
            {
              key: "SLACK_BOT_TOKEN",
              scope: "org",
              value: "xoxb-ref-should-not-leak",
            },
          ],
        });
        await upsertWorkspaceConnection({
          id: "conn-allowed",
          provider: "slack",
          label: "Brain Slack",
          allowedApps: ["brain"],
        });
        await upsertWorkspaceConnection({
          id: "conn-granted",
          provider: "slack",
          label: "Granted Slack",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnection({
          id: "conn-not-granted",
          provider: "slack",
          label: "Dispatch Slack",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnectionGrant({
          id: "grant-brain",
          connectionId: "conn-granted",
          appId: "brain",
        });
      },
    );

    const connections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        listWorkspaceConnectionsForApp({ appId: "brain", provider: "slack" }),
    );

    expect(connections.map((connection) => connection.id).sort()).toEqual([
      "conn-allowed",
      "conn-granted",
      "conn-open",
    ]);
    expect(
      connections.map((connection) => ({
        id: connection.id,
        appAccess: connection.appAccess,
        explicitGrantId: connection.explicitGrant?.id ?? null,
      })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "conn-open",
          appAccess: expect.objectContaining({
            available: true,
            mode: "all-apps",
          }),
          explicitGrantId: null,
        }),
        expect.objectContaining({
          id: "conn-allowed",
          appAccess: expect.objectContaining({
            available: true,
            mode: "allowed-app",
          }),
          explicitGrantId: null,
        }),
        expect.objectContaining({
          id: "conn-granted",
          appAccess: expect.objectContaining({
            available: true,
            mode: "explicit-grant",
            grantId: "grant-brain",
          }),
          explicitGrantId: "grant-brain",
        }),
      ]),
    );
    expect(JSON.stringify(connections)).not.toContain("xoxb-open");
    expect(JSON.stringify(connections)).not.toContain("xoxb-ref");
  });

  it("resolves requested app workspace connections with unavailable reasons", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { resolveWorkspaceConnectionForApp, upsertWorkspaceConnection } =
      await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-open",
          provider: "github",
          label: "Open GitHub",
        });
        await upsertWorkspaceConnection({
          id: "conn-dispatch",
          provider: "github",
          label: "Dispatch GitHub",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnection({
          id: "conn-disabled",
          provider: "github",
          label: "Disabled GitHub",
          status: "disabled",
        });
        await upsertWorkspaceConnection({
          id: "conn-needs-reauth",
          provider: "github",
          label: "Expired GitHub",
          status: "needs_reauth",
        });
      },
    );

    const resolved = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "github",
          connectionId: "conn-open",
          requireConnected: true,
        }),
    );
    expect(resolved).toMatchObject({
      available: true,
      connection: {
        id: "conn-open",
        appAccess: {
          available: true,
          mode: "all-apps",
        },
      },
    });

    const notGranted = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "github",
          connectionId: "conn-dispatch",
        }),
    );
    expect(notGranted).toMatchObject({
      available: false,
      connection: {
        id: "conn-dispatch",
        appAccess: {
          available: false,
          mode: "unavailable",
        },
      },
    });
    expect(notGranted.reason).toMatch(/grant brain access/i);

    const disabled = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "github",
          connectionId: "conn-disabled",
        }),
    );
    expect(disabled).toMatchObject({
      available: false,
      connection: { id: "conn-disabled", status: "disabled" },
    });
    expect(disabled.reason).toMatch(/disabled/i);

    const needsConnected = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "github",
          connectionId: "conn-needs-reauth",
          requireConnected: true,
          includeDisabled: true,
        }),
    );
    expect(needsConnected).toMatchObject({
      available: false,
      connection: { id: "conn-needs-reauth", status: "needs_reauth" },
    });
    expect(needsConnected.reason).toMatch(/connected workspace connection/i);

    const missing = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionForApp({
          appId: "brain",
          provider: "github",
          connectionId: "conn-missing",
        }),
    );
    expect(missing).toMatchObject({
      available: false,
      connection: null,
      appAccess: null,
    });
    expect(missing.reason).toMatch(/not found/i);
  });

  it("builds a reusable provider catalog for one app", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnectionProviderCatalogForApp,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-slack",
          provider: "slack",
          label: "Team Slack",
          allowedApps: ["dispatch"],
          credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
        });
        await upsertWorkspaceConnectionGrant({
          connectionId: "conn-slack",
          appId: "brain",
        });
      },
    );

    const catalog = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        listWorkspaceConnectionProviderCatalogForApp({
          appId: "brain",
          templateUse: "brain",
          provider: "slack",
        }),
    );

    expect(catalog).toMatchObject({
      appId: "brain",
      counts: {
        providers: 1,
        connections: 1,
        grants: 1,
        readyProviders: 1,
      },
    });
    expect(catalog.providers[0]).toMatchObject({
      id: "slack",
      workspaceConnection: {
        grantState: "connected",
        grantedConnectionCount: 1,
      },
      readiness: {
        status: "ready",
        missingRequiredCredentialKeys: [],
      },
    });
    expect(JSON.stringify(catalog)).not.toContain("xox");
  });

  it("revokes workspace connection grants without changing legacy allowed apps", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      listWorkspaceConnectionGrants,
      listWorkspaceConnections,
      revokeWorkspaceConnectionGrant,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");
    const { registerWorkspaceConnectionLifecycleListener } =
      await import("./lifecycle.js");
    const lifecycle = vi.fn();
    const unregister = registerWorkspaceConnectionLifecycleListener(lifecycle);

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-granted",
          provider: "github",
          label: "Granted GitHub",
          allowedApps: ["brain"],
        });
        await upsertWorkspaceConnection({
          id: "conn-legacy",
          provider: "gmail",
          label: "Legacy Gmail",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnectionGrant({
          connectionId: "conn-granted",
          appId: "dispatch",
        });
      },
    );

    const otherOrgRevoked = await runWithRequestContext(
      { userEmail: "carol@example.com", orgId: "org-2" },
      () => revokeWorkspaceConnectionGrant("conn-granted", "dispatch"),
    );
    expect(otherOrgRevoked).toBe(false);

    const revoked = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => revokeWorkspaceConnectionGrant("conn-granted", "dispatch"),
    );
    expect(revoked).toBe(true);
    expect(lifecycle).toHaveBeenCalledWith({
      type: "grant-revoked",
      connectionId: "conn-granted",
      appId: "dispatch",
      ownerEmail: "bob@example.com",
      orgId: "org-1",
    });

    const grants = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnectionGrants({ appId: "dispatch" }),
    );
    expect(grants).toEqual([]);

    const dispatchConnections = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ appId: "dispatch" }),
    );
    expect(dispatchConnections.map((connection) => connection.id)).toEqual([
      "conn-legacy",
    ]);
    unregister();
  });

  it("redacts secret-shaped fields during serialization", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { serializeWorkspaceConnection, upsertWorkspaceConnection } =
      await import("./store.js");

    const saved = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-safe",
          provider: "openai",
          label: "OpenAI",
          config: {
            region: "us",
            apiKey: "sk-should-not-leak",
            nested: { accessToken: "token-should-not-leak" },
          },
          credentialRefs: [
            {
              key: "OPENAI_API_KEY",
              scope: "user",
              value: "raw-secret-should-not-leak",
            },
          ],
        }),
    );

    expect(JSON.stringify(saved)).not.toContain("sk-should-not-leak");
    expect(JSON.stringify(saved)).not.toContain("token-should-not-leak");
    expect(JSON.stringify(saved)).not.toContain("raw-secret-should-not-leak");
    expect(saved.config).toMatchObject({
      region: "us",
      apiKey: "[redacted]",
      nested: { accessToken: "[redacted]" },
    });
    expect(saved.credentialRefs[0]).toMatchObject({
      key: "OPENAI_API_KEY",
      scope: "user",
      value: "[redacted]",
    });

    const serialized = serializeWorkspaceConnection(saved);
    expect(JSON.stringify(serialized)).not.toContain("sk-should-not-leak");
    expect(JSON.stringify(serialized)).not.toContain("token-should-not-leak");
  });

  it("redacts secret-shaped grant fields during serialization", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      serializeWorkspaceConnectionGrant,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    const grant = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-grant-safe",
          provider: "slack",
          label: "Slack",
        });
        return upsertWorkspaceConnectionGrant({
          connectionId: "conn-grant-safe",
          appId: "dispatch",
          config: {
            channel: "alerts",
            apiKey: "sk-should-not-leak",
            nested: { refreshToken: "refresh-should-not-leak" },
          },
          credentialRefs: [
            {
              key: "SLACK_BOT_TOKEN",
              scope: "org",
              value: "raw-secret-should-not-leak",
            },
          ],
        });
      },
    );

    expect(JSON.stringify(grant)).not.toContain("sk-should-not-leak");
    expect(JSON.stringify(grant)).not.toContain("refresh-should-not-leak");
    expect(JSON.stringify(grant)).not.toContain("raw-secret-should-not-leak");
    expect(grant.config).toMatchObject({
      channel: "alerts",
      apiKey: "[redacted]",
      nested: { refreshToken: "[redacted]" },
    });
    expect(grant.credentialRefs[0]).toMatchObject({
      key: "SLACK_BOT_TOKEN",
      scope: "org",
      value: "[redacted]",
    });

    const serialized = serializeWorkspaceConnectionGrant(grant);
    expect(JSON.stringify(serialized)).not.toContain("sk-should-not-leak");
    expect(JSON.stringify(serialized)).not.toContain("refresh-should-not-leak");
  });

  it("resolves runtime credentials from granted workspace connection refs", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { writeAppSecret } = await import("../secrets/index.js");
    const { resolveWorkspaceConnectionCredentialForApp } =
      await import("./credentials.js");
    const {
      getWorkspaceConnection,
      getWorkspaceConnectionGrant,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-slack",
          provider: "slack",
          label: "Team Slack",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnectionGrant({
          id: "grant-brain",
          connectionId: "conn-slack",
          appId: "brain",
          credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
        });
        await writeAppSecret({
          key: "SLACK_BOT_TOKEN",
          value: "xoxb-runtime-token",
          scope: "org",
          scopeId: "org-1",
        });
      },
    );

    const resolved = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "brain",
          provider: "slack",
          key: "SLACK_BOT_TOKEN",
        }),
    );

    expect(resolved).toMatchObject({
      available: true,
      status: "resolved",
      value: "xoxb-runtime-token",
      provenance: {
        source: "workspace_connection",
        provider: "slack",
        requestedKey: "SLACK_BOT_TOKEN",
        resolvedKey: "SLACK_BOT_TOKEN",
        connectionId: "conn-slack",
        connectionLabel: "Team Slack",
        grantId: "grant-brain",
        appAccessMode: "explicit-grant",
        secretScope: "org",
        backend: "secrets",
        credentialRef: {
          key: "SLACK_BOT_TOKEN",
          source: "grant",
        },
      },
    });

    const [connection, grant] = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        Promise.all([
          getWorkspaceConnection("conn-slack"),
          getWorkspaceConnectionGrant("conn-slack", "brain"),
        ]),
    );
    expect(connection?.lastUsedAt).toEqual(expect.any(String));
    expect(grant?.lastUsedAt).toEqual(expect.any(String));
    expect(Date.parse(connection?.lastUsedAt ?? "")).toBeGreaterThan(0);
    expect(grant?.lastUsedAt).toBe(connection?.lastUsedAt);
  }, 15_000);

  it("does not use a reviewer credential for an org-scoped workspace connection read", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { writeAppSecret } = await import("../secrets/index.js");
    const { resolveWorkspaceConnectionCredentialForApp } =
      await import("./credentials.js");
    const { upsertWorkspaceConnection } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "customer@example.com", orgId: "customer-org" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-customer-bigquery",
          provider: "bigquery",
          label: "Customer BigQuery",
          allowedApps: ["analytics"],
          credentialRefs: [{ key: "BIGQUERY_PROJECT_ID" }],
        }),
    );
    await writeAppSecret({
      key: "BIGQUERY_PROJECT_ID",
      value: "reviewer-project",
      scope: "user",
      scopeId: "admin@example.com",
    });

    const result = await runWithRequestContext(
      {
        userEmail: "admin@example.com",
        orgId: "customer-org",
        credentialScope: "org",
      },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "analytics",
          provider: "bigquery",
          key: "BIGQUERY_PROJECT_ID",
        }),
    );

    expect(result.available).toBe(false);
    expect(result.value).toBeUndefined();
  });

  it("skips last-used recording when recordUsage is false", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { writeAppSecret } = await import("../secrets/index.js");
    const { resolveWorkspaceConnectionCredentialForApp } =
      await import("./credentials.js");
    const {
      getWorkspaceConnection,
      upsertWorkspaceConnection,
      upsertWorkspaceConnectionGrant,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-slack-peek",
          provider: "slack",
          label: "Team Slack",
          allowedApps: ["dispatch"],
        });
        await upsertWorkspaceConnectionGrant({
          id: "grant-brain-peek",
          connectionId: "conn-slack-peek",
          appId: "brain",
          credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
        });
        await writeAppSecret({
          key: "SLACK_BOT_TOKEN",
          value: "xoxb-peek-token",
          scope: "org",
          scopeId: "org-1",
        });
      },
    );

    const resolved = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "brain",
          provider: "slack",
          key: "SLACK_BOT_TOKEN",
          recordUsage: false,
        }),
    );
    expect(resolved).toMatchObject({
      available: true,
      status: "resolved",
      value: "xoxb-peek-token",
    });

    const connection = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => getWorkspaceConnection("conn-slack-peek"),
    );
    expect(connection?.lastUsedAt).toBeNull();
  }, 15_000);

  it("reports missing workspace connections and missing grants without reading env credentials", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { resolveWorkspaceConnectionCredentialForApp } =
      await import("./credentials.js");
    const { upsertWorkspaceConnection } = await import("./store.js");

    process.env.SLACK_BOT_TOKEN = "env-token-must-not-be-used";

    const missingConnection = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "brain",
          provider: "slack",
          key: "SLACK_BOT_TOKEN",
        }),
    );
    expect(missingConnection).toMatchObject({
      available: false,
      status: "not_available",
    });
    expect(missingConnection.value).toBeUndefined();

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-dispatch",
          provider: "slack",
          label: "Dispatch Slack",
          allowedApps: ["dispatch"],
          credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
        }),
    );

    const missingGrant = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "brain",
          provider: "slack",
          key: "SLACK_BOT_TOKEN",
          connectionId: "conn-dispatch",
        }),
    );
    expect(missingGrant).toMatchObject({
      available: false,
      status: "not_available",
      checked: [
        expect.objectContaining({
          status: "not_available",
          connectionId: "conn-dispatch",
          appAccessMode: "unavailable",
        }),
      ],
    });
    expect(missingGrant.reason).toMatch(/grant brain access/i);
    expect(missingGrant.value).toBeUndefined();
  });

  it("resolves provider credential key aliases for workspace connection refs", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { writeAppSecret } = await import("../secrets/index.js");
    const { resolveWorkspaceConnectionCredentialForApp } =
      await import("./credentials.js");
    const { upsertWorkspaceConnection } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-hubspot",
          provider: "hubspot",
          label: "Team HubSpot",
          credentialRefs: [{ key: "HUBSPOT_PRIVATE_APP_TOKEN", scope: "org" }],
        });
        await writeAppSecret({
          key: "HUBSPOT_ACCESS_TOKEN",
          value: "pat-alias-token",
          scope: "org",
          scopeId: "org-1",
        });
      },
    );

    const resolved = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "analytics",
          provider: "hubspot",
          key: "HUBSPOT_ACCESS_TOKEN",
        }),
    );

    expect(resolved).toMatchObject({
      available: true,
      status: "resolved",
      value: "pat-alias-token",
      provenance: {
        requestedKey: "HUBSPOT_ACCESS_TOKEN",
        resolvedKey: "HUBSPOT_ACCESS_TOKEN",
        credentialRef: {
          key: "HUBSPOT_PRIVATE_APP_TOKEN",
          source: "connection",
        },
      },
    });
  });

  it("resolves an explicitly registered legacy HubSpot secret ref", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { writeAppSecret } = await import("../secrets/index.js");
    const { resolveWorkspaceConnectionCredentialForApp } =
      await import("./credentials.js");
    const { upsertWorkspaceConnection } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-hubspot-secret-ref",
          provider: "hubspot",
          label: "Team HubSpot (legacy ref)",
          credentialRefs: [{ key: "HUBSPOT_SECRET_KEY", scope: "org" }],
        });
        await writeAppSecret({
          key: "HUBSPOT_SECRET_KEY",
          value: "legacy-ref-token",
          scope: "org",
          scopeId: "org-1",
        });
      },
    );

    const resolved = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "analytics",
          provider: "hubspot",
          key: "HUBSPOT_PRIVATE_APP_TOKEN",
        }),
    );

    expect(resolved).toMatchObject({
      available: true,
      status: "resolved",
      value: "legacy-ref-token",
      provenance: {
        requestedKey: "HUBSPOT_PRIVATE_APP_TOKEN",
        resolvedKey: "HUBSPOT_SECRET_KEY",
        credentialRef: {
          key: "HUBSPOT_SECRET_KEY",
          source: "connection",
        },
      },
    });
  });

  it("falls back to legacy scoped credentials and reports multi-key misses", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { saveCredential } = await import("../credentials/index.js");
    const { resolveWorkspaceConnectionCredentialsForApp } =
      await import("./credentials.js");
    const { upsertWorkspaceConnection } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      async () => {
        await upsertWorkspaceConnection({
          id: "conn-github",
          provider: "github",
          label: "Team GitHub",
          credentialRefs: [
            { key: "GITHUB_TOKEN", scope: "org" },
            { key: "GITHUB_WEBHOOK_SECRET", scope: "org" },
          ],
        });
        await saveCredential("GITHUB_TOKEN", "legacy-github-token", {
          userEmail: "alice@example.com",
          orgId: "org-1",
          scope: "org",
        });
      },
    );

    const resolved = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        resolveWorkspaceConnectionCredentialsForApp({
          appId: "brain",
          provider: "github",
          keys: ["GITHUB_TOKEN", "GITHUB_WEBHOOK_SECRET"],
        }),
    );

    expect(resolved).toMatchObject({
      available: false,
      values: { GITHUB_TOKEN: "legacy-github-token" },
      missingKeys: ["GITHUB_WEBHOOK_SECRET"],
      results: {
        GITHUB_TOKEN: {
          status: "resolved",
          provenance: {
            backend: "credentials",
            secretScope: "org",
          },
        },
        GITHUB_WEBHOOK_SECRET: {
          status: "missing_secret",
        },
      },
    });
  });
});
