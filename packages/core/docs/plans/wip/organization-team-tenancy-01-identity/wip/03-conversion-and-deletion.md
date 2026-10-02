# Conversion, deletion, and grant compatibility

## Problem / Goal

Meet I-04/I-05 after [role policy](02-role-aware-mutations.md). Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Conversion and deletion must not migrate ownership or silently recreate a group.

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
