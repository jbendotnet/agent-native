# Conversion, deletion, and grant compatibility

Status: Completed and independently verified on 2026-10-03 within the lifecycle proof boundary below. Full V1 acceptance remains pending.

## Problem / Goal

Meet I-04/I-05 after [role policy](../completed/02-role-aware-mutations.md). Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Conversion and deletion must not migrate ownership or silently recreate a group.

## Solution

Keep group IDs authoritative and extend the existing deletion cleanup in `workspace-connections/store.ts` and `groups.ts`. Remove connection allow-list references before deleting the group; leave resource and thread rows intact. Later authorization denies references to the missing group.

## Implementation Plan

1. Leader: move child/epic into `in-progress/`, update links, and load `execute-plan`, `sharing`, `security`, `audit-log`, `adding-tests-and-ci`, and `concurrent-agents`.

2. <implementation_tranche id="group-lifecycle-compatibility" agent="medium">

   1. Follow existing connection group cleanup and `delete-workspace-user-group`. Preserve its failure semantics: cleanup failure must not report a completed deletion. Owners/admins may delete a marked team regardless of bound-thread references.
   2. Add explicit conversion to the existing upsert action while preserving members, shares, connection grant references, and omitted fields. Reject `isTeam: false` on an existing team instead of silently deconverting it.
   3. Add a fixture with an ordinary group, supported resource grant, connection allow-list, and members. Convert it and prove IDs/grants still work. Delete it and prove group grant/connection access ends, unrelated resources survive, and supplied-ID updates fail.
   4. Assert deletion leaves representative `__team__:` resources and bound thread references intact once those later schemas are available. Record this cross-epic proof dependency rather than fabricating early thread support; Epic 6 runs the integrated case.

   </implementation_tranche>

3. Leader: independently verify group/connection tests now; require the retained-binding integration case in Epic 6 before release.

## Verification

Run group/store/migration and relevant sharing specs through Core Vitest. Compare rows before/after conversion and deletion, not only action return values. Ordinary group behavior must remain unchanged. Unknown resource families must not gain group support, and a group grant must not restrict already organization-visible resources. Integrated deletion denial is completed by A-02/C-01/R-01, not claimed delivered by this child alone.

## Execution Results

- Existing explicit conversion already preserved group identity, members, grants, and omitted fields, and rejected deconversion. Retained that implementation.
- Connection allow-list cleanup and group deletion now share one transaction. Cleanup errors propagate and roll back deletion. Removing the last group restriction disables a connection when no user restrictions remain, rather than widening access.
- Stored-row fixtures prove conversion preserves identity and connection grants, failed cleanup retains group and connection rows, deletion revokes connection access, unrelated data survives, and supplied-ID updates cannot recreate a deleted group.
- The registered resource fixture invokes `share-resource`, conversion and deletion actions, `resolveAccess`, and access-filtered listing. A non-owner with unchanged organization membership is denied before the grant, allowed after the grant and conversion, and denied after deletion. Resource and share rows remain. Organization-visible access is not narrowed, and unsupported or unknown resource families reject group grants.
- Added `.changeset/calm-team-lifecycle.md`. No material scope or technical-direction deviation.

## Verification Results

Independent source review accepted this child slice with no change-now findings. Independently rerun checks:

```sh
pnpm --filter @agent-native/core exec vitest --run src/workspace-connections/store.spec.ts src/workspace-connections/migrations.spec.ts src/sharing/access.spec.ts src/sharing/restricted-sharing.spec.ts src/sharing/recipients.spec.ts
pnpm --filter @agent-native/core typecheck
git diff --check
```

All 92 tests across five files passed. Core typecheck and diff checks passed. Modified TypeScript was formatted with oxfmt. The initial generic `npm test` acceptance hook timed out after 120 seconds; this is not a full-suite pass. The initial manual grant-row fixture proved retention only; registered resource authorization proof was added before independent acceptance.

## Remaining Integration Dependency

Epic 6 must prove retained `__team__:` context resources and bound-thread references after deletion against the later schemas, including denial on subsequent access and turns through A-02/C-01/R-01. Do not release or claim full V1 acceptance from this child’s group, connection, and supported-resource grant proof alone.
