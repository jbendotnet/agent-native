import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  listWorkspaceUserGroupsForOrg,
  workspaceUserGroupRole,
} from "../groups.js";

export default defineAction({
  description:
    "List reusable workspace user groups. Owners and admins see all members; team members see their own team's members and leads. Other groups expose names only.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const role = await workspaceUserGroupRole(ctx?.orgId, ctx?.userEmail);
    if (!role) fail("Workspace membership is required.", { statusCode: 403 });
    const groups = await listWorkspaceUserGroupsForOrg(ctx?.orgId ?? "");
    if (role === "owner" || role === "admin") return groups;
    const email = ctx?.userEmail?.trim().toLowerCase();
    return groups.map((group) =>
      group.isTeam &&
      email &&
      group.memberEmails.some((member) => member.toLowerCase() === email)
        ? group
        : { ...group, memberEmails: [], leadEmails: [] },
    );
  },
});
