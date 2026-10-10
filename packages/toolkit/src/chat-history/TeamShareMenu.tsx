import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useOrg } from "@agent-native/core/client/org";
import { useState } from "react";

import { DropdownMenuItem } from "../ui/dropdown-menu.js";

type Group = {
  id: string;
  name: string;
  isTeam: boolean;
  memberEmails: string[];
};
type Shares = {
  shares: { principalType: string; principalId: string; role: string }[];
};

export interface TeamShareMenuLabels {
  unavailable: string;
  loading: string;
  failed: string;
  share: (name: string) => string;
  unshare: (name: string) => string;
}

export function TeamShareMenu({
  thread,
  closeMenu,
  labels,
}: {
  thread: { id: string; teamGroupId?: string | null };
  closeMenu: () => void;
  labels: TeamShareMenuLabels;
}) {
  const { data: org } = useOrg();
  const groups = useActionQuery<Group[]>(
    "list-workspace-user-groups",
    {},
    {
      enabled: Boolean(org?.orgId),
    },
  );
  const shares = useActionQuery<Shares>("list-resource-shares", {
    resourceType: "chat_thread",
    resourceId: thread.id,
  });
  const capabilities = useActionQuery<{ canManage: boolean }>(
    "get-chat-thread-capabilities",
    { threadId: thread.id },
    { refetchOnWindowFocus: "always", staleTime: 0 },
  );
  const share = useActionMutation("share-chat-thread-with-team");
  const unshare = useActionMutation("unshare-chat-thread-from-team");
  const [optimistic, setOptimistic] = useState<string | null | undefined>();
  const [error, setError] = useState(false);

  if (!org?.orgId) return null;
  if (groups.isError || shares.isError || capabilities.isError) {
    return <DropdownMenuItem disabled>{labels.unavailable}</DropdownMenuItem>;
  }
  if (
    groups.isPending ||
    shares.isPending ||
    capabilities.isPending ||
    capabilities.isFetching
  ) {
    return <DropdownMenuItem disabled>{labels.loading}</DropdownMenuItem>;
  }
  if (!capabilities.data?.canManage) return null;

  const eligible = (groups.data ?? []).filter(
    (group) =>
      group.isTeam &&
      (!thread.teamGroupId || thread.teamGroupId === group.id) &&
      group.memberEmails.some(
        (email) => email.toLowerCase() === org.email?.toLowerCase(),
      ),
  );
  const current =
    optimistic !== undefined
      ? optimistic
      : (shares.data.shares.find(
          (item) =>
            item.principalType === "group" &&
            item.role === "viewer" &&
            eligible.some((group) => group.id === item.principalId),
        )?.principalId ?? null);
  if (eligible.length === 0) return null;

  return (
    <>
      {error && <DropdownMenuItem disabled>{labels.failed}</DropdownMenuItem>}
      {eligible
        .filter((group) => !current || group.id === current)
        .map((group) => (
          <DropdownMenuItem
            key={group.id}
            disabled={share.isPending || unshare.isPending}
            onSelect={(event) => {
              event.preventDefault();
              const next = current === group.id ? null : group.id;
              setError(false);
              setOptimistic(next);
              void (next ? share : unshare)
                .mutateAsync({ threadId: thread.id, teamGroupId: group.id })
                .then((result) => {
                  setOptimistic(result.shared ? group.id : null);
                  closeMenu();
                })
                .catch(() => {
                  setOptimistic(undefined);
                  setError(true);
                });
            }}
          >
            {current === group.id
              ? labels.unshare(group.name)
              : labels.share(group.name)}
          </DropdownMenuItem>
        ))}
    </>
  );
}
