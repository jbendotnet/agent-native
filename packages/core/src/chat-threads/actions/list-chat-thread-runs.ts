import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { listRunsForThread } from "../../agent/run-store.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { resolveThreadAccess } from "../store.js";

export default defineAction({
  description:
    "List up to ten linked runs on a conversation the current member can read.",
  schema: z.strictObject({
    threadId: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(10).default(5),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ threadId, limit }) => {
    if (
      !(await resolveThreadAccess(getRequestUserEmail(), threadId, "viewer", {
        orgId: getRequestOrgId(),
      }))
    ) {
      fail("Conversation not found.", { statusCode: 404 });
    }
    return { runs: await listRunsForThread(threadId, { limit }) };
  },
});
