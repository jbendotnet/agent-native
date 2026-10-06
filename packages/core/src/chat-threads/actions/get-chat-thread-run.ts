import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getRunById } from "../../agent/run-store.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { resolveThreadAccess } from "../store.js";

export default defineAction({
  description:
    "Read a linked run on a conversation the current member may view.",
  schema: z.strictObject({
    threadId: z.string().min(1),
    runId: z.string().min(1),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ threadId, runId }) => {
    if (
      !(await resolveThreadAccess(getRequestUserEmail(), threadId, "viewer", {
        orgId: getRequestOrgId(),
      }))
    )
      fail("Run not found.", { statusCode: 404 });
    const run = await getRunById(runId);
    if (!run || run.threadId !== threadId)
      fail("Run not found.", { statusCode: 404 });
    return { run };
  },
});
