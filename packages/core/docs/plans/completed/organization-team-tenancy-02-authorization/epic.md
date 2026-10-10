# Epic 2: Immutable binding and end-to-end chat authorization

Status: Completed on 2026-10-03.

## Problem / Goal

Enforce the [accepted ADR](../../../design/organization-team-tenancy.md) conversation boundary on direct reads, lists, continuation, public tokens, and linked runs. See [requirements](requirements.md).

## Purpose

Teams cannot be exposed safely if their bound owners, cached data, tokens, or background paths bypass current membership checks.

## Scope / Boundaries

Add a nullable creation-time binding and extend existing policy paths, including viewer reads through existing group-share rows. Keep threads private and person-owned. No backfill, rebind, transfer, deletion-blocking FK, separate run share, or live stream revocation. Team-grant mutations and shared-work discovery belong to Epic 5.

## Current Context

Creation and projections persist the immutable nullable binding. Direct and SQL list/search/bulk policy enforce current membership before owner/share authority. Public-token issuance and indexed/legacy redemption reject bound conversations. Linked-run routes, team/harness services, and durable-worker reentry apply fresh conversation policy. Open streams retain connection-scoped authorization.

## Risks / Dependencies / Open Questions

The three children and identity proof gates in [Epic 1](../../completed/organization-team-tenancy-01-identity/epic.md) are implemented and independently verified. All three Epic 2 children pass, allowing [Epic 3](../../wip/organization-team-tenancy-03-context/epic.md) to start. Retained-binding integration proof belongs to Epic 6 before release, after authorization and context exist. Epic 2 proves binding and authorization through internal creation inputs and existing share-row fixtures; it does not implement context loading, selection UI, or future share actions. Until Epic 3 supplies required context, bound prompt execution fails explicitly rather than running without it. Epic 4 exposes user/agent bound creation only after both epics pass.

## Child Plans

1. [Creation binding and unified thread policy](completed/01-binding-and-thread-policy.md) — A-01/A-02.
2. [Public token issuance and redemption](completed/02-public-token-denial.md) — A-03.
3. [Linked runs, streams, and background requests](completed/03-linked-run-authorization.md) — A-04. Implemented and independently verified: 13 focused files, 152 tests; mounted stream/background routes, exported services/controllers, durable worker reentry, and authorization-before-limit regression.

## Success Criteria

Loss of org/team membership denies the next thread or linked-run request even for the owner. Explicit viewers cannot continue/manage. All public bound transcripts/runs are denied. Existing open streams may finish; reconnect/replay must be denied. The complete authorization matrix passes without Epic 3 or later work; authorized bound prompt execution remains unavailable until required context loading is implemented.

## Completion evidence

The combined focused matrix passed **16 files and 209 tests**, covering all A-01–A-04 requirements. Core TypeScript, scoped source formatting, the additive-migration guard, and `git diff --check` passed. Scoped oxlint reported no errors and four `no-base-to-string` warnings in the chat plugin and public handler. The initial PGlite directory-lock collision was resolved by a serialized rerun.

Wrap-up review found and fixed unbound group-share exclusion from SQL list/search/bulk results and prefix matching in exact task-key lookup. Both regressions failed before the fixes. Independent verification of the two affected suites passed 62 tests after the fixes, and the full matrix passed again. Both localization guards passed.

```sh
pnpm --filter @agent-native/core exec vitest run --maxWorkers=1 --no-file-parallelism src/chat-threads/store.spec.ts src/chat-threads/store.access-projection.spec.ts src/application-state/store.spec.ts src/application-state/script-helpers.spec.ts src/agent/run-ownership.spec.ts src/server/agent-chat-stream.spec.ts src/server/agent-chat-plugin.lifecycle.spec.ts src/server/agent-chat-plugin.shared.spec.ts src/server/agent-chat-plugin.thread-history.spec.ts src/server/agent-chat-ai-setup.spec.ts src/server/agent-chat-plugin.run-routes.spec.ts src/server/agent-chat-plugin.worker-access.spec.ts src/server/agent-teams.spec.ts src/server/agent-teams-process-run.spec.ts src/agent/harness/background.access.spec.ts src/server/release-schema-migrations.spec.ts
```

Proof uses focused store/service and mounted H3-route tests, not live PostgreSQL or a deployed environment. Epic 3 context, Epic 4 selection/creation exposure, Epic 5 sharing actions/discovery, and Epic 6 release integration remain separate work.
