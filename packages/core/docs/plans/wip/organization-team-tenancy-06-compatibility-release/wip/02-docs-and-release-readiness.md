# Documentation, changesets, and release readiness

## Problem / Goal

Meet R-03 after [acceptance proof](01-acceptance-matrix.md). Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Document implemented contracts, not roadmap promises.

## Solution

Update version-matched public reference docs and release metadata for the actual Core/Toolkit changes. Preserve the accepted ADR as decision history; do not rewrite it to claim deployment. This child prepares a handoff and does not commit, push, merge, or deploy unless separately requested.

## Implementation Plan

1. Leader: move child/epic into `in-progress/`, repair links, and load `execute-plan`, `create-documentation`, `writing-reference-docs`, `internationalization`, `verifying-changes`, and `concurrent-agents`.

2. Leader: update action/API documentation and examples from actual signatures. Explain explicit conversion, role authority, per-org selection, immutable binding, private-by-default/viewer-only sharing, owner departure/deletion retention, and connection-scoped stream revocation. Do not teach raw fetch or claim general team ownership.

3. Leader: update matching configured locales for source meaning changes under `packages/core/docs/content`. Document exact locale follow-up if a translation genuinely cannot be completed; it is unresolved release work, not a pass. Public API replacement/removal, if any arose despite the additive design, requires the matching migration guide/checklist.

4. <implementation_tranche id="release-artifact-checks" agent="medium">

   1. Independently inspect publishable source changes and ensure appropriate `.changeset/*.md` entries exist; never manually bump versions. For actual template app user-facing changes, use that app's `changelog` skill/command. Preserve unrelated changesets.
   2. Run formatting checks, affected package build/typecheck commands confirmed from current scripts, focused matrix tests, `pnpm guards`, `pnpm guard:i18n-catalogs`, and `pnpm guard:i18n-changed-copy`. Report failed/unavailable checks distinctly; do not weaken guards or add unexplained copy ignores.
   3. Review docs/action names against implementation and matrix evidence. Return exact discrepancies and commands/results; no Git publishing operations.

   </implementation_tranche>

5. Leader: repair documentation discrepancies, obtain independent recheck, update child state, and report local readiness plus remaining release actions. Entire epic completion requires explicit user declaration under the lifecycle conventions.

## Verification

All ten ADR rows from child 01 remain passing. Docs/locales and changesets correspond to actual changed APIs and behavior. Separate local verified status from CI/deployment. If shipping is later requested, load `ship`; use `ship-and-monitor` only for requested or concretely necessary post-merge proof. Never claim beta/production health from local checks alone.
