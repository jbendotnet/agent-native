import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { withChatThreadGroupMutationLock } from "../../chat-threads/team-sharing.js";
import { invalidateCollabAccessCache } from "../../server/poll.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import {
  getWorkspaceTeamForMember,
  listWorkspaceUserGroupsForOrg,
} from "../../workspace-connections/groups.js";
import { ForbiddenError } from "../access.js";
import { assertAccess } from "../access.js";
import { requireShareableResource } from "../registry.js";
import { assertWidgetShareWriteGrant } from "../widget-grant.js";
import { resourceSharingChange } from "./change-result.js";
import {
  getExtensionShareChangeTargets,
  notifyExtensionShareChanged,
} from "./extension-change.js";

function normalizePrincipalId(
  principalType: "user" | "group" | "org",
  principalId: string,
): string {
  return principalType === "user"
    ? principalId.trim().toLowerCase()
    : principalId;
}

function principalIdMatches(
  sharesTable: any,
  principalType: "user" | "group" | "org",
  principalId: string,
): SQL {
  return principalType === "user"
    ? sql`lower(${sharesTable.principalId}) = ${principalId}`
    : eq(sharesTable.principalId, principalId);
}

export default defineAction({
  description:
    "Revoke a previously granted share. Owner or admin role required.",
  toolCallable: false,
  schema: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
    principalType: z.enum(["user", "group", "org"]),
    principalId: z.string(),
  }),
  run: async (args, ctx) => {
    assertWidgetShareWriteGrant(ctx, "unshare-resource", args);
    const reg = requireShareableResource(args.resourceType);
    const revoke = async () => {
      const access = await assertAccess(
        args.resourceType,
        args.resourceId,
        "admin",
      );
      if (args.resourceType === "chat_thread" && access.resource.teamGroupId) {
        const email = getRequestUserEmail();
        const orgId = getRequestOrgId();
        if (
          !email ||
          !orgId ||
          orgId !== access.resource.orgId ||
          email.trim().toLowerCase() !==
            access.resource.ownerEmail?.trim().toLowerCase() ||
          !(await getWorkspaceTeamForMember(
            orgId,
            access.resource.teamGroupId,
            email,
          ))
        ) {
          throw new ForbiddenError(
            "Only the current owner and team member may manage bound conversation shares.",
          );
        }
      }
      if (
        args.resourceType === "chat_thread" &&
        args.principalType === "group" &&
        access.resource.orgId &&
        (
          await listWorkspaceUserGroupsForOrg(access.resource.orgId, [
            args.principalId,
          ])
        )[0]?.isTeam
      ) {
        throw new ForbiddenError(
          "Use unshare-chat-thread-from-team for team grants.",
        );
      }
      const beforeExtensionTargets = await getExtensionShareChangeTargets(
        args.resourceType,
        args.resourceId,
      );
      const db = reg.getDb() as any;
      const principalId = normalizePrincipalId(
        args.principalType,
        args.principalId,
      );
      const [deleted] = await db
        .delete(reg.sharesTable)
        .where(
          and(
            eq(reg.sharesTable.resourceId, args.resourceId),
            eq(reg.sharesTable.principalType, args.principalType),
            principalIdMatches(
              reg.sharesTable,
              args.principalType,
              principalId,
            ),
          ),
        )
        .returning({ id: reg.sharesTable.id });
      return { access, beforeExtensionTargets, principalId, deleted };
    };
    const { access, beforeExtensionTargets, principalId, deleted } =
      args.resourceType === "chat_thread" && args.principalType === "group"
        ? await withChatThreadGroupMutationLock(
            args.resourceId,
            args.principalId,
            revoke,
          )
        : await revoke();
    invalidateCollabAccessCache(args.resourceType, args.resourceId);
    await notifyExtensionShareChanged(
      args.resourceType,
      args.resourceId,
      beforeExtensionTargets,
    );
    return {
      ok: true,
      ...(deleted
        ? {
            change: resourceSharingChange(
              reg,
              access.resource,
              "deleted",
              `${args.principalType}:${principalId}`,
            ).change,
          }
        : {}),
    };
  },
});
