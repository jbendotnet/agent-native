import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  assertWorkspaceUserGroupManager,
  deleteWorkspaceUserGroup,
} from "../groups.js";

export default defineAction({
  description:
    "Delete a workspace user group or team, removing its connection allow-list references first. Only workspace owners and admins can delete groups.",
  schema: z.object({
    id: z.string().min(1).describe("User group ID to delete."),
  }),
  run: async ({ id }, ctx) => {
    await assertWorkspaceUserGroupManager(ctx?.orgId, ctx?.userEmail);
    const orgId = ctx?.orgId ?? "";
    const deleted = await deleteWorkspaceUserGroup(id, orgId);
    if (!deleted) throw new Error(`User group "${id}" was not found.`);
    return { id, deleted };
  },
});
