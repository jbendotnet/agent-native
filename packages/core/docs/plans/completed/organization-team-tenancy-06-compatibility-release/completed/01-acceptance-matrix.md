# Integrated actor, revocation, and compatibility proof

## Problem / Goal

Meet R-01/R-02 after Epics 1–5. Read [epic](../epic.md), [requirements](../requirements.md), all five epic requirements, and [ADR](../../../../design/organization-team-tenancy.md).

## Solution

Consolidate focused tests into an explicit acceptance matrix rather than introduce a new test framework. Reuse PostgreSQL fixtures and route/service tests. Keep proof independent from implementation, with failures routed back to the owning child.

## Implementation Plan

1. Leader: move child/epic to `in-progress/`, repair links, and load `execute-plan`, `verifying-changes`, `adding-tests-and-ci`, `content-product-development`, and `concurrent-agents`.

2. <implementation_tranche id="tenancy-proof-matrix" agent="medium">

   1. Inventory existing cases from earlier children. Add only missing runnable coverage beside the relevant Core/Toolkit code; do not duplicate successful tests or create a broad new harness.
   2. Cover org owner/admin member and nonmember, lead, ordinary member, recorded owner, explicit viewer, outsider, departed org/team member. For each relevant actor test initial access, membership removal, rejoin, share revocation, and deletion. Validate private bound and explicit-share cases separately.
   3. Cover all thread direct/list/search/bulk/cache/continue/manage paths, prompt turns and failed team lookup, token issuance/indexed/legacy public redemption, normal run reads/lists/events/replay/reconnect, team/harness background service/controller paths, and durable response reentry. Assert existing open streams may finish but new connections deny.
   4. Seed legacy ordinary groups, null-bound threads, resource grants, connection allow-lists, and old tokens. Run additive migrations and conversion/deletion; compare preserved IDs/data and access. Validate fresh IDs and no old-thread binding inference, including unbound owner access after a shared team's deletion.
   5. Record a compact evidence table beside the epic mapping each ADR criterion to test/case and command/result. Label any runtime/browser evidence separately; do not infer proof from test filenames.

   </implementation_tranche>

3. <implementation_tranche id="independent-tenancy-proof" agent="medium">

   1. A different agent than the producer reruns the matrix, checks assertions and fault injection, and reports pass/fail for every ADR criterion. Browser-only evidence is independently gathered by `chrome-devtools` through `verifying-changes`.
   2. Return failures to the original owning implementation child, then rerun affected proof. Leader accepts only a complete matrix with no silent skipped authorization paths.

   </implementation_tranche>

## Verification

Use focused Core `pnpm --dir packages/core exec vitest --run <affected specs>` and affected Toolkit test commands confirmed from current package scripts. Run `pnpm typecheck`, `pnpm test:fast`, and applicable `pnpm guards` after focused proof. Exit 2/skipped guards are not passes. No source or runtime behavior is considered complete until its relevant matrix row passes.

## Execution record at child 1 completion

This record predates child 2 and the user's declaration that the whole epic is
complete. See the [epic](../epic.md) for the final lifecycle status.

See [acceptance evidence](../acceptance-evidence.md) for the ten-row assertion
matrix, exact commands, independent results, and proof boundaries.

- `tenancy-proof-matrix`: local coverage complete. Added missing integrated
  legacy conversion/deletion and unsupported-family assertions, plus the
  organization-member fixture ID needed by a background access test.
- `independent-tenancy-proof`: all ten ADR rows and R-01/R-02 pass local proof:
  20 Core files / 355 tests and 2 Toolkit files / 5 tests. Workspace typecheck,
  changed-test formatting, and diff checks pass.
- Required-check recovery is complete under `nvm` Node 24.14.0. The final
  complete `pnpm test:fast`, workspace typecheck, all 85 child-base guards,
  source formatting, and diff checks pass. Dedicated title-ranking performance
  checks retain their original 50 ms limits and pass explicitly.
- Independent recovery review covers the Core classification, Toolkit import
  and eject boundaries, legacy public imports, and test/setup corrections.
  Required runtime changes have a patch changeset. Earlier failed attempts and
  the separate unverified Content DB-suite boundary remain recorded in the
  evidence page, not counted as passes.
- Child 1 is complete. Epic 6 stays in progress with child 2 still WIP.
- No child 2, shipping, deployment, or new browser proof is included.
