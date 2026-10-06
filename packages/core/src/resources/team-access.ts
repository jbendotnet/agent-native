import { createError } from "h3";

import { getWorkspaceTeamForMember } from "../workspace-connections/groups.js";

const TEAM_OWNER_PREFIX = "__team__:";

export function teamGroupIdFromResourceOwner(owner: string): string | null {
  if (!owner.startsWith(TEAM_OWNER_PREFIX)) return null;
  const id = owner.slice(TEAM_OWNER_PREFIX.length);
  return id && id === id.trim() ? id : null;
}

export async function authorizedTeamResourceOwner(
  teamGroupId: unknown,
  orgId: string | null | undefined,
  email: string | null | undefined,
): Promise<string> {
  if (
    typeof teamGroupId !== "string" ||
    !teamGroupId.trim() ||
    teamGroupId !== teamGroupId.trim() ||
    !orgId ||
    !email
  ) {
    throw createError({
      statusCode: 404,
      statusMessage: "Team not found or access denied",
    });
  }
  const team = await getWorkspaceTeamForMember(orgId, teamGroupId, email);
  if (!team || team.id !== teamGroupId) {
    throw createError({
      statusCode: 404,
      statusMessage: "Team not found or access denied",
    });
  }
  return `${TEAM_OWNER_PREFIX}${teamGroupId}`;
}

export async function assertTeamResourceTarget(
  owner: string,
  teamGroupId: unknown,
  orgId: string | null | undefined,
  email: string | null | undefined,
): Promise<boolean> {
  if (!owner.startsWith(TEAM_OWNER_PREFIX) && teamGroupId === undefined)
    return true;
  const target = await authorizedTeamResourceOwner(teamGroupId, orgId, email);
  return teamGroupIdFromResourceOwner(owner) !== null && owner === target;
}
