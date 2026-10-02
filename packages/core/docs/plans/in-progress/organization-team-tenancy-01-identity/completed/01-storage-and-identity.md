# Additive team storage and stable group identity

## Problem / Goal

Meet I-01 and the identity part of I-04 in [requirements](../requirements.md). Read [parent epic](../epic.md) and [ADR](../../../../design/organization-team-tenancy.md) before execution. No prior team schema exists in the inspected group model.

## Solution

Extend `packages/core/src/workspace-connections/groups.ts` and its existing migration path. Fix missing supplied IDs at the shared upsert boundary rather than in each caller. Do not move group initialization onto a serverless cold-start path.

## Implementation Plan

1. Leader: move this child to inner `in-progress/` and its whole epic to outer `in-progress/`; update links. Load `execute-plan`, `concurrent-agents`, `storing-data`, `portability`, `performance`, and `adding-tests-and-ci`.

2. <implementation_tranche id="team-storage" agent="medium">

   1. Inspect the current migration version tail in `workspace-connections/migrations.ts` and `groups.ts` schema declarations. Append an additive migration for the two ADR columns using the next actual version; update schema/type/row parsing consistently. Preserve the hosted-function no-DDL contract.
   2. Extend `WorkspaceUserGroup` and create/update inputs with `isTeam` and lead emails. Reuse existing email normalization/encoding. Return roles from the existing list surface without adding a second member list.
   3. Branch create and update explicitly in `upsertWorkspaceUserGroup`: create generates a fresh server ID; a supplied ID updates only an existing row in that org and fails if missing. Do not resurrect a deleted ID or infer one from a name. Preserve omitted update fields and reject implicit team deconversion.
   4. Add focused PostgreSQL-backed checks in nearby group/migration specs: old rows/defaults, create/update behavior, same-name conversion identity, wrong-org ID, deleted/supplied-ID failure, and serialized fields. Keep role-policy changes for child 02.

   </implementation_tranche>

3. Leader: accept only after an independent verifier reruns the targeted checks and confirms the diff is additive. Complete this child, not the epic, after proof.

## Verification

Use `verifying-changes` for Core storage. Run `pnpm --dir packages/core exec vitest --run src/workspace-connections/migrations.spec.ts src/workspace-connections/store.spec.ts` plus the focused group spec introduced beside `groups.ts`. Run Core typecheck and format modified source with oxfmt. Assert existing groups have false/empty defaults and that no supplied missing ID is inserted. Re-run the hosted initialization test; no migration/backfill at plugin initialization.

## Execution record

Completed 2026-10-02 after independent review and verification.

- Storage: migration v15, `workspace-user-groups-team-fields`, adds the two defaulted columns. Group inputs and list results carry team markers and normalized leads without a second membership list.
- Identity: new groups receive server-generated IDs; supplied IDs update only existing groups in the current organization. Missing, deleted, and wrong-organization IDs cannot insert rows. Omitted team fields are preserved and deconversion is rejected.
- Identity issue resolved: independent review found a stale update could undo a concurrent conversion. The update now compares the current marker and lead list at the database write boundary and reports a retry error on conflict. A PostgreSQL-backed interleaving test proves the converted row survives unchanged.
- Verification placement: focused group cases reuse the existing PostgreSQL-backed `store.spec.ts` harness instead of creating a separate group spec.
- Tooling issue resolved: initial formatting could not find the workspace executable. On recovery the executables were available; no dependency install or package-local install was needed.
- Independent rerun: `pnpm --dir packages/core exec vitest --run src/workspace-connections/migrations.spec.ts src/workspace-connections/store.spec.ts` passed 37 tests across two files.
- Hosted proof: `pnpm --dir packages/core exec vitest --run src/db/ddl-guard.spec.ts` passed 32 tests.
- `pnpm --dir packages/core typecheck`, `pnpm guard:additive-migrations`, oxfmt checks for all four changed TypeScript files, and `git diff --check` passed.
- Added `.changeset/fresh-teams-keep-identity.md`. Role policy and action lifecycle compatibility remain unfinished in children 02 and 03. The epic was subsequently closed at the user's request on 2026-10-02, with those child plans preserved in `wip/`.
