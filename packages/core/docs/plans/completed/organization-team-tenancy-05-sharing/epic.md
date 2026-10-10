# Epic 5: Explicit team sharing and shared-work view

## Problem / Goal

Give current team members a central view of explicitly shared conversations and linked runs without opening private team-bound work. Follow the [accepted ADR](../../../design/organization-team-tenancy.md) and [requirements](requirements.md).

## Scope / Boundaries

Reuse `chat_thread_shares` group viewer rows. Only the recorded owner grants/revokes; at most one team recipient. No automatic share, successor, cross-team bound share, or separate run grants.

## Current Context

Generic `share-resource` permits broader roles and resource-admin authority. Chat SQL lists currently lack group grants. Shared UI must consume a paginated explicit-share action, not list every bound thread.

## Dependencies / Risks

Start only after all children and proof gates in Epics 1–4 pass. Reuse Epic 1 team validation, Epic 2 full thread/run/public security, Epic 3 context loading, and Epic 4 shared controls. Complete both sharing children before Epic 6 starts. Generic action paths and races between two grants are security-sensitive. Org admins and leads get no implicit read exception.

## Child Plans

1. [Owner-only sharing and authorized discovery](completed/01-share-policy-and-list.md) — H-01/H-02, independently verified locally.
2. [Shared conversation and linked-run UI](completed/02-team-work-ui.md) — H-03, independently verified locally in source and browser.

## Success Criteria

Members discover only explicit viewer grants; direct and listed access agree. Share revocation, org/team removal, and deletion deny subsequent thread/run requests. Unbound team sharing does not bind or change context.

## Execution status — 2026-10-06

Both children are complete with independent local proof recorded in their completion sections. The final Core matrix passed 15 files / 224 tests; Toolkit passed 45 tests and Chat passed 27 tests. Independent PostgreSQL contention proof passed three tests. Authenticated browser/action/SQL checks passed explicit-only discovery, read-only viewer controls, direct thread/run denial, and lifecycle cleanup.

The user explicitly closed the epic on 2026-10-06. Both completed children are retained inside this completed epic. This is local execution acceptance, not deployed or full V1 release acceptance. Epic 6 owns the remaining release-integration gates. The follow-on branch is `review/teams-5611-05-sharing`, based on PR #6 head, for publication as the next stacked PR.
