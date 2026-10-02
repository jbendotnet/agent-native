# Durable active-team preference and session mirror

## Problem / Goal

Meet S-01/S-02. Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Application state currently persists by session/key, not user/org.

## Solution

Reuse `settings/user-settings.ts` with an organization-ID-to-team-ID map per user. Use `mutateUserSetting` to preserve selections for other organizations. Do not use org settings, which are shared among users. Session application state remains a mirror and keeps existing semantics.

## Implementation Plan

1. Leader: move child/epic into managed `in-progress/`, update links, and load `execute-plan`, `actions`, `context-awareness`, `security`, `client-methods`, `adding-tests-and-ci`, and `concurrent-agents`.

2. <implementation_tranche id="durable-team-selection" agent="medium">

   1. Add a typed selection reader/writer using existing normalized-user setting helpers. Validate map shape at its boundary; unreadable settings must not look like an empty valid map. Use current request identity/org, never client-supplied user identity.
   2. Add and register `set-active-workspace-team`. Non-null requires marked team in current org and current org/team membership; null explicitly clears this org's choice. Preserve other org entries atomically through `mutateUserSetting`.
   3. Restore selection on session hydration and organization switching. For an invalid stored team, clear this org entry and return explicit no-team state, or reject the operation with a distinguishable error; do not silently carry the previous org's team. Mirror the validated value through existing application-state APIs.
   4. Expose named action/client query and mutation helpers needed by the selector. Keep session state backward-compatible and do not infer a binding for existing threads. Revalidate at actual creation even when selection was validated earlier.
   5. Test two sessions for the same user/org, another user, concurrent different-org changes, org switching, null, ordinary/missing team, membership loss/deletion, malformed durable setting, and failed persistence/mirroring.

   </implementation_tranche>

3. Leader: independent verifier exercises action and hydration paths and checks durable/session values separately before completion.

## Verification

Use `verifying-changes` for Core state/action proof. Run affected user-settings and `application-state/store.spec.ts` suites plus focused selection tests. Recreate a session rather than only reading the same in-memory state. A successful mutation must correspond to persisted selection; mirror failure must be explicit. Selection never substitutes for resource/connection/thread authorization.
