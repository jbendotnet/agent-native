# Explicit sharing controls and team work view

## Problem / Goal

Meet H-03 after [share policy](01-share-policy-and-list.md). Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md).

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
