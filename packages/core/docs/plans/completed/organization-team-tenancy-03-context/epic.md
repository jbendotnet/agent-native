# Epic 3: Team agent context

Status: Completed on 2026-10-03.

## Problem / Goal

Provide member-editable team instructions, skills, and memory alongside org and personal context. Read the [accepted ADR](../../../design/organization-team-tenancy.md) and [requirements](requirements.md).

## Purpose

Team context is the capability that distinguishes marked teams from ordinary access groups. It must remain stable for a conversation without becoming a new ownership model for app resources.

## Scope / Boundaries

Reuse agent `resources` under `__team__:<group-id>`. No copied org resources/credentials, all-teams context, or conflict resolution for memory. Any current member can edit context; that does not authorize membership management.

## Current Context

`resources/handlers.ts` authorizes team owner scopes. `client/resources/use-resources.ts` exposes matching client operations. `server/agent-chat/prompt-resources.ts` assembles bound team context alongside organization and personal context with explicit precedence and memory provenance. Required team lookup failures stop the turn; legacy non-team compatibility is preserved.

## Risks / Dependencies / Open Questions

Start only after all children and proof gates in [Epic 2](../../completed/organization-team-tenancy-02-authorization/epic.md) pass, using its completed binding and authorization contract and [Epic 1](../../completed/organization-team-tenancy-01-identity/epic.md) membership helpers. Complete both context children before Epic 4 starts. Required team lookup failures cannot inherit the current best-effort omission behavior. UI context editing is delivered in Epic 4 and is not a prerequisite for context proof.

## Child Plans

1. [Member-authorized team resources](completed/01-team-resource-access.md) — C-01, completed and independently verified on 2026-10-03.
2. [Bound prompt precedence and memory provenance](completed/02-bound-prompt-context.md) — C-02–C-04, completed and independently verified on 2026-10-03.

## Success Criteria

Authorized members use existing resource shapes through shared operations. Every turn loads only its recorded team context with deterministic precedence; missing access or failed lookup stops the turn. Prove successful normal/background turns through internal creation inputs without selection UI or future share actions, and rerun Epic 2 authorization checks after integrating context.

## Execution status

C-01 is complete. Independent verification passed 7 focused test files and 515 tests, Core typecheck, scoped formatting, and diff checks. Mounted HTTP and callable-agent proof exercises the real membership assertion with mocked storage, including revoked access and deleted teams with retained resource rows.

C-02–C-04 are complete. Independent verification passed the combined 25-file, 792-test context and authorization matrix, Core typecheck, scoped formatting, and diff checks. Fresh source review and 109 focused tests accepted assembled normal/background prompts, retained binding after selection changes, team-scoped skill discovery, and failed-turn results. See the completed children for commands, resolved findings, and unrelated branch guard failures. Both child proof gates pass, so Epic 4's context prerequisite is satisfied. This epic was completed at the user's request on 2026-10-03; no Epic 4 work was started. Live PostgreSQL, deployed behavior, and retained-binding release integration remain outside this proof and assigned to Epic 6.

Final wrap-up review fixed silent team-tree body-read failures and missing team IDs in compact instruction overflow hints. Both regressions failed before the fixes. Independent review of the final source found no remaining in-scope finding; 13 focused files and 594 tests, Core typecheck, formatting of 23 files, and diff checks passed. The earlier 25-file matrix was not rerun after these two fixes.
