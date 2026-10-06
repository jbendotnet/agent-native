import { z } from "zod";

import { defineAction } from "../../action.js";
import { changeChatThreadTeamShare } from "../team-sharing.js";

export default defineAction({
  description:
    "Grant viewer access to a chat thread for one team. Only the recorded owner may share it.",
  schema: z.strictObject({
    threadId: z.string().min(1).describe("Conversation ID to share"),
    teamGroupId: z
      .string()
      .min(1)
      .describe("Marked team ID in the conversation's organization"),
  }),
  run: ({ threadId, teamGroupId }) =>
    changeChatThreadTeamShare(threadId, teamGroupId, "share"),
});
