# Member-authorized team agent resources

## Problem / Goal

Meet C-01 after all Epic 2 children and proof gates pass, using Epic 1 membership helpers. Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Current resource owner handlers do not recognize team owners.

## Solution

Extend agent resource operations with a validated `teamGroupId`, translating to `__team__:<id>` only on the server. Use the strongest existing resource operation/action helpers; do not add parallel CRUD REST routes or a general ownership enum for app resources.

## Implementation Plan

1. Leader: move child/epic to `in-progress/`, update links, and load `execute-plan`, `actions`, `client-methods`, `security`, `storing-data`, `adding-tests-and-ci`, and `concurrent-agents`.

2. <implementation_tranche id="team-resource-operations" agent="medium">

   1. Trace `resources/store.ts` owner parsing and `resources/handlers.ts` list/tree/get/create/update/delete paths. Extend agent-resource owner recognition narrowly, preserving all current scopes and inherited-default protections. Reuse Epic 1's marked-team/current-membership assertion on every request.
   2. Extend existing resource operations to accept team ID and path and return existing shapes. Where legacy handlers currently own the operation, put shared authorization/operation logic beneath them and expose it through the existing action surface, rather than adding another route. Ensure action registration includes team operations the agent can discover.
   3. Reauthorize update/delete by the stored resource owner as well as supplied target. Prevent arbitrary `__team__:` owner text, wrong-org IDs, mixed target/resource IDs, or a generic shared-owner switch from bypassing membership. Any current member may edit team resources; only org admins retain existing org-default editing authority.
   4. Extend `client/resources/use-resources.ts` named helpers/hooks for team scope. Keep stale-delete protection (`resourceDeleteIfCurrent`), list projection/pagination conventions, and existing resource paths; never copy org context into team rows.
   5. Add operation tests for all CRUD/list/tree paths, member versus nonmember/admin nonmember, membership loss, org switch, deleted team, malformed owner/unknown group, and legitimate empty resources. Verify existing personal/org/workspace behavior.

   </implementation_tranche>

3. Leader: independent verifier invokes agent operations and matching existing client/server operations under the same actor contexts before completion.

## Verification

Use `verifying-changes` for resource storage/action proof. Run affected resource/handler and client-resource Vitest specs, plus Core typecheck. Assert denial occurs before returned content or mutation, including resource-ID reads, not just list filtering. Delete a marked team and prove retained context cannot be read. Check action discovery; no new app-data API wrapper or permissive owner default.
