# Owner-only team viewer grants and paginated discovery

## Problem / Goal

Meet H-01/H-02 after all Epics 1–4 children and proof gates pass. Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Generic admin sharing cannot be exposed unchanged for chat team grants.

## Solution

Put chat-specific grant policy at the shared action/store boundary and reuse existing share rows. Reuse Epic 2's completed direct and list read policy. Serialize mutations per thread so two requests cannot create two different team grants.

## Implementation Plan

1. Leader: move child/epic into `in-progress/`, update links, and load `execute-plan`, `actions`, `sharing`, `security`, `performance`, `audit-log`, `adding-tests-and-ci`, and `concurrent-agents`.

2. <implementation_tranche id="chat-team-sharing" agent="medium">

   1. Add/register the two ADR actions. Load authoritative thread owner/org/binding and validate current owner org/team membership and marked target team. Revoke uses the same owner/current target-membership contract; do not substitute resource-admin permission.
   2. Reuse `chat_thread_shares` with group principal and viewer role. Under the existing transaction/locking primitives, reject a second team recipient while preserving non-team shares. Permit idempotent same-target viewer operations only when current policy still passes. Bound targets must equal stored binding.
   3. Inspect `sharing/actions/share-resource.ts`, revoke/manage-share siblings, and chat registration. Route every chat team-grant mutation through the chat policy or explicitly reject it on generic paths. Reject commenter/editor/admin grants and generic admin-only callers; do not weaken policy to reuse a broad helper.
   4. Reuse the completed `resolveThreadAccess` and `chatThreadAccessSql` group-share read evaluation from Epic 2. Add `list-team-shared-chat-threads` with bounded pagination, deterministic ordering, summary projection, and explicit team-grant filtering under the same policy. Private bound threads must not enter this query.
   5. Invalidate/revalidate caches on grant/revoke and membership changes. Test wrong org/team, ordinary group, departed owner/viewer, owner departure with remaining shared viewers, concurrent recipients, non-team shares, generic bypass, and deletion. Linked runs continue using Epic 2, with no run-share table. Repeat Epic 2's fixture-based viewer and unbound public-link checks through the new share actions.

   </implementation_tranche>

3. Leader: independent verifier invokes every grant/revoke entry point and checks list/direct/run parity before completion.

## Verification

Run Core chat store/access-projection, `sharing/access.spec.ts`, `sharing/restricted-sharing.spec.ts`, and run ownership/plugin tests. Prove viewer-only authority by attempting continuation/management. Verify unbound shares keep org/personal prompt and public behavior; bound private work stays excluded. For supported other resource families test group grants remain additive, not restrictive; reject invalid new grants and unknown types.

## Execution evidence

H-01/H-02 passed independent local review and verification on 2026-10-06 in the task worktree based on PR #6 head `0aa0f97e2f9f059d516d32fa77acda8302c67da8`. Named grant/revoke, generic bypass rejection, explicit paginated discovery, direct/run access, and owner/member lifecycle checks are implemented.

Independent verification passed the exact 12-file Core matrix (215 tests), Core typecheck and build. Three separate-connection PostgreSQL contention tests passed. Saved PostgreSQL logs show distinct backend PIDs and actual lock waits. Evidence directory: `/var/folders/ng/prqsg7g160q_dq8b3x08qyyh0000gp/T/opencode/teams-review-gate.MbmX4x/`, including `focused-matrix-independent-final.log`, `typecheck-independent-final.log`, `postgres-vitest.log`, and `postgres.log`.

Review found a generic grant/revoke versus group-conversion race. The shared mutation boundary now locks group then thread and rechecks policy inside the transaction; independent review confirmed the repaired ordering. Combined tests exposed incomplete membership fixtures, harness cleanup before a saved session, and reused worker-slot database paths. Minimal fixture and per-process database isolation repairs passed parallel, serial, repeat, and independent matrix runs. The group suite is `workspace-connections/store.spec.ts`, not `groups.spec.ts`.

Unchanged Assets locale-baseline and `use-chat-threads.ts` coercion guard failures remain baseline issues, not passing checks. This evidence does not claim hosted behavior or Epic 6 retained-binding release acceptance.
