export * from "../org/index.js";

import { useQueryClient } from "@tanstack/react-query";

import { useActionMutation, useActionQuery } from "../hooks/index.js";
import { useDbSync } from "../use-db-sync.js";

export function useActiveWorkspaceTeam() {
  useDbSync({
    queryClient: useQueryClient(),
    // guard:allow-realtime-opt-in — This private chat selector must reflect changes from another session before a new draft.
    realtime: {
      reason:
        "Another session can change the active team before a new chat starts",
    },
  });
  return useActionQuery("get-active-workspace-team", {});
}

export function useSetActiveWorkspaceTeam() {
  return useActionMutation("set-active-workspace-team");
}
