# Bound public-token issuance and redemption denial

## Problem / Goal

Meet A-03 after [thread policy](01-binding-and-thread-policy.md). Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Generic `allowPublic` registration is not the bearer-token policy.

## Solution

Guard token store issuance and every redemption path using persisted binding. Deny before public transcript or linked runs are returned, including tokens issued before a binding exists. Leave eligible unbound behavior intact.

## Implementation Plan

1. Leader: move child/epic to `in-progress/`, repair links, and load `execute-plan`, `security`, `sharing`, `adding-tests-and-ci`, and `concurrent-agents`.

2. <implementation_tranche id="bound-token-policy" agent="medium">

   1. Add bound-thread rejection in `createThreadShareLink` and indexed/legacy branches of `getThreadByShareToken` in `chat-threads/store.ts`. Do not trust token possession, current selection, or group existence to decide binding: a deleted team still leaves a non-null binding.
   2. Apply the rule to the plugin `/threads/:id/share` route and `server/agent-chat/shared-thread.ts` public handler. Preserve normal token validation/revocation and deny before transcript/run enrichment. Ensure token metadata cannot reopen the thread via another public serialization path.
   3. Test bound issue denial, existing hashed token after test-controlled binding, indexed and legacy lookup, membership loss, team deletion, and missing conversation. Seed existing viewer group-share rows on unbound conversations to prove public behavior remains unchanged now. Epic 5 repeats this proof through its new share actions; those actions are not a prerequisite for this child.

   </implementation_tranche>

3. Leader: independent verifier calls public redemption with no session and inspects the response for absence of both transcript and linked runs.

## Verification

Run `src/chat-threads/store.spec.ts` and `src/server/agent-chat-plugin.shared.spec.ts` with Core Vitest plus targeted store cases. Test direct helper callers as well as HTTP routes. No successful public response may expose a bound thread even if a legacy token exists or the binding references a deleted team. No production rebinding or migration is introduced to create the test scenario.

## Execution Record

Completed on 2026-10-03. Independent review approved the `bound-token-policy` tranche.

- Store issuance and the common indexed/legacy redemption validator reject persisted non-null team bindings. Legacy denial does not backfill token metadata.
- The plugin share route denies bound-thread GET/POST while preserving authorized DELETE revocation. The public handler denies before transcript serialization and linked-run enrichment.
- Regression coverage includes pre-existing tokens after test-controlled binding, membership loss, retained binding after simulated team deletion, missing conversations, and unchanged unbound public-link behavior with an existing viewer group share.
- Independent verification ran `pnpm --filter @agent-native/core exec vitest run src/chat-threads/store.spec.ts src/server/agent-chat-plugin.shared.spec.ts src/chat-threads/store.access-projection.spec.ts src/server/agent-chat-plugin.thread-history.spec.ts`: 4 files and 92 tests passed. No-session indexed/legacy public-handler requests returned 404 with no transcript or run content and no run lookup. Separate JSON/HTML cases also denied before enrichment.
- The implementer recorded four failing-before regression assertions, then passing targeted tests, Core TypeScript checking, source formatting, and `git diff --check`. Added `.changeset/deny-bound-chat-public-tokens.md`.
- Proof boundary: the HTTP-handler checks use H3 events and mocked SQL, not a live database or deployed server. Retained-binding integration remains the Epic 6 release gate.
- Execution issue resolved: the initial automatic acceptance check invoked generic `npm test` and timed out. Acceptance was rerun with the explicit targeted Core command and independently passed. No scope or technical-direction deviation was required.

This child's targeted proof is included in the full [Epic 2 completion matrix](../epic.md#completion-evidence).
