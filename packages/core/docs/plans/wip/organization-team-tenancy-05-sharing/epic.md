# Epic 5: Explicit team sharing and shared-work view

## Problem / Goal

Give current team members a central view of explicitly shared conversations and linked runs without opening private team-bound work. Follow the [accepted ADR](../../../design/organization-team-tenancy.md) and [requirements](requirements.md).

## Scope / Boundaries

Reuse `chat_thread_shares` group viewer rows. Only the recorded owner grants/revokes; at most one team recipient. No automatic share, successor, cross-team bound share, or separate run grants.

## Current Context

Generic `share-resource` permits broader roles and resource-admin authority. Chat SQL lists currently lack group grants. Shared UI must consume a paginated explicit-share action, not list every bound thread.

## Dependencies / Risks

Requires Epic 1 team validation, Epic 3 full thread/run/public security, and Epic 4 shared controls. Generic action paths and races between two grants are security-sensitive. Org admins and leads get no implicit read exception.

## Child Plans

1. [Owner-only sharing and authorized discovery](wip/01-share-policy-and-list.md) — H-01/H-02.
2. [Shared conversation and linked-run UI](wip/02-team-work-ui.md) — H-03.

## Success Criteria

Members discover only explicit viewer grants; direct and listed access agree. Share revocation, org/team removal, and deletion deny subsequent thread/run requests. Unbound team sharing does not bind or change context.
