# Member-authorized team agent resources

Status: Completed and independently verified on 2026-10-03. Epic 3 is complete.

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

## Execution record

- Tranche items 1–3: `resources/team-access.ts` derives the owner from a validated team ID and reuses `getWorkspaceTeamForMember`. Existing handlers, resource scripts, and the registered agent `resources` tool enforce current membership. ID operations check the stored owner and supplied target. No route, migration, credential grant, or general app-resource ownership model was added.
- Tranche item 4: named client resource hooks accept team targets while preserving existing scopes and stale-delete protection. Added `.changeset/team-agent-resources.md` for the Core capability.
- Tranche item 5 and leader verification: independent review required stronger evidence than the initial mocked authorization helper and direct handler tests. `src/resources/team-operations.integration.spec.ts` now calls the real membership assertion, the callable agent tool, and the mounted framework HTTP middleware under matching actors. It covers successful list/tree/ID CRUD, denied actors and targets, revoked membership, deleted teams with retained rows, authorized empty results, and operational lookup failure.
- Resolved verification issues: the first integration harness used H3 routing instead of the framework's mount-relative middleware dispatcher and returned 404 for ID routes. It was corrected to use the real dispatcher. Independent review also found that an `Error:` output-prefix heuristic rejected valid resource content; team operations now propagate actual exceptions through the existing capture helper, with a regression proving error-prefixed content remains readable.

## Completion evidence

Independent verifier reran these checks against the final source:

```sh
pnpm --filter @agent-native/core exec vitest --run src/resources/script-helpers.spec.ts src/resources/handlers.spec.ts src/client/resources/use-resources.spec.ts src/server/agent-chat/script-entries.spec.ts src/agent/production-agent.spec.ts src/server/agent-chat-plugin.resources.spec.ts src/resources/team-operations.integration.spec.ts
pnpm --filter @agent-native/core typecheck
```

- Vitest: 7 files passed, 515 tests passed (14.19 seconds).
- Core TypeScript check passed. Scoped `oxfmt --check` passed for all 15 checked source/test files. `git diff --check` passed.
- Localization guards passed: 19 catalog directories and 89 changed-copy surfaces.
- Proof boundary: mounted HTTP and callable-agent integration with mocked org/group storage and a retained in-memory resource store, not live PostgreSQL or deployed verification. No started process remains running.
- C-02–C-04 prompt binding, precedence, and memory provenance are complete in the sibling plan. Epic 6 retains the release-level database and retained-binding proof gate.

Final wrap-up review found that tree enrichment still hid individual body-read failures. Team trees now propagate read errors and reject missing listed bodies; non-team trees retain best-effort enrichment. The regression covers unreadable and missing bodies, valid empty team trees, and non-team compatibility. Independent final verification passed `src/resources/handlers.spec.ts` and `src/resources/team-operations.integration.spec.ts` as part of the 13-file, 594-test wrap-up checks recorded in the sibling plan.
