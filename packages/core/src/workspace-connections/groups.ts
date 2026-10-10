import { randomUUID } from "node:crypto";

import { fail } from "../action.js";
import { deriveActorKind } from "../audit/config.js";
import { ensureAuditTables } from "../audit/store.js";
import {
  getDbExec,
  isProductionServerlessFunctionRuntime,
  isUniqueViolation,
  retryOnDdlRace,
  safeJsonParse,
  type DbExec,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { isMigrationAuthorizedRuntime } from "../db/migration-runtime.js";
import { isOrgMember } from "../org/membership.js";
import { invalidateCollabAccessCacheForGroupChange } from "../server/poll.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  ensureWorkspaceConnectionsTable,
  removeWorkspaceUserGroupFromConnections,
} from "./store.js";

export interface WorkspaceUserGroup {
  id: string;
  orgId: string;
  name: string;
  memberEmails: string[];
  isTeam: boolean;
  leadEmails: string[];
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWorkspaceUserGroupInput {
  id?: string;
  name: string;
  memberEmails: string[];
  isTeam?: boolean;
  leadEmails?: string[];
  orgId?: string | null;
  createdByEmail?: string;
  auditCaller?: string;
}

export interface UpdateWorkspaceUserGroupMembersInput {
  id: string;
  memberEmails: string[];
  operation: "add" | "remove";
  orgId?: string | null;
  auditCaller?: string;
}

export interface SetWorkspaceTeamLeadsInput {
  teamGroupId: string;
  leadEmails: string[];
  orgId?: string | null;
  auditCaller?: string;
}

export function workspaceUserGroupsTable(): string {
  return "public.workspace_user_groups";
}

const WORKSPACE_USER_GROUP_NAME_INDEX =
  "idx_workspace_user_groups_org_normalized_name";
const WORKSPACE_USER_GROUP_NAME_TRIGGER =
  "trg_workspace_user_groups_normalized_name";
const WORKSPACE_USER_GROUP_NAME_FUNCTION =
  "public.workspace_user_groups_set_normalized_name";

function isDuplicateObjectError(err: unknown): boolean {
  const code = stringifyValue((err as { code?: unknown })?.code ?? "");
  const message = String((err as { message?: unknown })?.message ?? err)
    .toLowerCase()
    .trim();
  return (
    code === "42710" ||
    message.includes("already exists") ||
    message.includes("duplicate")
  );
}

function normalizeMemberEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function validateEmailList(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((email) => typeof email !== "string" || !email.trim())
  ) {
    throw new Error(`${field} must be a list of email addresses.`);
  }
  return normalizeMemberEmails(value);
}

export function normalizeWorkspaceUserGroupIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeGroupName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new Error("Workspace user group name is required.");
  if (name.length > 80) {
    throw new Error(
      "Workspace user group names must be 80 characters or less.",
    );
  }
  return name;
}

function duplicateWorkspaceUserGroupNameError(name: string): Error {
  return new Error(`A workspace user group named "${name}" already exists.`);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  const parsed = Date.parse(stringifyValue(value ?? ""));
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date(0).toISOString();
}

function requireWorkspaceUserGroupScope(): {
  orgId: string;
  userEmail: string;
} {
  const orgId = getRequestOrgId()?.trim();
  const userEmail = getRequestUserEmail()?.trim().toLowerCase();
  if (!orgId) {
    throw new Error("Workspace user groups require an active workspace.");
  }
  if (!userEmail) {
    throw new Error("Workspace user groups require an authenticated user.");
  }
  return { orgId, userEmail };
}

