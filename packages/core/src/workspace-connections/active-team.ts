import { appStateGet, appStatePut } from "../application-state/store.js";
import {
  getUserSetting,
  mutateUserSetting,
} from "../settings/user-settings.js";
import { getWorkspaceTeamForMember, workspaceUserGroupRole } from "./groups.js";

const SETTING_KEY = "active-workspace-teams";
export const ACTIVE_WORKSPACE_TEAM_STATE_KEY = "active-workspace-team";

export class ActiveWorkspaceTeamError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

function selections(
  value: Record<string, unknown> | null,
): Record<string, string> {
  if (value === null) return {};
  const entries = value.byOrg;
  if (
    !entries ||
    typeof entries !== "object" ||
    Array.isArray(entries) ||
    Object.values(entries).some((id) => typeof id !== "string" || !id.trim())
  ) {
    throw new ActiveWorkspaceTeamError(
      "Active workspace team setting is invalid.",
      409,
    );
  }
  return entries as Record<string, string>;
}

export async function readActiveWorkspaceTeam(
  email: string,
  orgId: string,
): Promise<string | null> {
  email = email.trim().toLowerCase();
  if (!(await workspaceUserGroupRole(orgId, email))) {
    throw new ActiveWorkspaceTeamError(
      "Current organization membership is required.",
      403,
    );
  }
  const byOrg = selections(await getUserSetting(email, SETTING_KEY));
  if (!Object.hasOwn(byOrg, orgId)) return null;
  const id = byOrg[orgId];
  if (id === undefined) {
    throw new ActiveWorkspaceTeamError(
      "Active workspace team setting is invalid.",
      409,
    );
  }
  if (await getWorkspaceTeamForMember(orgId, id, email)) return id;
  try {
    await mutateUserSetting(email, SETTING_KEY, (current) => {
      const byOrg = { ...selections(current) };
      if (byOrg[orgId] === id) delete byOrg[orgId];
      return { byOrg };
    });
  } catch (error) {
    if (error instanceof ActiveWorkspaceTeamError) throw error;
    throw new ActiveWorkspaceTeamError(
      "Invalid active workspace team could not be cleared.",
      503,
    );
  }
  return null;
}

export async function writeActiveWorkspaceTeam(
  email: string,
  orgId: string,
  teamGroupId: string | null,
): Promise<string | null> {
  email = email.trim().toLowerCase();
  if (!(await workspaceUserGroupRole(orgId, email))) {
    throw new ActiveWorkspaceTeamError(
      "Current organization membership is required.",
      403,
    );
  }
  if (
    teamGroupId !== null &&
    !(await getWorkspaceTeamForMember(orgId, teamGroupId, email))
  ) {
    throw new ActiveWorkspaceTeamError(
      "Current organization and team membership are required.",
      403,
    );
  }
  try {
    await mutateUserSetting(email, SETTING_KEY, (current) => {
      const byOrg = { ...selections(current) };
      if (teamGroupId === null) delete byOrg[orgId];
      else byOrg[orgId] = teamGroupId;
      return { byOrg };
    });
  } catch (error) {
    if (error instanceof ActiveWorkspaceTeamError) throw error;
    throw new ActiveWorkspaceTeamError(
      "Active workspace team could not be saved.",
      503,
    );
  }
  return teamGroupId;
}

export async function mirrorActiveWorkspaceTeam(
  email: string,
  orgId: string | null,
  teamGroupId: string | null,
): Promise<void> {
  try {
    const current = await appStateGet(email, ACTIVE_WORKSPACE_TEAM_STATE_KEY);
    if (current?.orgId === orgId && current.teamGroupId === teamGroupId) return;
    await appStatePut(email, ACTIVE_WORKSPACE_TEAM_STATE_KEY, {
      orgId,
      teamGroupId,
    });
  } catch {
    throw new ActiveWorkspaceTeamError(
      "Active workspace team session mirror could not be updated.",
      503,
    );
  }
}

export async function restoreActiveWorkspaceTeam(
  email: string,
  orgId: string | null,
): Promise<{ orgId: string | null; teamGroupId: string | null }> {
  const teamGroupId = orgId
    ? await readActiveWorkspaceTeam(email, orgId)
    : null;
  await mirrorActiveWorkspaceTeam(email, orgId, teamGroupId);
  return { orgId, teamGroupId };
}
