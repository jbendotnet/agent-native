import { z } from "zod";

import { defineAction } from "../../action.js";
import { upsertWorkspaceUserGroup } from "../groups.js";

export default defineAction({
  description:
    "Create or update a workspace user group or marked team and return its members and leads. Workspace owners and admins only.",
  schema: z.object({
    id: z.string().optional().describe("Existing user group ID to update."),
    name: z.string().describe("Group name, such as Rev Ops."),
    memberEmails: z
      .array(z.string().email())
      .default([])
      .describe("Workspace member email addresses in this group."),
    isTeam: z
      .boolean()
      .optional()
      .describe("Mark this group as a team; omitted keeps the existing value."),
    leadEmails: z
      .array(z.string().email())
      .optional()
      .describe("Complete list of team leads; each must be a member."),
  }),
  audit: { enabled: false },
  run: async (args, ctx) => {
    return upsertWorkspaceUserGroup({
      ...args,
      orgId: ctx?.orgId,
      createdByEmail: ctx?.userEmail,
      auditCaller: ctx?.caller,
    });
  },
});
