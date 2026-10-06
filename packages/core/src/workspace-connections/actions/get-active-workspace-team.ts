import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  ActiveWorkspaceTeamError,
  restoreActiveWorkspaceTeam,
} from "../active-team.js";

export default defineAction({
  description:
    "Read the current organization's saved active team, revalidating membership and reflecting the selection in application state. Returns the organization and team IDs or null.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    if (!ctx?.userEmail || !ctx.orgId)
      fail("Current organization membership is required.", { statusCode: 403 });
    try {
      return await restoreActiveWorkspaceTeam(ctx.userEmail, ctx.orgId);
    } catch (error) {
      if (error instanceof ActiveWorkspaceTeamError)
        fail(error.message, { statusCode: error.statusCode });
      throw error;
    }
  },
});
