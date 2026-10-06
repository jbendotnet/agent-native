import { z } from "zod";

import { defineAction } from "../../action.js";
import { updateWorkspaceUserGroupMembers } from "../groups.js";

export default defineAction({
  description:
    "Add or remove existing workspace members from a group and return its members and leads. Team leads may change ordinary members of their own team.",
  schema: z.object({
    groupId: z.string().min(1).describe("User group ID to update."),
    memberEmails: z
      .array(z.string().email())
      .min(1)
      .max(100)
      .describe("Workspace member email addresses to change."),
    operation: z.enum(["add", "remove"]).describe("Membership operation."),
  }),
  audit: { enabled: false },
  run: async (args, ctx) => {
    return updateWorkspaceUserGroupMembers({
      id: args.groupId,
      memberEmails: args.memberEmails,
      operation: args.operation,
      orgId: ctx?.orgId,
      auditCaller: ctx?.caller,
    });
  },
});
