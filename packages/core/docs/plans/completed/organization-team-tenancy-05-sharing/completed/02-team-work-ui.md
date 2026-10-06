# Explicit sharing controls and team work view

## Problem / Goal

Meet H-03 after [share policy](../completed/01-share-policy-and-list.md). Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md).

## Solution

Extend shared chat/history surfaces with owner sharing controls and one paginated team-shared view. Use existing run read/list helpers. Keep viewer mode read-only and do not treat the team filter as an access grant.

## Implementation Plan

1. Leader: move child/epic to `in-progress/`, repair links, and load `execute-plan`, `frontend-design`, `agent-native-toolkit`, `shadcn-ui`, `client-methods`, `native-navigation`, `internationalization`, and `concurrent-agents`.

2. <implementation_tranche id="team-shared-work-ui" agent="medium">

   1. Locate current shared thread menu/share and history components, including `packages/toolkit/src/chat-history/ChatHistoryRail.tsx`. Compose owner-only team grant/revoke controls with named action hooks; bound threads offer only their binding, unbound threads offer allowed marked teams, and existing non-team share controls remain compatible.
   2. Add a team work view using `list-team-shared-chat-threads` pagination, not the ordinary all-thread or binding query. Render existing thread summary/list geometry and linked-run helpers with bounded loading. Avoid new count strips, repeated page titles, or descriptive chrome.
   3. In viewer mode, disable continuation/edit/manage controls based on authoritative capabilities, retaining normal internal SPA/new-tab navigation. Handle revocation or membership loss by dropping stale visible content after the server denies subsequent requests; never mask mutation failure as saved state.
   4. Add configured copy translations and focused existing component/helper tests. Verify accessible controls, optimistic share rollback, and no-team/empty authorized view without revealing private work.

   </implementation_tranche>

3. <implementation_tranche id="team-work-browser-proof" agent="chrome-devtools">

   1. Independently share one conversation, keep another bound/private, and verify member/lead discovery shows only the first. Open linked runs as viewer and attempt continuation/manage. Verify an admin nonmember cannot read either through this view.
   2. Revoke share/remove member/delete team and attempt reopen/reconnect; confirm denial and unbound owner retention. Close owned tabs/processes and return evidence to the producer.

   </implementation_tranche>

## Verification

Use `verifying-changes` for shared Toolkit runtime/browser proof. Run affected tests/typechecks, oxfmt, and both i18n guards. Invoke matching agent actions as well as controls. A list's absence of a private thread must be backed by direct denial, not only client filtering.

## Execution evidence — 2026-10-06

- Completed H-03 on `review/teams-5611-05-sharing`, based on PR #6 head `0aa0f97e2f9f059d516d32fa77acda8302c67da8`, in the isolated `.tmp/teams-5611-05-sharing` worktree. The primary checkout and existing stacked branches were preserved. The user authorized closing the epic and publishing the follow-on stacked PR on 2026-10-06.
- Toolkit exports the owner team-share menu and capability-gated history controls. Chat consumes these controls and provides paginated explicit-share discovery, bounded linked-run loading, and selected-run navigation. Core actions enforce current thread access and run-to-thread identity. All eleven configured Chat catalogs were updated; Core and Toolkit changesets are included.
- Independent source review passed. Final combined Core proof passed 15 files / 224 tests. Independent Toolkit proof passed 4 files / 45 tests with Node local storage enabled; Chat proof passed 4 files / 27 tests. Core, Toolkit, and Chat typechecks passed. Core and Toolkit builds passed. Both localization guards passed, checking 19 catalog directories and 17 changed-copy surfaces. Final formatting checked 57 source files successfully; diff whitespace checks passed.
- Independent authenticated browser/action/SQL proof passed owner grant/revoke, member/lead explicit-only discovery, private thread/run denial, outside-team admin denial, viewer management and queued-continuation denial, selected-run display, optimistic rollback, empty/no-team states, and unbound owner retention. Revoke, member removal, and team deletion denied subsequent thread/run/reconnect reads and cleared the transcript, selected run, and cached Recents row after mounted queries received the real denial. Owner access and history remained intact after revocation.
- Browser evidence is in the task worktree at `.tmp/h03-browser-proof/report-acceptance.md` and `report-final.md`. Screenshots include `acceptance-viewer-readonly.png`, `acceptance-revoke-main-and-recents-cleared.png`, `acceptance-removal-main-and-recents-cleared.png`, `acceptance-deletion-main-and-recents-cleared.png`, and `acceptance-owner-retained-after-revoke.png`. Independent check logs are under `.tmp/h03-ui-evidence/`, including `final-execution-core.log` and `independent-twofix-{core,toolkit,chat}.log`.

## Resolved execution issues

- Review caught management controls gated on continuation rather than management authority; these now use `canManage`. Browser proof caught a stale-query mount/refetch loop; the access boundary keeps subscribers mounted and controls inert during refresh, then removes denied content.
- Browser proof caught active viewer message-edit controls and a stale Recents title. The shared message component now omits action controls for read-only viewers. Denial revalidates only the affected cached thread, distinguishing denied/missing data from transport failure and retaining accessible owner rows.
- Early browser proof stopped on a DevTools request lookup failure and a temporary module outside Vite's allow-list. Fresh independent runs completed without weakening the serving boundary. An initial final-format process was killed; the sequential retry passed.

## Proof boundaries

- Mounted lifecycle proof used real authenticated query refetches, not response/cache mocks. Automatic polling timing and physical Cmd-click were not measured; actual SPA and run-link navigation were exercised.
- Immediate-turn POST encountered missing-provider configuration before thread authorization. No live immediate-turn or assembled AI-turn claim is made. Queued continuation denial, the existing editor authorization boundary, stored unbound context, and backend fixture coverage are the bounded evidence. No provider credentials or spend were added.
- Owned browser tabs, Chat/Vite, and disposable PostgreSQL were stopped; Dory was untouched. Hosted release and retained-binding integration remain Epic 6 gates. The unchanged `use-chat-threads.ts` coercion guard baseline remains outside this slice.
