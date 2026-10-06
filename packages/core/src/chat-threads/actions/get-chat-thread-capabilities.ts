import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { resolveThreadAccess } from "../store.js";

export default defineAction({
  description:
    "Check the current user's read, continuation, and owner permissions on a conversation. Revalidates its organization, bound team, and sharing policy.",
  schema: z.strictObject({ threadId: z.string().min(1) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ threadId }) => {
    const email = getRequestUserEmail();
    const orgId = getRequestOrgId();
    const thread = await resolveThreadAccess(email, threadId, "viewer", {
      orgId,
    });
    if (!thread) fail("Conversation not found.", { statusCode: 404 });
    const canManage = thread.ownerEmail.toLowerCase() === email?.toLowerCase();
    const canContinue =
      canManage ||
      Boolean(await resolveThreadAccess(email, threadId, "editor", { orgId }));
    return { threadId, canRead: true, canContinue, canManage };
  },
});
