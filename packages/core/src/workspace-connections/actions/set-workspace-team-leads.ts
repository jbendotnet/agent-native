import { z } from "zod";

import { defineAction } from "../../action.js";
import { setWorkspaceTeamLeads } from "../groups.js";

export default defineAction({
  description:
    "Set the complete lead list of a marked team. Only current workspace owners and admins may do this.",
  schema: z.object({
    teamGroupId: z.string().min(1).describe("Marked team group ID."),
    leadEmails: z
      .array(z.string().email())
      .describe("Complete list of current team members who lead the team."),
  }),
  audit: { enabled: false },
  run: (args, ctx) =>
    setWorkspaceTeamLeads({
      ...args,
      orgId: ctx?.orgId,
      auditCaller: ctx?.caller,
    }),
});
