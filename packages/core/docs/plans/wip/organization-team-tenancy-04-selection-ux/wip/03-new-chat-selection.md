# New-chat team selection and stable binding display

## Problem / Goal

Meet S-03 after durable selection, Epic 3 full security, and Epic 2 bound prompts. Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Core `useChatThreads.createThread` initially creates only a local draft.

## Solution

Connect durable selection to explicit new-chat creation metadata, then server validation/persistence on the first actual insertion. Display the existing conversation's stored binding separately from the user's preference. Do not modify old bindings when the selector changes.

## Implementation Plan

1. Leader: move child/epic to `in-progress/`, update links, and load `execute-plan`, `frontend-design`, `agent-native-toolkit`, `client-methods`, `context-awareness`, `internationalization`, and `concurrent-agents`.

2. <implementation_tranche id="new-chat-team-binding" agent="medium">

   1. Trace every new-draft caller in `packages/toolkit/src/app/chat/MultiTabAssistantChat.tsx`, the Core `client/use-chat-threads.ts` auto/routed draft paths, and the first-turn plugin insertion. Carry explicit creation metadata through existing named client/composer methods; do not add a raw route wrapper.
   2. Add a compact no-team/team selector backed by S-01/S-02. A new draft captures its creation choice; changing the preference affects subsequent new conversations, not an already-created draft's explicit choice or a persisted binding. Server insertion validates current membership again and returns the authoritative binding.
   3. Hydrate binding in thread summaries/history and show it when viewing an existing conversation. Keep selector preference distinct from that display. Reject inaccessible creation/continuation with recoverable UI feedback; never retry by silently dropping binding or using another team.
   4. Use shared composer/navigation primitives and configured translations. Test local drafts, route-driven new chats, first send, reopen, selection change, organization change, membership loss between draft and first send, and legacy null bindings.

   </implementation_tranche>

3. <implementation_tranche id="selection-browser-proof" agent="chrome-devtools">

   1. Independently use two sessions to verify durable preference and per-org restoration. Create under A, select B, and prove subsequent A turns still use A context while a new conversation uses B. Test no-team and membership removal before first send.
   2. Verify agent action changes mirror in the current UI, inspect persisted binding rather than only selector text, and close owned resources.

   </implementation_tranche>

## Verification

Run affected Core client/plugin and Toolkit tests/typechecks, then browser proof through `verifying-changes`. Run both i18n guards. Verify no successful fallback after a forged/deleted team creation input. Existing unbound conversations must never acquire a binding from current selection, including reopen/history flows.
