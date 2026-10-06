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
