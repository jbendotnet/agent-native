import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it, vi } from "vitest";

let lifecycleDb: Awaited<ReturnType<typeof createTestPglite>>["db"] | undefined;

vi.mock("../db/create-get-db.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../db/create-get-db.js")>();
  return {
    ...original,
    createGetDb: <T extends Record<string, unknown>>(schema: T) => {
      const getOriginal = original.createGetDb(schema);
      return () =>
        lifecycleDb ? drizzle({ client: lifecycleDb, schema }) : getOriginal();
    },
  };
});

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    createDbExec: vi.fn(),
    getDbExec: vi.fn(),
    getMigrationDatabaseUrl: vi.fn(() => ""),
  };
});

import { createTestPglite } from "../a2a/test-pglite.js";
import { AGENT_AUDIT_LOG_CREATE_SQL } from "../audit/store.js";
import { CHAT_THREAD_SCHEMA_MIGRATIONS } from "../chat-threads/schema-migrations.js";
import {
  createThread,
  getThreadByShareToken,
  registerChatThreadsShareable,
  resolveThreadAccess,
} from "../chat-threads/store.js";
import {
  createDbExec,
  getDbExec,
  getMigrationDatabaseUrl,
  type DbExec,
} from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import {
  listResources,
  readResource,
  writeResource,
} from "../resources/script-helpers.js";
import { authorizedTeamResourceOwner } from "../resources/team-access.js";
import { runWithRequestContext } from "../server/request-context.js";
import deleteGroup from "./actions/delete-workspace-user-group.js";
import upsertGroup from "./actions/upsert-workspace-user-group.js";
import { upsertWorkspaceUserGroup } from "./groups.js";
import {
  WORKSPACE_CONNECTIONS_MIGRATIONS,
  WORKSPACE_CONNECTIONS_MIGRATIONS_TABLE,
} from "./migrations.js";
import { resolveWorkspaceConnectionForApp } from "./store.js";

function read(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    "utf8",
  );
}

