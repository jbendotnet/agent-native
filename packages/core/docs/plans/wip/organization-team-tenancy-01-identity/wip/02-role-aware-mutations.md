# Role-aware membership, leads, and audit

## Problem / Goal

Meet I-02/I-03 after [storage](01-storage-and-identity.md). Read [requirements](../requirements.md), [epic](../epic.md), and [ADR](../../../../design/organization-team-tenancy.md). Existing member updates derive a replacement list and call upsert; action-level owner/admin checks alone cannot implement team leads safely.

## Solution

Use one role-aware transactional group mutation boundary beneath all existing write actions. Lock/read the current row, validate the actor's current org role and team role, apply the requested delta, validate org membership, and persist members/leads together. Do not turn validation failures into empty successful updates.

## Implementation Plan

1. Leader: move child and epic into managed `in-progress/`, repair links, and load `execute-plan`, `actions`, `security`, `audit-log`, `adding-tests-and-ci`, and `concurrent-agents`.

2. <implementation_tranche id="group-role-policy" agent="medium">

   1. Trace `upsertWorkspaceUserGroup`, `updateWorkspaceUserGroupMembers`, deletion, and their action callers, including `MembersSection.tsx` bulk calls. Centralize current marked-team/membership lookup so future resource/chat consumers can reuse it without granting org-admin read access implicitly.
   2. Make membership and lead changes transactional against current row state. Owners/admins may replace membership and set leads; lead actors may only add existing org members and remove non-leads in their own team. Reject rename/conversion/lead-list changes through a lead's membership path. Validate complete replacement inputs as well as add/remove deltas.
   3. Extend existing actions and add `workspace-connections/actions/set-workspace-team-leads.ts` through the existing action registration/export mechanism. Require marked team, matching current org, current owner/admin authority, and a complete lead list that is a subset of current members.
   4. Emit audit history for effective membership/lead/conversion changes using existing audit primitives. Avoid recording credentials or unrelated personal data. Ensure all bulk paths invoke the same policy, not an unguarded store write.
   5. Cover owner/admin with and without leads, lead/member/nonmember/wrong-org/departed actor, lead-removal attempts, invalid lead emails, concurrent updates, and atomic member+lead removal. Prove direct helpers and actions agree.

   </implementation_tranche>

3. Leader: independent verifier checks actor matrix, transaction behavior, and action discovery before completing the child.

## Verification

Use `verifying-changes` to call real group actions under test request contexts, backed by the existing PostgreSQL test pattern. Run focused group/migration specs and `pnpm --dir packages/core typecheck`. Compare audit records to committed mutations; a rejected update must not appear successful. Ensure a lead cannot use upsert, bulk, or a direct membership helper to appoint/remove leads.
