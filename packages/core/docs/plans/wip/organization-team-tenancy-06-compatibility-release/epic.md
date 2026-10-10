# Epic 6: Compatibility proof and release readiness

## Problem / Goal

Prove the full [accepted ADR](../../../design/organization-team-tenancy.md) without overstating partial implementation or deployed health. See [requirements](requirements.md).

## Scope / Boundaries

Consolidate acceptance evidence, compatibility, docs/locales, changesets, and applicable checks. Shipping requires separate authorization. No automatic production promotion or broad unrelated cleanup.

## Dependencies / Risks

All five implementation epics must pass their gates. Membership/cache/background parity is the highest cross-surface risk. A passing static check alone does not prove runtime revocation or stable prompt context.

## Child Plans

1. [Integrated actor and compatibility matrix](wip/01-acceptance-matrix.md) — R-01/R-02.
2. [Documentation and release readiness](wip/02-docs-and-release-readiness.md) — R-03.

## Success Criteria

Each of the ten ADR criteria has runnable evidence. Additive migrations preserve legacy behavior. User-facing docs and translations match actual operations. Release status distinguishes local readiness from merged/deployed health.
