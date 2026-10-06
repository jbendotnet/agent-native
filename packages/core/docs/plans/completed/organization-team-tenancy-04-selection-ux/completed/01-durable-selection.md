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

## Completion and independent proof

Completed 2026-10-03 after independent review and local SQL integration verification.

- Added the normalized-user organization-to-team preference using `mutateUserSetting`, explicit null removal, shape validation, and current organization/team membership checks. Unreadable settings and failed persistence remain errors.
- Registered `get-active-workspace-team` and `set-active-workspace-team`, with named client hooks exported from `@agent-native/core/client/org-team`. Hydration and organization switching restore the validated durable preference and update `active-workspace-team` through the existing application-state store. Thread bindings and creation authorization were not changed.
- Application-state's `session_id` namespace is the authenticated email in the existing HTTP handlers, not a cookie or device ID. The implementation preserves this behavior. Fresh authenticated request events for the same user therefore share that user's mirror namespace; durable settings independently normalize email and store choices per organization.
- The combined focused run passed 9 files and 437 tests, including user-settings, settings, application-state, auth, organization switching, action discovery, and selection tests. After the final production edit, the independent verifier reran the selection and integration suites: 2 files and 8 tests passed. Core typecheck, all 15 changed source/test formatting checks, staged and unstaged diff checks, and the untracked-import guard passed.
- The independent PGlite test reads `settings` and `application_state` SQL rows separately through real action, hydration-handler, and organization-selection seams. It covers fresh request events, two users, organization switching, stale-choice removal, and explicit null. Focused tests also cover malformed settings, membership loss, ordinary/missing teams, concurrent organization writes, and failed persistence/mirroring.
- The verifier found a task-added `no-silent-coercion` guard violation in the absent-organization reader. An explicit missing-entry check replaced the flagged expression, and independent verification confirmed the task violation is gone. The guard still reports three unchanged lines in `client/session-replay.ts` and `scripts/netlify-beta-targets.ts`. The bare-error action guard reports 122 pre-existing throws outside this tranche; neither new action is reported. Action-twin-route and additive-migration guards passed.

Proof boundary: the SQL integration test stubs auth resolution, org-context lookup, and team membership. It does not prove cookie authentication, a routed organization-switch request with SQL-backed membership, independent database connections, or hosted behavior. Those broader integration/release checks are not claimed by this completion record. The sibling management and new-chat UI plans remain unexecuted.

Inspect the independently verified SQL path:

```bash
pnpm --filter @agent-native/core exec vitest run src/workspace-connections/active-team.spec.ts src/workspace-connections/active-team.integration.test.ts
```
