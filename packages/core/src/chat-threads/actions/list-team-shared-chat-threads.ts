import { z } from "zod";

import { defineAction } from "../../action.js";
import { listTeamSharedChatThreads } from "../team-sharing.js";

export default defineAction({
  description:
    "List conversations explicitly shared with a team for its current members, newest first.",
  schema: z.object({
    teamGroupId: z
      .string()
      .min(1)
      .describe("Marked team ID to list shared conversations for"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe("Page size, 1 to 100; defaults to 25"),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Number of matching conversations to skip; defaults to 0"),
  }),
  http: { method: "GET" },
  run: ({ teamGroupId, limit, offset }) =>
    listTeamSharedChatThreads(teamGroupId, limit, offset),
});
