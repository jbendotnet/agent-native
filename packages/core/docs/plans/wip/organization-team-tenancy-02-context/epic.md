# Epic 2: Team agent context

## Problem / Goal

Provide member-editable team instructions, skills, and memory alongside org and personal context. Read the [accepted ADR](../../../design/organization-team-tenancy.md) and [requirements](requirements.md).

## Purpose

Team context is the capability that distinguishes marked teams from ordinary access groups. It must remain stable for a conversation without becoming a new ownership model for app resources.

## Scope / Boundaries

Reuse agent `resources` under `__team__:<group-id>`. No copied org resources/credentials, all-teams context, or conflict resolution for memory. Any current member can edit context; that does not authorize membership management.

## Current Context

`resources/handlers.ts` authorizes existing owner scopes. `client/resources/use-resources.ts` exposes matching client operations. `server/agent-chat/prompt-resources.ts` assembles instructions/skills and retrieves personal/org memory; some skill and memory errors currently become omitted context.

## Risks / Dependencies / Open Questions

Requires [Epic 1](../organization-team-tenancy-01-identity/epic.md) membership and [Epic 3](../organization-team-tenancy-03-authorization/epic.md) stored binding. Required team lookup failures cannot inherit the current best-effort omission behavior. UI context editing is delivered in Epic 4.

## Child Plans

1. [Member-authorized team resources](wip/01-team-resource-access.md) — C-01.
2. [Bound prompt precedence and memory provenance](wip/02-bound-prompt-context.md) — C-02–C-04.

## Success Criteria

Authorized members use existing resource shapes through shared operations. Every turn loads only its recorded team context with deterministic precedence; missing access or failed lookup stops the turn.
