# Epic 2: Immutable binding and end-to-end chat authorization

## Problem / Goal

Enforce the [accepted ADR](../../../design/organization-team-tenancy.md) conversation boundary on direct reads, lists, continuation, public tokens, and linked runs. See [requirements](requirements.md).

## Purpose

Teams cannot be exposed safely if their bound owners, cached data, tokens, or background paths bypass current membership checks.

## Scope / Boundaries

Add a nullable creation-time binding and extend existing policy paths, including viewer reads through existing group-share rows. Keep threads private and person-owned. No backfill, rebind, transfer, deletion-blocking FK, separate run share, or live stream revocation. Team-grant mutations and shared-work discovery belong to Epic 5.

## Current Context

`chat-threads/store.ts` has separate direct generic access and SQL list/search predicates. Its private creation and projections lack binding. Token redemption has indexed and legacy paths. `agent/run-ownership.ts` resolves linked threads; normal event streams authorize on opening. Background team/harness lists currently apply task/session owner scope, not fresh linked-chat policy.

## Risks / Dependencies / Open Questions

Start only after all children and identity proof gates in [Epic 1](../../in-progress/organization-team-tenancy-01-identity/epic.md) pass. Its three children are implemented and independently verified; retained-binding integration proof belongs to Epic 6 before release, after authorization and context exist. Complete all three Epic 2 children before [Epic 3](../organization-team-tenancy-03-context/epic.md) starts. Epic 2 proves binding and authorization through internal creation inputs and existing share-row fixtures; it does not depend on context loading, selection UI, or future share actions. Until Epic 3 supplies required context, bound prompt execution must fail explicitly rather than run without it. Epic 4 exposes user/agent bound creation only after both epics pass. Inventory located background routes, but exact durable-worker call-site names must be rechecked against current source during execution.

## Child Plans

1. [Creation binding and unified thread policy](wip/01-binding-and-thread-policy.md) — A-01/A-02.
2. [Public token issuance and redemption](wip/02-public-token-denial.md) — A-03.
3. [Linked runs, streams, and background requests](wip/03-linked-run-authorization.md) — A-04.

## Success Criteria

Loss of org/team membership denies the next thread or linked-run request even for the owner. Explicit viewers cannot continue/manage. All public bound transcripts/runs are denied. Existing open streams may finish; reconnect/replay must be denied. The complete authorization matrix passes without Epic 3 or later work; authorized bound prompt execution remains unavailable until required context loading is implemented.
