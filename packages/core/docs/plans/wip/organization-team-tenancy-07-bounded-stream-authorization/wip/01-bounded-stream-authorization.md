# Framework-wide bounded stream authorization

## Problem / Goal

Meet S-01–S-04 on top of the completed six-PR stack. Read [epic](../epic.md), [requirements](../requirements.md), [ADR amendment](https://github.com/jbendotnet/agent-native/blob/ea1df2b21d94f49441649d9c520b155a72feb2f8/packages/core/docs/design/organization-team-tenancy.md#proposed-stream-policy-amendment-2026-10-10), and [lease contract](https://github.com/jbendotnet/agent-native/blob/ea1df2b21d94f49441649d9c520b155a72feb2f8/packages/core/docs/design/durable-agent-runs.md#bounded-viewer-authorization-leases). Reuse the existing thread and linked-run policy rather than reopening their completed epics.

Current streams authorize only at opening and can deliver indefinitely after access loss. The target bounds new application-controlled writes on every authorized run subscription. The proposed 10-second lease and 5-second renewal interval require policy approval. This plan does not implement or approve them.

## Scope / Boundaries

Own the shared lease lifecycle, complete fresh authorization decision, final delivery gate, and client closure contract. Cover live, SQL-polled, replayed, and buffered events and keepalives. Preserve applicable non-team, standalone, and public-access rights. Missing conversation-linked targets deny access. Do not require a conversation for genuinely standalone runs.

Close the viewer subscription, not the producing run. No team-only transport branch, new run-share model, distributed invalidation channel, or timing configuration framework. Identity validity and a common final writer are required outcomes, not verified existing capabilities.

## Implementation Plan

1. Leader: obtain approval of the amendment, timing, exposure window, and fail-closed behavior before runtime acceptance. Record the decision in both design documents. Keep implementation and release status separate from approval.
2. Leader: on execution, move child/epic to `in-progress/` and repair links. Load `execute-plan`, `security`, `performance`, `content-product-development`, `adding-tests-and-ci`, and `concurrent-agents`.

3. <implementation_tranche id="bounded-viewer-lease" agent="medium">

   1. Trace stream opening, replay, live subscriptions, SQL polling, buffering, and client reconnect/closure in the final stack's source. Inventory every run access policy and its identity/session or credential checks. Integrate the completed thread and linked-run policy. Preserve standalone and supported public policy rather than inventing access.
   2. Establish one fresh, coherent authoritative decision for the original viewer. Distinguish approval, denial, backend failure, and timeout. Reject stale caches, replicas, and snapshots that predate check start. Measure the complete query cost at representative subscription counts.
   3. Implement OPENING, ACTIVE, and terminal CLOSED states from the shared contract. Capture monotonic deadlines before reads. Allow one check in flight. Accept renewal only before both current and candidate deadlines. Denial/error closes immediately. Timeout or delayed timers never extends a lease. Ignore late results after closure.
   4. Establish one synchronous final application-controlled writer gate. Cover replay, polling, live events, keepalives, and buffers during draining. Do not await between the gate and transport handoff. Discard unsent buffers and release owned subscription resources on closure.
   5. Preserve producer execution and status on viewer closure. Make client handling distinguish subscription denial/failure from run completion. Authorize reconnect before replay. Do not substitute forced periodic reconnect without a separate decision and continuity proof.
   6. Add focused runnable proof beside existing stream and policy tests. Cover successful renewal, each revocation class, applicable identity revocation, and retained alternative access. Include slow pre-commit approval, expired late approval, error/timeout, delayed timers, replay, SQL polling, backpressure, and reconnect. Prove no new final writes beyond the approved bound and continued producer operation.

   </implementation_tranche>

4. Leader: obtain independent runtime verification from a different agent against the integrated final stack. Record the approved constants, commands/results, delivery-path matrix, compatibility cases, and authorization cost. Return failures to implementation before accepting S-01–S-04. Record runtime and compatibility evidence for S-05.

## Verification

Use focused Core stream, ownership, and lifecycle specs identified from the actual changed exports. Use `verifying-changes` for real subscription proof. Callback or enqueue assertions alone do not prove the final-write bound. Bytes already handed to transport are outside that guarantee. A timing approval, static check, or reconnect-only test is not runtime completion. Epic 7 owns the new integrated proof and amended release readiness. Preserve Epics 2 and 6 as completed baseline records.
