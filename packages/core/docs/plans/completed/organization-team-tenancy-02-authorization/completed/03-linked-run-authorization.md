# Linked-run access across streams and background paths

## Problem / Goal

Meet A-04 after [thread policy](01-binding-and-thread-policy.md) and [public denial](02-public-token-denial.md). Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Background owner scoping is not conversation authorization.

## Solution

Use the existing run-to-thread lookup and current thread read policy for every fresh request. Team tasks and harness sessions already carry thread IDs. Preserve connection-scoped stream authorization and fail closed for missing links.

## Implementation Plan

1. Leader: move child/epic to `in-progress/`, repair links, and load `execute-plan`, `security`, `harness-agents`, `performance`, `content-product-development`, `adding-tests-and-ci`, and `concurrent-agents`.

2. <implementation_tranche id="linked-run-policy" agent="medium">

   1. Trace current `resolveRunThreadId`, `callerHasThreadAccess`, `callerHasRunAccess`, and owner-only mutation helpers in `agent/run-ownership.ts`. Reuse the binding-aware thread policy, denying unresolved/missing conversations. Keep read permission distinct from continuation/control authority.
   2. Audit plugin `/runs` direct detail, latest, active, list, events with `after`, and background-events branches. Resolve the task/session's linked thread and revalidate on each new request, including replay/reconnect. Preserve established nondisclosure response contracts where needed, but never return protected data or report a failed mutation as success.
   3. Extend `server/agent-teams.ts` list/get/transcript exports and `agent/harness/background.ts` list/get/transcript/controller methods, not just route wrappers. Include current `orgId` when restoring request context; owner-email task/session scope alone is insufficient. Filter authorized lists with bounded/projected checks, without hydrating every transcript or creating N+1 request waterfalls.
   4. Trace durable background dispatch/response reentry in `server/agent-chat-plugin.ts` against actual current source. Restore caller/org identity and validate the existing thread before loading context, serving cached responses, or responding to a new background request. Do not create a new automation identity or assume reentry into the same handler proves authorization.
   5. Add a route/service/controller proof table covering direct/latest/active/list, event open, replay/reconnect, background transcript/list/response, cached result, and missing thread. Use internal bound-thread creation, existing linked-run fixtures, and seeded viewer group-share rows; do not depend on later context execution, selection UI, or share actions. Remove org/team membership, revoke a fixture share, and delete team between requests. Keep an already-open stream running, then deny its reconnect. Prove new bound background execution is explicitly rejected until Epic 3 supplies context, separately from read authorization.

   </implementation_tranche>

3. Leader: independent verifier executes the entire path table and records route/service evidence before completion.

## Verification

Run affected Core `src/agent/run-ownership.spec.ts`, `src/server/agent-chat-stream.spec.ts`, plugin lifecycle/shared specs, and existing agent-team/harness background specs identified by the changed exports. Use `verifying-changes` for actual subscription and background request proof. A cached completed run is still protected. A run with no linked conversation is denied. No continuous team-only polling or forced termination of an open stream is added.

## Execution evidence

Implemented and independently verified on the current branch. The verifier inspected source and executed the complete focused suite separately from the implementation agent. No deployed or live-PostgreSQL verification is claimed.

| Path                                               | Regression evidence                                                                                                                                  | Result                                                                                                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linked read and owner-only control                 | `agent/run-ownership.spec.ts`; `server/agent-teams.spec.ts`; `agent/harness/background.access.spec.ts`                                               | Shared viewers can read, but cannot follow up, stop, or approve. Missing conversations deny.                                                                                            |
| Direct events, latest, active, list                | `server/agent-chat-plugin.run-routes.spec.ts`: “rechecks a bound run for each request, but lets an open stream complete”                             | Mounted HTTP requests use real linked-thread policy and team/harness services. Fresh requests deny after access loss.                                                                   |
| Replay, reconnect, established stream              | Same mounted-route test                                                                                                                              | New `after=0` and `after=1` requests deny after share revocation. The previously opened stream receives its post-revocation event and finishes.                                         |
| Background transcript, list, cached text           | Mounted-route test; team and harness service/controller tests                                                                                        | Team cached `latestText` and a distinct harness run's persisted transcript are readable while authorized and inaccessible after revocation.                                             |
| Org/team removal, share revocation, team deletion  | Mounted routes, team/harness access tests, worker access tests                                                                                       | Checks apply to subsequent requests, including the owner.                                                                                                                               |
| Durable response and completed-run acknowledgement | `server/agent-chat-plugin.worker-access.spec.ts`: “rechecks an unbound completed run before returning its cached worker result”                      | Registered worker returns its actual completed-run acknowledgement while authorized, then 404 before payload access after thread deletion. This endpoint does not return response text. |
| Bound execution without context                    | Worker access test: “denies revoked or missing linked conversations before loading persisted dispatch payload”; `server/agent-chat-ai-setup.spec.ts` | Available persisted bound payload returns HTTP 403 with `Team-bound chat execution requires team context support`. Revoked or missing conversation returns 404 before payload reads.    |
| Bounded task candidates                            | `application-state/store.spec.ts`: “limits after current-org and full thread access, not same-session other-org or inaccessible shares”              | The shared thread SQL policy and current org apply before the limit. 201 same-session other-org tasks and 201 inaccessible shared tasks do not displace eligible owner/viewer tasks.    |

Final independent command, run from the repository root:

```sh
pnpm --filter @agent-native/core exec vitest run --maxWorkers=1 --no-file-parallelism src/application-state/store.spec.ts src/application-state/script-helpers.spec.ts src/agent/run-ownership.spec.ts src/server/agent-chat-stream.spec.ts src/server/agent-chat-plugin.lifecycle.spec.ts src/server/agent-chat-plugin.shared.spec.ts src/server/agent-chat-plugin.thread-history.spec.ts src/server/agent-chat-ai-setup.spec.ts src/server/agent-chat-plugin.run-routes.spec.ts src/server/agent-chat-plugin.worker-access.spec.ts src/server/agent-teams.spec.ts src/server/agent-teams-process-run.spec.ts src/agent/harness/background.access.spec.ts
```

Result: **13 files passed, 152 tests passed**. Core `pnpm --filter @agent-native/core exec tsc --noEmit` and scoped `oxfmt --check` passed. Scoped oxlint exited without errors; three existing `no-base-to-string` warnings remain in `agent-chat-plugin.ts`. The package release entry is `.changeset/authorize-linked-agent-runs.md`.

### Execution issues and boundaries

- The raw H3 test mock did not reproduce framework prefix mounting. Corrected the harness, not production route matching.
- Independent review caught a colliding harness/task fixture ID, a global and then cross-org candidate ceiling, and loss of the worker's typed context error. All were repaired and verified before completion.
- Concurrent test runs intermittently collided on a PGlite directory lock. The final independent serialized 13-file run passed together.
- Task lists fail explicitly above 200 authorized candidates rather than returning a silently truncated list. Pagination is needed if that supported bound must grow.
- Bound execution intentionally remains unavailable until Epic 3 supplies context. This child's proof is included in the full [Epic 2 completion matrix](../epic.md#completion-evidence).