function migrationSql(): string {
  return WORKSPACE_CONNECTIONS_MIGRATIONS.map((entry) =>
    typeof entry.sql === "string" ? entry.sql : (entry.sql.postgres ?? ""),
  ).join("\n");
}

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function pgliteExec(
  pglite: Awaited<ReturnType<typeof createTestPglite>>,
): DbExec {
  return {
    async execute(statement) {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : (statement.args ?? []);
      const result = await pglite.query(postgresSql(sql), args);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    async close() {},
    transaction: (fn) =>
      pglite.db.transaction((tx) =>
        fn({
          execute: async (statement) => {
            const sql =
              typeof statement === "string" ? statement : statement.sql;
            const args =
              typeof statement === "string" ? [] : (statement.args ?? []);
            const result = await tx.query(postgresSql(sql), args);
            return {
              rows: result.rows,
              rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
            };
          },
        }),
      ),
  };
}

describe("WORKSPACE_CONNECTIONS_MIGRATIONS", () => {
  it("creates every table the runtime ensure path only creates outside production", () => {
    const ensured = [
      ...read("./store.ts").matchAll(/ensureTableExists\(\s*"([a-z_]+)"/g),
      ...read("./groups.ts").matchAll(/ensureTableExists\(\s*"([a-z_]+)"/g),
    ].map((match) => match[1]);

    expect(ensured.length).toBeGreaterThan(0);
    const sql = migrationSql();
    for (const table of ensured) {
      expect(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(sql),
        `${table} is ensured at runtime but has no release migration`,
      ).toBe(true);
    }
  });

  it("is wired into the framework release step", () => {
    const release = read("../server/release-migrations.ts");
    expect(release).toMatch(
      /runMigrations\(WORKSPACE_CONNECTIONS_MIGRATIONS,\s*\{\s*table:\s*WORKSPACE_CONNECTIONS_MIGRATIONS_TABLE/,
    );
    expect(WORKSPACE_CONNECTIONS_MIGRATIONS_TABLE).toBe(
      "_workspace_connections_migrations",
    );
  });

  it("stores epoch-millisecond columns as BIGINT on Postgres", () => {
    for (const entry of WORKSPACE_CONNECTIONS_MIGRATIONS) {
      if (typeof entry.sql === "string") continue;
      const pg = entry.sql.postgres ?? "";
      if (!pg.includes("CREATE TABLE")) continue;
      expect(pg).not.toMatch(/(created_at|updated_at|last_used_at)\s+INTEGER/);
    }
  });

  it("backfills normalized group names and enforces new writes uniquely", () => {
    const sql = migrationSql();
    const v11 = WORKSPACE_CONNECTIONS_MIGRATIONS.find(
      (entry) => entry.version === 11,
    );
    const v11Sql =
      typeof v11?.sql === "string" ? v11.sql : (v11?.sql.postgres ?? "");
    expect(sql).toMatch(
      /ALTER TABLE workspace_user_groups\s+ADD COLUMN IF NOT EXISTS normalized_name TEXT/i,
    );
    expect(sql).toMatch(
      /SET normalized_name = LOWER\(BTRIM\(group_row\.name\)\)/i,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_user_groups_org_normalized_name[\s\S]*WHERE normalized_name IS NOT NULL/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.workspace_user_groups_set_normalized_name/i,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_workspace_user_groups_normalized_name[\s\S]*BEFORE INSERT OR UPDATE OF name ON public\.workspace_user_groups/i,
    );
    expect(v11Sql.indexOf("CREATE OR REPLACE FUNCTION")).toBeLessThan(
      v11Sql.indexOf("CREATE UNIQUE INDEX"),
    );
    expect(v11Sql.indexOf("CREATE UNIQUE INDEX")).toBeLessThan(
      v11Sql.indexOf("UPDATE workspace_user_groups"),
    );
    for (const version of [11, 12, 13]) {
      const migration = WORKSPACE_CONNECTIONS_MIGRATIONS.find(
        (entry) => entry.version === version,
      );
      const migrationSql =
        typeof migration?.sql === "string"
          ? migration.sql
          : (migration?.sql.postgres ?? "");
      expect(migrationSql).toMatch(/EXCEPTION WHEN duplicate_object/i);
    }
    expect(read("./groups.ts")).not.toMatch(
      /backfillWorkspaceUserGroupNameKeys|SET normalized_name = LOWER\(BTRIM\(/i,
    );
  });

  it("installs the normalized-name trigger before older writers can bypass it", async () => {
    const pglite = await createTestPglite();
    try {
      for (const migration of WORKSPACE_CONNECTIONS_MIGRATIONS) {
        if (migration.version > 10) break;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }
      await pglite
        .prepare(
          "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
        )
        .run("legacy-group", "org-trigger", "Finance");

      for (const migration of WORKSPACE_CONNECTIONS_MIGRATIONS) {
        if (migration.version !== 11) continue;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }

      await expect(
        pglite
          .prepare(
            "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
          )
          .run("legacy-writer", "org-trigger", "finance"),
      ).rejects.toThrow(/duplicate|unique/i);

      for (const migration of WORKSPACE_CONNECTIONS_MIGRATIONS) {
        if (migration.version !== 12) continue;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }

      const v13 = WORKSPACE_CONNECTIONS_MIGRATIONS.find(
        (entry) => entry.version === 13,
      );
      const v13Sql =
        typeof v13?.sql === "string" ? v13.sql : (v13?.sql.postgres ?? "");
      await pglite.exec(v13Sql);

      const row = await pglite
        .prepare(
          "SELECT normalized_name FROM workspace_user_groups WHERE id = ?",
        )
        .get("legacy-group");
      expect(row?.normalized_name).toBe("finance");
    } finally {
      await pglite.close();
    }
  }, 30_000);

  it("repairs normalized keys left by pre-trigger release migrations", async () => {
    const pglite = await createTestPglite();
    const exec = pgliteExec(pglite);
    try {
      for (const migration of WORKSPACE_CONNECTIONS_MIGRATIONS) {
        if (migration.version > 10) break;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }
      await pglite
        .prepare(
          "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
        )
        .run("legacy-group", "org-repair", "Finance");
      await pglite.exec(`
        UPDATE workspace_user_groups
        SET normalized_name = LOWER(BTRIM(name))
        WHERE id = 'legacy-group';
        CREATE UNIQUE INDEX idx_workspace_user_groups_org_normalized_name
          ON workspace_user_groups (org_id, normalized_name)
          WHERE normalized_name IS NOT NULL;
      `);
      await pglite
        .prepare(
          "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
        )
        .run("legacy-gap-group", "org-repair", "Finance Team");

      await pglite.exec(
        `CREATE OR REPLACE FUNCTION public.workspace_user_groups_set_normalized_name()
          RETURNS trigger
          LANGUAGE plpgsql
          AS 'BEGIN
            NEW.normalized_name := LOWER(BTRIM(NEW.name));
            RETURN NEW;
          END;';
          CREATE TRIGGER trg_workspace_user_groups_normalized_name
            BEFORE INSERT OR UPDATE OF name ON public.workspace_user_groups
            FOR EACH ROW
            EXECUTE FUNCTION public.workspace_user_groups_set_normalized_name();`,
      );
      await pglite.exec(
        `CREATE TABLE workspace_group_runner_migrations (version BIGINT PRIMARY KEY);
         INSERT INTO workspace_group_runner_migrations (version) VALUES (13);`,
      );
      vi.mocked(getDbExec).mockReturnValue(exec);
      vi.mocked(createDbExec).mockResolvedValue(exec);
      vi.mocked(getMigrationDatabaseUrl).mockReturnValue("");

      await runMigrations(WORKSPACE_CONNECTIONS_MIGRATIONS, {
        table: "workspace_group_runner_migrations",
      })(null);

      const repaired = await pglite
        .prepare(
          "SELECT normalized_name FROM workspace_user_groups WHERE id = ?",
        )
        .get("legacy-gap-group");
      expect(repaired?.normalized_name).toBe("finance team");
      await expect(
        pglite
          .prepare(
            "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
          )
          .run("legacy-gap-duplicate", "org-repair", "finance team"),
      ).rejects.toThrow(/duplicate|unique/i);
      const version = await pglite
        .prepare(
          "SELECT MAX(version) AS version FROM workspace_group_runner_migrations",
        )
        .get();
      expect(version?.version).toBe(15);
    } finally {
      vi.clearAllMocks();
      await pglite.close();
    }
  }, 30_000);

  it("adds team defaults to legacy rows once and keeps them on rerun", async () => {
    const pglite = await createTestPglite();
    const exec = pgliteExec(pglite);
    try {
      for (const migration of WORKSPACE_CONNECTIONS_MIGRATIONS) {
        if (migration.version > 14) break;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }
      await pglite
        .prepare(
          "INSERT INTO workspace_user_groups (id, org_id, name) VALUES (?, ?, ?)",
        )
        .run("legacy-team-default", "org-old", "Legacy");
      await pglite.exec(`CREATE TABLE workspace_team_migrations (version BIGINT PRIMARY KEY);
        INSERT INTO workspace_team_migrations (version) VALUES (14);`);
      vi.mocked(getDbExec).mockReturnValue(exec);
      vi.mocked(createDbExec).mockResolvedValue(exec);
      vi.mocked(getMigrationDatabaseUrl).mockReturnValue("");
      const migrate = runMigrations(WORKSPACE_CONNECTIONS_MIGRATIONS, {
        table: "workspace_team_migrations",
      });
      await migrate(null);
      await migrate(null);
      const row = await pglite
        .prepare(
          "SELECT is_team, lead_emails_json FROM workspace_user_groups WHERE id = ?",
        )
        .get("legacy-team-default");
      expect(row).toMatchObject({ is_team: false, lead_emails_json: "[]" });
      const named = await pglite
        .prepare("SELECT name FROM workspace_team_migrations_named")
        .all();
      expect(named).toEqual([{ name: "workspace-user-groups-team-fields" }]);
    } finally {
      vi.clearAllMocks();
      await pglite.close();
    }
  }, 30_000);

  it("retains migrated legacy grants through conversion and bound context through real team deletion", async () => {
    const pglite = await createTestPglite();
    const exec = pgliteExec(pglite);
    const orgId = "org-old";
    const owner = "owner@example.com";
    const viewer = "viewer@example.com";
    const token = "legacy-public-token";
    const as = <T>(email: string, fn: () => Promise<T>) =>
      runWithRequestContext({ userEmail: email, orgId }, fn);
    try {
      for (const migration of WORKSPACE_CONNECTIONS_MIGRATIONS) {
        if (migration.version > 14) break;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }
      for (const migration of CHAT_THREAD_SCHEMA_MIGRATIONS) {
        if (migration.version > 4) break;
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        if (sql) await pglite.exec(sql);
      }
      await pglite.exec(`CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT, email TEXT, role TEXT,
        joined_at BIGINT, federation_removal_pending_at BIGINT
      )`);
      await pglite.query(
        "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ('owner-member', ?, ?, 'owner', 1), ('viewer-member', ?, ?, 'member', 1)",
        [orgId, owner, orgId, viewer],
      );
      await pglite.exec(`
        INSERT INTO workspace_user_groups (id, org_id, name, member_emails_json)
          VALUES ('old-group', 'org-old', 'Legacy', '["owner@example.com","viewer@example.com"]');
        INSERT INTO workspace_connections (id, provider, org_id, allowed_user_groups_json)
          VALUES ('old-connection', 'github', 'org-old', '["old-group"]');
        INSERT INTO workspace_connection_grants (id, connection_id, provider, app_id, org_id)
          VALUES ('old-grant', 'old-connection', 'github', 'dispatch', 'org-old');
        INSERT INTO chat_threads (id, owner_email, title, thread_data, created_at, updated_at, org_id, share_token_hash)
          VALUES ('old-thread', 'owner@example.com', 'Legacy transcript', '{"messages":[{"text":"retained"}],"_share":{"tokenHash":"${createHash("sha256").update(token).digest("hex")}"}}', 1, 1, 'org-old', '${createHash("sha256").update(token).digest("hex")}');
        INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by)
          VALUES ('old-share', 'old-thread', 'group', 'old-group', 'viewer', 'owner@example.com');
      `);
      const before = await Promise.all([
        pglite.query(
          "SELECT id, org_id, name, member_emails_json FROM workspace_user_groups",
        ),
        pglite.query(
          "SELECT id, allowed_user_groups_json FROM workspace_connections",
        ),
        pglite.query(
          "SELECT id, connection_id, app_id FROM workspace_connection_grants",
        ),
        pglite.query(
          "SELECT id, title, thread_data, share_token_hash FROM chat_threads",
        ),
        pglite.query(
          "SELECT id, resource_id, principal_id, role FROM chat_thread_shares",
        ),
      ]);

      const teamMigration = WORKSPACE_CONNECTIONS_MIGRATIONS.find(
        (migration) => migration.version === 15,
      );
      const bindingMigration = CHAT_THREAD_SCHEMA_MIGRATIONS.find(
        (migration) => migration.version === 5,
      );
      if (!teamMigration || !bindingMigration)
        throw new Error("Missing team migrations");
      await pglite.exec(
        typeof teamMigration.sql === "string"
          ? teamMigration.sql
          : (teamMigration.sql.postgres ?? ""),
      );
      await pglite.exec(
        typeof bindingMigration.sql === "string"
          ? bindingMigration.sql
          : (bindingMigration.sql.postgres ?? ""),
      );
      const after = await Promise.all([
        pglite.query(
          "SELECT id, org_id, name, member_emails_json FROM workspace_user_groups",
        ),
        pglite.query(
          "SELECT id, allowed_user_groups_json FROM workspace_connections",
        ),
        pglite.query(
          "SELECT id, connection_id, app_id FROM workspace_connection_grants",
        ),
        pglite.query(
          "SELECT id, title, thread_data, share_token_hash FROM chat_threads",
        ),
        pglite.query(
          "SELECT id, resource_id, principal_id, role FROM chat_thread_shares",
        ),
      ]);
      expect(after.map((result) => result.rows)).toEqual(
        before.map((result) => result.rows),
      );
      expect(
        (
          await pglite.query(
            "SELECT is_team, lead_emails_json FROM workspace_user_groups",
          )
        ).rows,
      ).toEqual([{ is_team: false, lead_emails_json: "[]" }]);
      expect(
        (
          await pglite.query(
            "SELECT team_group_id FROM chat_threads WHERE id = 'old-thread'",
          )
        ).rows,
      ).toEqual([{ team_group_id: null }]);
      vi.mocked(getDbExec).mockReturnValue(exec);
      vi.mocked(createDbExec).mockResolvedValue(exec);
      lifecycleDb = pglite.db;
      await pglite.exec(AGENT_AUDIT_LOG_CREATE_SQL);
      registerChatThreadsShareable();
      const connection = () =>
        as(viewer, () =>
          resolveWorkspaceConnectionForApp({
            appId: "dispatch",
            connectionId: "old-connection",
          }),
        );
      const sharedThread = () =>
        as(viewer, () =>
          resolveThreadAccess(viewer, "old-thread", "viewer", { orgId }),
        );
      expect((await connection()).available).toBe(true);
      expect(await sharedThread()).toMatchObject({
        id: "old-thread",
        teamGroupId: null,
      });
      expect((await as(owner, () => getThreadByShareToken(token)))?.id).toBe(
        "old-thread",
      );

      const converted = await as(owner, () =>
        upsertGroup.run(
          {
            id: "old-group",
            name: "Legacy",
            memberEmails: [owner, viewer],
            isTeam: true,
          },
          { userEmail: owner, orgId },
        ),
      );
      expect(converted).toMatchObject({ id: "old-group", isTeam: true });
      expect((await connection()).available).toBe(true);
      expect(await sharedThread()).toMatchObject({
        id: "old-thread",
        teamGroupId: null,
      });
      expect((await as(owner, () => getThreadByShareToken(token)))?.id).toBe(
        "old-thread",
      );
      expect(
        (await pglite.query("SELECT id, principal_id FROM chat_thread_shares"))
          .rows,
      ).toEqual([{ id: "old-share", principal_id: "old-group" }]);
      expect(
        (
          await pglite.query(
            "SELECT id, allowed_user_groups_json FROM workspace_connections",
          )
        ).rows,
      ).toEqual([
        { id: "old-connection", allowed_user_groups_json: '["old-group"]' },
      ]);

      const teamOwner = await as(viewer, () =>
        authorizedTeamResourceOwner("old-group", orgId, viewer),
      );
      const paths = ["AGENTS.md", "skills/review/SKILL.md", "memory/MEMORY.md"];
      for (const path of paths) {
        await as(viewer, () =>
          writeResource(path, `Legacy ${path}`, {
            scope: "team",
            teamGroupId: "old-group",
          }),
        );
        expect(
          await as(owner, () =>
            readResource(path, { scope: "team", teamGroupId: "old-group" }),
          ),
        ).toBe(`Legacy ${path}`);
      }
      const resources = (
        await pglite.query(
          "SELECT id, owner, path, content FROM resources WHERE owner = ? ORDER BY path",
          [teamOwner],
        )
      ).rows;
      await as(owner, () =>
        writeResource("memory/personal.md", "Personal context"),
      );
      const personal = (
        await pglite.query(
          "SELECT id, owner, path, content FROM resources WHERE owner = ?",
          [owner],
        )
      ).rows;
      expect(
        await as(viewer, () =>
          listResources(undefined, { scope: "team", teamGroupId: "old-group" }),
        ),
      ).toHaveLength(paths.length);
      await as(owner, () =>
        createThread(owner, {
          id: "bound-after-conversion",
          orgId,
          teamGroupId: "old-group",
        }),
      );
      const retained = (
        await pglite.query(
          "SELECT id, owner_email, team_group_id, thread_data FROM chat_threads ORDER BY id",
        )
      ).rows;
      expect(retained).toMatchObject([
        { id: "bound-after-conversion", team_group_id: "old-group" },
        { id: "old-thread", team_group_id: null },
      ]);
      expect(
        (
          await as(owner, () =>
            resolveThreadAccess(owner, "bound-after-conversion", "owner", {
              orgId,
            }),
          )
        )?.id,
      ).toBe("bound-after-conversion");
      expect(
        await as(viewer, () =>
          authorizedTeamResourceOwner("old-group", orgId, viewer),
        ),
      ).toBe(teamOwner);

      expect(
        await as(owner, () =>
          deleteGroup.run({ id: "old-group" }, { userEmail: owner, orgId }),
        ),
      ).toEqual({ id: "old-group", deleted: true });
      expect(
        (
          await pglite.query(
            "SELECT id, owner_email, team_group_id, thread_data FROM chat_threads ORDER BY id",
          )
        ).rows,
      ).toEqual(retained);
      expect(
        (
          await pglite.query(
            "SELECT id, owner, path, content FROM resources WHERE owner = ? ORDER BY path",
            [teamOwner],
          )
        ).rows,
      ).toEqual(resources);
      expect(
        (
          await pglite.query(
            "SELECT id, owner, path, content FROM resources WHERE owner = ?",
            [owner],
          )
        ).rows,
      ).toEqual(personal);
      await expect(
        as(viewer, () =>
          authorizedTeamResourceOwner("old-group", orgId, viewer),
        ),
      ).rejects.toThrow();
      await expect(
        as(viewer, () =>
          readResource(paths[0], { scope: "team", teamGroupId: "old-group" }),
        ),
      ).rejects.toThrow();
      await expect(
        as(owner, () =>
          listResources(undefined, { scope: "team", teamGroupId: "old-group" }),
        ),
      ).rejects.toThrow();
      expect(
        await as(owner, () =>
          resolveThreadAccess(owner, "bound-after-conversion", "owner", {
            orgId,
          }),
        ),
      ).toBeNull();
      expect(
        await as(owner, () =>
          resolveThreadAccess(owner, "bound-after-conversion", "editor", {
            orgId,
          }),
        ),
      ).toBeNull();
      expect(
        await as(owner, () =>
          resolveThreadAccess(owner, "old-thread", "owner", { orgId }),
        ),
      ).toMatchObject({ id: "old-thread", teamGroupId: null });
      expect(await sharedThread()).toBeNull();
      expect((await as(owner, () => getThreadByShareToken(token)))?.id).toBe(
        "old-thread",
      );
      expect((await connection()).available).toBe(false);
      expect(
        (await pglite.query("SELECT id, principal_id FROM chat_thread_shares"))
          .rows,
      ).toEqual([{ id: "old-share", principal_id: "old-group" }]);
      await expect(
        as(owner, () =>
          upsertWorkspaceUserGroup({
            id: "old-group",
            name: "Legacy",
            memberEmails: [owner],
            isTeam: true,
          }),
        ),
      ).rejects.toThrow(/not found/);
      const replacement = await as(owner, () =>
        upsertWorkspaceUserGroup({
          name: "Legacy",
          memberEmails: [owner],
          isTeam: true,
        }),
      );
      expect(replacement.id).not.toBe("old-group");
      expect(
        await as(owner, () =>
          resolveThreadAccess(owner, "bound-after-conversion", "owner", {
            orgId,
          }),
        ),
      ).toBeNull();
    } finally {
      lifecycleDb = undefined;
      vi.clearAllMocks();
      await pglite.close();
    }
  }, 30_000);

  it("has unique ascending versions", () => {
    const versions = WORKSPACE_CONNECTIONS_MIGRATIONS.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });
});
