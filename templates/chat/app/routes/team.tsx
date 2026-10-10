import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { useActiveWorkspaceTeam } from "@agent-native/core/client/org-team";
import type { ChatThreadSummary } from "@agent-native/toolkit/app/chat/agentkit-chat/rail";
import { useAgentChatRunningThreads } from "@agent-native/toolkit/app/chat/agentkit-chat/rail";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Team — ${APP_TITLE}` }];
}

export default function TeamRoute() {
  const t = useT();
  const { data: org, isPending: orgPending, isError: orgError } = useOrg();
  const activeTeam = useActiveWorkspaceTeam();
  const groups = useActionQuery<
    { id: string; name: string; isTeam: boolean; memberEmails: string[] }[]
  >("list-workspace-user-groups", {}, { enabled: Boolean(org?.orgId) });
  const [chosen, setChosen] = useState<string | null>(null);
  const teams = (groups.data ?? []).filter(
    (group) =>
      group.isTeam &&
      group.memberEmails.some(
        (email) => email.toLowerCase() === org?.email?.toLowerCase(),
      ),
  );
  const teamId = teams.some((team) => team.id === chosen)
    ? chosen
    : (teams.find((team) => team.id === activeTeam.data?.teamGroupId)?.id ??
      teams[0]?.id ??
      null);

  if (orgError || groups.isError || activeTeam.isError) {
    return <p role="alert">{t("chat.teamWorkUnavailable")}</p>;
  }
  if (orgPending) {
    return (
      <div className="p-4">
        <Skeleton className="h-9 w-48" />
      </div>
    );
  }
  if (!org?.orgId) return <p className="p-4">{t("chat.noTeams")}</p>;
  if (groups.isPending || activeTeam.isPending) {
    return (
      <div className="p-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-4 h-14 w-full" />
      </div>
    );
  }
  if (!teamId) return <p className="p-4">{t("chat.noTeams")}</p>;

  return (
    <div className="mx-auto max-w-2xl p-4">
      <Select value={teamId} onValueChange={setChosen}>
        <SelectTrigger aria-label={t("chat.teamWork")} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {teams.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {team.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <SharedTeamThreads key={teamId} teamGroupId={teamId} />
    </div>
  );
}

function SharedTeamThreads({ teamGroupId }: { teamGroupId: string }) {
  const t = useT();
  const { workingThreadIds } = useAgentChatRunningThreads();
  const [offset, setOffset] = useState(0);
  const [pages, setPages] = useState<ChatThreadSummary[]>([]);
  const list = useActionQuery<{
    threads: ChatThreadSummary[];
    nextOffset: number | null;
  }>("list-team-shared-chat-threads", { teamGroupId, limit: 25, offset });
  useEffect(() => {
    const reset = () => {
      setPages([]);
      setOffset(0);
    };
    window.addEventListener("focus", reset);
    return () => window.removeEventListener("focus", reset);
  }, []);
  // Do not retain old pages after a denied refresh, even if React Query has stale data.
  if (list.isError) return <p role="alert">{t("chat.teamWorkUnavailable")}</p>;
  if (list.isPending || list.isFetching)
    return <Skeleton className="mt-4 h-14 w-full" />;
  const threads =
    offset === 0 ? list.data.threads : [...pages, ...list.data.threads];

  return (
    <div className="mt-4" aria-label={t("chat.teamWork")}>
      {threads.length === 0 ? (
        <p>{t("chat.noSharedChats")}</p>
      ) : (
        <ul className="an-chat-history__list">
          {threads.map((thread) => (
            <li key={thread.id} className="an-chat-history-row">
              <Link
                to={`/chat/${encodeURIComponent(thread.id)}`}
                className="an-chat-history-row__button block"
              >
                <span className="an-chat-history-row__title">
                  {thread.title || t("chat.untitledChat")}
                </span>
                {workingThreadIds.has(thread.id) && (
                  <span
                    className="an-chat-history-row__timestamp"
                    role="status"
                  >
                    {t(
                      // i18n-key-ignore shared framework catalog
                      "agentChat.status.working",
                    )}
                  </span>
                )}
                {thread.preview && thread.preview !== thread.title && (
                  <span className="an-chat-history-row__subtitle block">
                    {thread.preview}
                  </span>
                )}
              </Link>
              <LinkedRuns threadId={thread.id} />
            </li>
          ))}
        </ul>
      )}
      {list.data.nextOffset !== null && (
        <Button
          type="button"
          variant="ghost"
          disabled={list.isFetching}
          onClick={() => {
            setPages(threads);
            setOffset(list.data.nextOffset!);
          }}
        >
          {t("chat.moreSharedChats")}
        </Button>
      )}
    </div>
  );
}

function LinkedRuns({ threadId }: { threadId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const query = useActionQuery<{
    runs: { id: string; startedAt: number }[];
  }>(
    "list-chat-thread-runs",
    { threadId, limit: 5 },
    {
      enabled: open,
      staleTime: 0,
      refetchOnWindowFocus: "always",
    },
  );
  return (
    <div className="ps-3 pb-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t("chat.linkedRuns")}
      </Button>
      {open && (
        <div className="ps-3 text-xs">
          {query.isError ? (
            <span role="alert">{t("chat.linkedRunsUnavailable")}</span>
          ) : query.isPending || query.isFetching ? (
            <Skeleton className="h-6 w-28" />
          ) : query.data.runs.length === 0 ? (
            <span>{t("chat.noLinkedRuns")}</span>
          ) : (
            <ul>
              {query.data.runs.map((run) => (
                <li key={run.id}>
                  <Link
                    className="rounded px-2 py-1 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    to={`/chat/${encodeURIComponent(threadId)}?runId=${encodeURIComponent(run.id)}`}
                  >
                    {t("chat.linkedRun")} {run.id} ·{" "}
                    {new Date(run.startedAt).toLocaleString()}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
