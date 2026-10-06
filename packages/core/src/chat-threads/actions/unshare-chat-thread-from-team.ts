import { z } from "zod";

import { defineAction } from "../../action.js";
import { changeChatThreadTeamShare } from "../team-sharing.js";

export default defineAction({
  description:
    "Revoke a chat thread's viewer grant to a team. Only the recorded owner may revoke it.",
  schema: z.strictObject({
    threadId: z.string().min(1).describe("Conversation ID to unshare"),
    teamGroupId: z
      .string()
      .min(1)
      .describe("Marked team ID whose access to revoke"),
  }),
  run: ({ threadId, teamGroupId }) =>
    changeChatThreadTeamShare(threadId, teamGroupId, "unshare"),
});
