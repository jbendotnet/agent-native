# Epic 6: Compatibility proof and release readiness

## Completion

Completed at the user's request on 2026-10-08. Both children are complete with
independent local acceptance and release-readiness evidence. See
[acceptance evidence](acceptance-evidence.md) and [release readiness](release-readiness.md).
The separate Content DB suite retains 16 unresolved failures. Completion records
the scoped local handoff, not unrestricted release approval, CI status, or
deployed health.

## Problem / Goal

Prove the full [accepted ADR](../../../design/organization-team-tenancy.md) without overstating partial implementation or deployed health. See [requirements](requirements.md).

## Scope / Boundaries

Consolidate acceptance evidence, compatibility, docs/locales, changesets, and applicable checks. Shipping requires separate authorization. No automatic production promotion or broad unrelated cleanup.

## Dependencies / Risks

All five implementation epics must pass their gates. Membership/cache/background parity is the highest cross-surface risk. A passing static check alone does not prove runtime revocation or stable prompt context.

## Child Plans

1. [Integrated actor and compatibility matrix](completed/01-acceptance-matrix.md) — R-01/R-02, complete with independent local proof.
2. [Documentation and release readiness](completed/02-docs-and-release-readiness.md) — R-03, local handoff complete. [Readiness evidence](release-readiness.md) retains unresolved Content DB failures and separates local proof from shipping or deployed health.

## Success Criteria

Each of the ten ADR criteria has runnable evidence. Additive migrations preserve legacy behavior. User-facing docs and translations match actual operations. Release status distinguishes local readiness from merged/deployed health.
