import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  ActiveWorkspaceTeamError,
  mirrorActiveWorkspaceTeam,
  writeActiveWorkspaceTeam,
} from "../active-team.js";

export default defineAction({
  description:
    "Select a marked team for new conversations in the current organization, or clear the selection. Returns the saved team ID or null.",
  schema: z.object({
    teamGroupId: z
      .string()
      .min(1)
      .nullable()
      .describe(
        "Marked team group ID in the current organization, or null to select no team.",
      ),
  }),
  run: async ({ teamGroupId }, ctx) => {
    if (!ctx?.userEmail || !ctx.orgId)
      fail("Current organization membership is required.", { statusCode: 403 });
    try {
      const saved = await writeActiveWorkspaceTeam(
        ctx.userEmail,
        ctx.orgId,
        teamGroupId,
      );
      await mirrorActiveWorkspaceTeam(ctx.userEmail, ctx.orgId, saved);
      return { orgId: ctx.orgId, teamGroupId: saved };
    } catch (error) {
      if (error instanceof ActiveWorkspaceTeamError)
        fail(error.message, { statusCode: error.statusCode });
      throw error;
    }
  },
});
