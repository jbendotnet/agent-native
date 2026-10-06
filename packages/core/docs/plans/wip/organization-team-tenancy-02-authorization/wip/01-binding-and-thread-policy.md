# Creation binding and unified thread policy

## Problem / Goal

Meet A-01/A-02 after all Epic 1 children and proof gates pass. Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Direct reads use `resolveThreadAccess`; list/search/bulk use `chatThreadAccessSql`. Both must enforce the same contract.

## Solution

Persist a validated nullable team ID only at actual server creation, and add the bound membership precondition to both direct and projected list decisions. Keep recorded-owner continuation separate from viewer access. Do not rely on generic owner bypass or admin role for bound access.

## Implementation Plan

1. Leader: move child/epic to `in-progress/`, repair links, and load `execute-plan`, `storing-data`, `sharing`, `security`, `performance`, `content-product-development`, `adding-tests-and-ci`, and `concurrent-agents`.

2. <implementation_tranche id="thread-binding-policy" agent="medium">

   1. Extend the existing chat migration/schema path, `ChatThread`, `ChatThreadSummary`, row conversion, and `THREAD_COLUMNS`/`SUMMARY_COLUMNS` in `chat-threads/store.ts`. Add nullable binding/index only; no backfill or FK that blocks/cascades deletion.
   2. Extend `createThread` and every actual INSERT caller, including the plugin's first-turn creation and fork path. Accept an explicit team creation input or null, validate creator against current org and marked-team membership before insertion, and preserve an existing thread's binding on updates. A new fork is a new creation and uses this validated creation contract, not an inferred migration of the source thread.
   3. Extend `resolveThreadAccess` before generic owner/admin access and the equivalent `chatThreadAccessSql` list/search/bulk predicate. Include viewer reads through existing group-share rows with current org/recipient-team membership and the bound precondition. Use projected membership/access data rather than loading transcripts for lists. Include current org membership, not just equality with a requested org ID. Resolve missing/deleted/non-team bindings as denied. Do not expose team-grant mutations or shared-work discovery yet.
   4. Trace plugin read/history/update/delete, prompt entry, and continuation callers. For bound threads, require the recorded owner for continuation/management after the membership gate; team grant is viewer only. Retain existing unbound non-team semantics. Do not let editor/admin generic roles authorize a team viewer's continuation. Until Epic 3 provides required context loading, explicitly reject bound prompt execution in normal and background paths; never run it with omitted context. Prove authorization separately from that temporary execution denial.
   5. Inspect collaboration/access caches and invalidation on group changes, org removal, thread mutations, and deletion. Either revalidate membership outside cached grants or use existing invalidation mechanisms with proven coverage; a stale positive cannot survive a new request.
   6. Test owner, explicit viewer, private nonowner, admin nonmember, and lead without share across direct/list/search/bulk/continue. Seed viewer group-share rows through existing test fixtures rather than depend on Epic 5 actions. Remove/rejoin membership and delete team; assert denial/restoration as appropriate and unchanged legacy unbound access. Test internal creation with explicit team IDs without requiring Epic 4 selection, and prove bound prompt execution fails explicitly before context support exists.

   </implementation_tranche>

3. Leader: independent verifier proves parity across direct/list/cache paths. Finish the public-token and linked-run children to complete Epic 2. Successful bound prompt execution belongs to Epic 3; exposing user/agent bound creation belongs to Epic 4. Neither is a completion prerequisite for this child.

## Verification

Run Core `src/chat-threads/store.spec.ts`, `store.access-projection.spec.ts`, and affected plugin lifecycle/thread-history specs through Vitest. Verify projected lists do not hydrate transcripts. Test forced client IDs, cross-org teams, ordinary groups, null legacy rows, and immutable updates. A removed owner cannot read or continue, while a still-authorized shared member can read but never act as successor.