function parseRow(row: Record<string, unknown>): WorkspaceUserGroup {
  return {
    id: stringifyValue(row.id ?? ""),
    orgId: stringifyValue(row.org_id ?? ""),
    name: stringifyValue(row.name ?? ""),
    memberEmails: normalizeMemberEmails(
      safeJsonParse<unknown>(row.member_emails_json, []),
    ),
    isTeam: row.is_team === true,
    leadEmails: normalizeMemberEmails(
      safeJsonParse<unknown>(row.lead_emails_json, []),
    ),
    createdByEmail: stringifyValue(row.created_by_email ?? ""),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function ensureWorkspaceUserGroupColumns(
  client: DbExec,
  table: string,
): Promise<void> {
  const columns = [
    ["org_id", "TEXT NOT NULL DEFAULT ''"],
    ["name", "TEXT NOT NULL DEFAULT ''"],
    ["member_emails_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["is_team", "BOOLEAN NOT NULL DEFAULT false"],
    ["lead_emails_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["normalized_name", "TEXT"],
    ["created_by_email", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", `BIGINT NOT NULL DEFAULT 0`],
    ["updated_at", `BIGINT NOT NULL DEFAULT 0`],
  ] as const;
  for (const [name, definition] of columns) {
    try {
      await retryOnDdlRace(() =>
        client.execute(
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${definition}`,
        ),
      );
    } catch (error) {
      if (!isDuplicateObjectError(error)) throw error;
    }
  }
}

async function ensureWorkspaceUserGroupNameTrigger(
  client: DbExec,
): Promise<void> {
  await retryOnDdlRace(() =>
    client.execute(`
      CREATE OR REPLACE FUNCTION ${WORKSPACE_USER_GROUP_NAME_FUNCTION}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS 'BEGIN
        NEW.normalized_name := LOWER(BTRIM(NEW.name));
        RETURN NEW;
      END;'
    `),
  );
  try {
    await retryOnDdlRace(() =>
      client.execute(`
        CREATE TRIGGER ${WORKSPACE_USER_GROUP_NAME_TRIGGER}
          BEFORE INSERT OR UPDATE OF name ON public.workspace_user_groups
          FOR EACH ROW
          EXECUTE FUNCTION ${WORKSPACE_USER_GROUP_NAME_FUNCTION}()
      `),
    );
  } catch (error) {
    if (!isDuplicateObjectError(error)) throw error;
  }
}

let initPromise: Promise<void> | undefined;

export async function ensureWorkspaceUserGroupsTable(): Promise<void> {
  if (
    isProductionServerlessFunctionRuntime() &&
    !isMigrationAuthorizedRuntime()
  ) {
    return;
  }
  if (!initPromise) {
    initPromise = (async () => {
      const client = getDbExec();
      const table = workspaceUserGroupsTable();
      const createSql = `
        CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          normalized_name TEXT,
          member_emails_json TEXT NOT NULL DEFAULT '[]',
          is_team BOOLEAN NOT NULL DEFAULT false,
          lead_emails_json TEXT NOT NULL DEFAULT '[]',
          created_by_email TEXT NOT NULL DEFAULT '',
          created_at BIGINT NOT NULL DEFAULT 0,
          updated_at BIGINT NOT NULL DEFAULT 0
        )
      `;

      {
        await ensureTableExists("workspace_user_groups", createSql);
        await ensureWorkspaceUserGroupColumns(client, table);
        await ensureWorkspaceUserGroupNameTrigger(client);
        await ensureIndexExists(
          "idx_workspace_user_groups_org_updated",
          `CREATE INDEX IF NOT EXISTS idx_workspace_user_groups_org_updated ON ${table} (org_id, updated_at)`,
        );
        await ensureIndexExists(
          WORKSPACE_USER_GROUP_NAME_INDEX,
          `CREATE UNIQUE INDEX IF NOT EXISTS ${WORKSPACE_USER_GROUP_NAME_INDEX}
             ON ${table} (org_id, normalized_name)
             WHERE normalized_name IS NOT NULL`,
        );
        return;
      }

      await retryOnDdlRace(() => client.execute(createSql));
      await ensureWorkspaceUserGroupColumns(client, table);
      await ensureWorkspaceUserGroupNameTrigger(client);
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_workspace_user_groups_org_updated ON ${table} (org_id, updated_at)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${WORKSPACE_USER_GROUP_NAME_INDEX}
             ON ${table} (org_id, normalized_name)
             WHERE normalized_name IS NOT NULL`,
        ),
      );
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

export async function listWorkspaceUserGroupsForOrg(
  orgId: string,
  groupIds?: string[],
): Promise<WorkspaceUserGroup[]> {
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return [];
  await ensureWorkspaceUserGroupsTable();
  const client = getDbExec();
  const table = workspaceUserGroupsTable();
  const normalizedIds = normalizeWorkspaceUserGroupIds(groupIds);
  const args: unknown[] = [normalizedOrgId];
  let filter = "org_id = ?";
  if (normalizedIds.length > 0) {
    filter += ` AND id IN (${normalizedIds.map(() => "?").join(", ")})`;
    args.push(...normalizedIds);
  }
  const { rows } = await client.execute({
    sql: `SELECT * FROM ${table} WHERE ${filter} ORDER BY updated_at DESC, name ASC`,
    args,
  });
  return rows.map((row) => parseRow(row as Record<string, unknown>));
}

export async function listWorkspaceUserGroups(): Promise<WorkspaceUserGroup[]> {
  const { orgId } = requireWorkspaceUserGroupScope();
  return listWorkspaceUserGroupsForOrg(orgId);
}

export async function assertWorkspaceUserGroupIds(
  groupIds: string[] | undefined,
  orgId: string | null | undefined,
): Promise<string[] | undefined> {
  if (groupIds === undefined) return undefined;
  const normalized = normalizeWorkspaceUserGroupIds(groupIds);
  if (normalized.length === 0) return normalized;
  const normalizedOrgId = orgId?.trim();
  if (!normalizedOrgId) {
    throw new Error(
      "User groups require a workspace. Personal connections are only available to you.",
    );
  }
  const groups = await listWorkspaceUserGroupsForOrg(
    normalizedOrgId,
    normalized,
  );
  const found = new Set(groups.map((group) => group.id));
  const missing = normalized.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(
      `User groups were not found in this workspace: ${missing.join(", ")}.`,
    );
  }
  return normalized;
}

export async function assertWorkspaceUserGroupManager(
  orgId: string | null | undefined,
  userEmail: string | undefined,
): Promise<void> {
  const role = await workspaceUserGroupRole(orgId, userEmail);
  if (role === "owner" || role === "admin") return;
  fail("Only workspace admins can manage user groups.", { statusCode: 403 });
}

export async function workspaceUserGroupRole(
  orgId: string | null | undefined,
  userEmail: string | undefined,
): Promise<"owner" | "admin" | "member" | null> {
  const normalizedOrgId = orgId?.trim();
  const normalizedEmail = userEmail?.trim().toLowerCase();
  if (!normalizedOrgId || !normalizedEmail) {
    return null;
  }
  if (!(await isOrgMember(normalizedOrgId, normalizedEmail))) return null;
  const { rows } = await getDbExec().execute({
    sql: `SELECT role FROM org_members
          WHERE org_id = ? AND LOWER(email) = ?
            AND federation_removal_pending_at IS NULL
          LIMIT 1`,
    args: [normalizedOrgId, normalizedEmail],
  });
  const role = String(
    (rows[0] as Record<string, unknown> | undefined)?.role ?? "",
  );
  return role === "owner" || role === "admin" || role === "member"
    ? role
    : null;
}

async function mutateWorkspaceUserGroup(
  orgId: string,
  actor: string,
  id: string | undefined,
  caller: string,
  memberEmails: string[],
  change: (
    current: WorkspaceUserGroup | undefined,
    role: "owner" | "admin" | "member",
    tx: DbExec,
  ) => Promise<WorkspaceUserGroup>,
): Promise<WorkspaceUserGroup> {
  await ensureWorkspaceUserGroupsTable();
  if (!(await isOrgMember(orgId, actor))) {
    fail("Only current workspace members can manage user groups.", {
      statusCode: 403,
    });
  }
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error(
      "Workspace user group changes require database transactions.",
    );
  }
  await ensureAuditTables();
  const result = await client.transaction(async (tx) => {
    const memberships = await lockCurrentOrgMembers(tx, orgId, [
      actor,
      ...memberEmails,
    ]);
    const roles = memberships.filter(
      (row) => (row as { email: string }).email === actor,
    );
    const role = String(
      (roles[0] as { role?: string } | undefined)?.role ?? "",
    );
    if (role !== "owner" && role !== "admin" && role !== "member") {
      fail("Only current workspace members can manage user groups.", {
        statusCode: 403,
      });
    }
    const current = id
      ? (
          await tx.execute({
            sql: `SELECT * FROM ${workspaceUserGroupsTable()} WHERE id = ? AND org_id = ? FOR UPDATE`,
            args: [id, orgId],
          })
        ).rows[0]
      : undefined;
    if (id && !current) throw new Error(`User group "${id}" was not found.`);
    const before = current
      ? parseRow(current as Record<string, unknown>)
      : undefined;
    const after = await change(before, role, tx);
    const addedMembers = after.memberEmails.filter(
      (email) => !before?.memberEmails.includes(email),
    );
    const removedMembers =
      before?.memberEmails.filter(
        (email) => !after.memberEmails.includes(email),
      ) ?? [];
    const addedLeads = after.leadEmails.filter(
      (email) => !before?.leadEmails.includes(email),
    );
    const removedLeads =
      before?.leadEmails.filter((email) => !after.leadEmails.includes(email)) ??
      [];
    const converted = !before?.isTeam && after.isTeam;
    if (converted) {
      const { rows: tables } = await tx.execute({
        sql: "SELECT to_regclass('chat_threads') AS threads, to_regclass('chat_thread_shares') AS shares",
        args: [],
      });
      if (tables[0]?.threads && tables[0]?.shares) {
        await tx.execute({
          sql: `SELECT t.id FROM chat_threads t JOIN chat_thread_shares s ON s.resource_id = t.id
            WHERE t.org_id = ? AND s.principal_type = 'group' AND s.principal_id = ?
            ORDER BY t.id FOR UPDATE OF t`,
          args: [orgId, after.id],
        });
        const { rows: conflicts } = await tx.execute({
          sql: `SELECT 1 FROM chat_thread_shares s
            JOIN chat_threads t ON t.id = s.resource_id AND t.org_id = ?
            JOIN workspace_user_groups g ON g.id = s.principal_id AND g.org_id = ? AND g.is_team = true
            WHERE s.principal_type = 'group' AND s.principal_id <> ?
              AND EXISTS (SELECT 1 FROM chat_thread_shares candidate
                WHERE candidate.resource_id = t.id AND candidate.principal_type = 'group' AND candidate.principal_id = ?)
            LIMIT 1`,
          args: [orgId, orgId, after.id, after.id],
        });
        if (conflicts.length) {
          fail(
            "Convert only after removing conflicting conversation team shares.",
            { statusCode: 409 },
          );
        }
      }
    }
    if (
      addedMembers.length ||
      removedMembers.length ||
      addedLeads.length ||
      removedLeads.length ||
      converted
    ) {
      await tx.execute({
        sql: `INSERT INTO agent_audit_log
          (id, created_at, action, caller, actor_kind, actor_email, org_id,
           target_type, target_id, status, summary, input, owner_email, visibility)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          randomUUID(),
          Date.now(),
          "workspace-user-group-change",
          caller,
          deriveActorKind(caller, actor),
          actor,
          orgId,
          "workspace-user-group",
          after.id,
          "success",
          "Changed workspace user group membership or roles",
          JSON.stringify({
            addedMembers,
            removedMembers,
            addedLeads,
            removedLeads,
            converted,
          }),
          actor,
          "admins",
        ],
      });
    }
    return after;
  });
  invalidateCollabAccessCacheForGroupChange();
  return result;
}

async function lockCurrentOrgMembers(
  tx: DbExec,
  orgId: string,
  memberEmails: string[],
): Promise<Array<{ email: string; role: string }>> {
  // Lock before the group row in deterministic order; org role/offboarding
  // writers update or delete these rows and must wait for this transaction.
  const emails = Array.from(new Set(memberEmails)).sort();
  const { rows } = await tx.execute({
    sql: `SELECT LOWER(email) AS email, role FROM org_members
      WHERE org_id = ? AND LOWER(email) IN (${emails.map(() => "?").join(", ")})
        AND federation_removal_pending_at IS NULL
      ORDER BY LOWER(email), id FOR UPDATE`,
    args: [orgId, ...emails],
  });
  return rows as Array<{ email: string; role: string }>;
}

function requireGroupManager(role: string): void {
  if (role !== "owner" && role !== "admin") {
    fail("Only workspace admins can manage user groups.", { statusCode: 403 });
  }
}

async function validateGroupMembers(
  tx: DbExec,
  orgId: string,
  memberEmails: string[],
): Promise<void> {
  const missing: string[] = [];
  for (const email of memberEmails) {
    const { rows } = await tx.execute({
      sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = ?
        AND federation_removal_pending_at IS NULL LIMIT 1`,
      args: [orgId, email],
    });
    if (!rows.length) missing.push(email);
  }
  if (missing.length) {
    throw new Error(
      `Group members must belong to this workspace: ${missing.join(", ")}.`,
    );
  }
}

async function validateCurrentOrgMembers(
  orgId: string,
  memberEmails: string[],
): Promise<void> {
  const missing = (
    await Promise.all(
      memberEmails.map(async (email) =>
        (await isOrgMember(orgId, email)) ? null : email,
      ),
    )
  ).filter((email): email is string => email !== null);
  if (missing.length) {
    throw new Error(
      `Group members must belong to this workspace: ${missing.join(", ")}.`,
    );
  }
}

async function persistWorkspaceUserGroup(
  tx: DbExec,
  orgId: string,
  actor: string,
  current: WorkspaceUserGroup | undefined,
  name: string,
  memberEmails: string[],
  isTeam: boolean,
  leadEmails: string[],
): Promise<WorkspaceUserGroup> {
  const id = current?.id ?? randomUUID();
  const now = Date.now();
  try {
    if (current) {
      await tx.execute({
        sql: `UPDATE ${workspaceUserGroupsTable()} SET name = ?, normalized_name = LOWER(BTRIM(?)),
          member_emails_json = ?, is_team = ?, lead_emails_json = ?, updated_at = ?
          WHERE id = ? AND org_id = ?`,
        args: [
          name,
          name,
          JSON.stringify(memberEmails),
          isTeam,
          JSON.stringify(leadEmails),
          now,
          id,
          orgId,
        ],
      });
    } else {
      await tx.execute({
        sql: `INSERT INTO ${workspaceUserGroupsTable()}
          (id, org_id, name, normalized_name, member_emails_json, is_team, lead_emails_json, created_by_email, created_at, updated_at)
          VALUES (?, ?, ?, LOWER(BTRIM(?)), ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          orgId,
          name,
          name,
          JSON.stringify(memberEmails),
          isTeam,
          JSON.stringify(leadEmails),
          actor,
          now,
          now,
        ],
      });
    }
  } catch (error) {
    if (isUniqueViolation(error))
      throw duplicateWorkspaceUserGroupNameError(name);
    throw error;
  }
  const { rows } = await tx.execute({
    sql: `SELECT * FROM ${workspaceUserGroupsTable()} WHERE id = ? AND org_id = ?`,
    args: [id, orgId],
  });
  return parseRow(rows[0] as Record<string, unknown>);
}

export async function upsertWorkspaceUserGroup(
  input: UpsertWorkspaceUserGroupInput,
): Promise<WorkspaceUserGroup> {
  const requestScope = requireWorkspaceUserGroupScope();
  const orgId = input.orgId?.trim() || requestScope.orgId;
  if (orgId !== requestScope.orgId) {
    throw new Error("User groups must belong to the active workspace.");
  }
  const name = normalizeGroupName(input.name);
  const memberEmails = validateEmailList(input.memberEmails, "Group members");
  await validateCurrentOrgMembers(orgId, memberEmails);
  if (input.id !== undefined && !input.id.trim()) {
    throw new Error("A user group is required.");
  }
  if (input.isTeam !== undefined && typeof input.isTeam !== "boolean") {
    throw new Error("isTeam must be a boolean.");
  }
  return mutateWorkspaceUserGroup(
    orgId,
    requestScope.userEmail,
    input.id?.trim(),
    input.auditCaller ?? "http",
    memberEmails,
    async (current, role, tx) => {
      requireGroupManager(role);
      const isTeam = input.isTeam ?? current?.isTeam ?? false;
      if (current?.isTeam && !isTeam) {
        throw new Error("A team cannot be converted back to a user group.");
      }
      const leads =
        input.leadEmails === undefined
          ? (current?.leadEmails ?? [])
          : validateEmailList(input.leadEmails, "Team leads");
      if (!isTeam && leads.length) {
        throw new Error("Ordinary user groups cannot have team leads.");
      }
      if (
        input.leadEmails !== undefined &&
        leads.some((email) => !memberEmails.includes(email))
      ) {
        throw new Error("Team leads must be group members.");
      }
      const nextLeads = leads.filter((email) => memberEmails.includes(email));
      await validateGroupMembers(tx, orgId, memberEmails);
      return persistWorkspaceUserGroup(
        tx,
        orgId,
        requestScope.userEmail,
        current,
        name,
        memberEmails,
        isTeam,
        nextLeads,
      );
    },
  );
}

export async function updateWorkspaceUserGroupMembers(
  input: UpdateWorkspaceUserGroupMembersInput,
): Promise<WorkspaceUserGroup> {
  const requestScope = requireWorkspaceUserGroupScope();
  const orgId = input.orgId?.trim() || requestScope.orgId;
  if (orgId !== requestScope.orgId) {
    throw new Error("User groups must belong to the active workspace.");
  }

  const id = input.id.trim();
  if (!id) throw new Error("A user group is required.");
  const memberEmails = validateEmailList(input.memberEmails, "Group members");
  if (input.operation === "add")
    await validateCurrentOrgMembers(orgId, memberEmails);
  return mutateWorkspaceUserGroup(
    orgId,
    requestScope.userEmail,
    id,
    input.auditCaller ?? "http",
    input.operation === "add" ? memberEmails : [],
    async (group, role, tx) => {
      if (!group) throw new Error(`User group "${id}" was not found.`);
      if (
        role === "member" &&
        (!group.isTeam || !group.leadEmails.includes(requestScope.userEmail))
      ) {
        fail("Only workspace admins or team leads can manage group members.", {
          statusCode: 403,
        });
      }
      if (
        role === "member" &&
        input.operation === "remove" &&
        memberEmails.some((email) => group.leadEmails.includes(email))
      ) {
        fail("Team leads cannot remove team leads.", { statusCode: 403 });
      }
      if (input.operation !== "add" && input.operation !== "remove") {
        throw new Error("Invalid group membership operation.");
      }
      const nextMembers =
        input.operation === "add"
          ? Array.from(new Set([...group.memberEmails, ...memberEmails]))
          : group.memberEmails.filter((email) => !memberEmails.includes(email));
      if (input.operation === "add") {
        await validateGroupMembers(tx, orgId, memberEmails);
      }
      return persistWorkspaceUserGroup(
        tx,
        orgId,
        requestScope.userEmail,
        group,
        group.name,
        nextMembers,
        group.isTeam,
        group.leadEmails.filter((email) => nextMembers.includes(email)),
      );
    },
  );
}

export async function setWorkspaceTeamLeads(
  input: SetWorkspaceTeamLeadsInput,
): Promise<WorkspaceUserGroup> {
  const scope = requireWorkspaceUserGroupScope();
  const orgId = input.orgId?.trim() || scope.orgId;
  if (orgId !== scope.orgId)
    throw new Error("User groups must belong to the active workspace.");
  const id = input.teamGroupId.trim();
  if (!id) throw new Error("A team is required.");
  const leads = validateEmailList(input.leadEmails, "Team leads");
  await validateCurrentOrgMembers(orgId, leads);
  return mutateWorkspaceUserGroup(
    orgId,
    scope.userEmail,
    id,
    input.auditCaller ?? "http",
    leads,
    async (group, role, tx) => {
      requireGroupManager(role);
      if (!group?.isTeam) throw new Error("A marked team is required.");
      if (leads.some((email) => !group.memberEmails.includes(email))) {
        throw new Error("Team leads must be group members.");
      }
      await validateGroupMembers(tx, orgId, leads);
      return persistWorkspaceUserGroup(
        tx,
        orgId,
        scope.userEmail,
        group,
        group.name,
        group.memberEmails,
        true,
        leads,
      );
    },
  );
}

export async function deleteWorkspaceUserGroup(
  id: string,
  orgId?: string | null,
): Promise<boolean> {
  const requestScope = requireWorkspaceUserGroupScope();
  const normalizedOrgId = orgId?.trim() || requestScope.orgId;
  if (normalizedOrgId !== requestScope.orgId) {
    throw new Error("User groups must belong to the active workspace.");
  }
  const normalizedId = id.trim();
  if (!normalizedId) throw new Error("A user group is required.");

  await assertWorkspaceUserGroupManager(
    normalizedOrgId,
    requestScope.userEmail,
  );

  await ensureWorkspaceUserGroupsTable();
  await ensureWorkspaceConnectionsTable();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error(
      "Workspace user group changes require database transactions.",
    );
  }
  const deleted = await client.transaction(async (tx) => {
    const memberships = await lockCurrentOrgMembers(tx, normalizedOrgId, [
      requestScope.userEmail,
    ]);
    requireGroupManager(memberships[0]?.role ?? "");
    const { rows } = await tx.execute({
      sql: `SELECT id FROM ${workspaceUserGroupsTable()} WHERE id = ? AND org_id = ? FOR UPDATE`,
      args: [normalizedId, normalizedOrgId],
    });
    if (!rows.length) return false;
    await removeWorkspaceUserGroupFromConnections(
      tx,
      normalizedOrgId,
      normalizedId,
    );
    const result = await tx.execute({
      sql: `DELETE FROM ${workspaceUserGroupsTable()} WHERE id = ? AND org_id = ?`,
      args: [normalizedId, normalizedOrgId],
    });
    return result.rowsAffected > 0;
  });
  if (deleted) invalidateCollabAccessCacheForGroupChange();
  return deleted;
}

export async function getWorkspaceTeamForMember(
  orgId: string,
  teamGroupId: string,
  userEmail: string,
): Promise<WorkspaceUserGroup | null> {
  const email = userEmail.trim().toLowerCase();
  const id = teamGroupId.trim();
  if (!id || !(await isOrgMember(orgId, email))) return null;
  const group = (await listWorkspaceUserGroupsForOrg(orgId, [id]))[0];
  return group?.isTeam && group.memberEmails.includes(email) ? group : null;
}

export async function workspaceUserGroupsIncludeUser(
  orgId: string | null | undefined,
  groupIds: string[] | undefined,
  userEmail: string,
): Promise<boolean> {
  const normalizedOrgId = orgId?.trim();
  const normalizedEmail = userEmail.trim().toLowerCase();
  const normalizedIds = normalizeWorkspaceUserGroupIds(groupIds);
  if (!normalizedOrgId || !normalizedEmail || normalizedIds.length === 0) {
    return false;
  }
  if (!(await isOrgMember(normalizedOrgId, normalizedEmail))) return false;
  const groups = await listWorkspaceUserGroupsForOrg(
    normalizedOrgId,
    normalizedIds,
  );
  return groups.some((group) => group.memberEmails.includes(normalizedEmail));
}

function stringifyValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return value == null ? "" : (JSON.stringify(value) ?? "");
}
