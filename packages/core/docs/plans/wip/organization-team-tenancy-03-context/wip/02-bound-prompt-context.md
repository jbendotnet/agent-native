# Bound prompt precedence and memory provenance

## Problem / Goal

Meet C-02–C-04 after [resource access](01-team-resource-access.md) passes, with all Epic 2 children already complete. Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Current prompt skill/memory reads sometimes catch errors as omitted context.

## Solution

Pass the already-authorized stored thread binding into `prompt-resources.ts`. Load exactly one team owner. Keep instruction order, skill winner order, and memory provenance explicit; an authorized empty team is valid, a failed required lookup is not.

## Implementation Plan

1. Leader: move child/epic into `in-progress/`, repair links, and load `execute-plan`, `content-product-development`, `security`, `writing-agent-instructions`, `adding-tests-and-ci`, and `concurrent-agents`.

2. <implementation_tranche id="bound-prompt-resources" agent="medium">

   1. Trace `loadResourcesForPrompt`, `loadInstructionResourcesForPrompt`, `loadResourceSkillPromptEntries`, `collectJevMemoryPromptCandidates`, and `loadSelectedMemoryBodies` plus all plugin callers. Thread the persisted binding from the authorized conversation, never a later session active-team value. Replace Epic 2's explicit pre-context execution denial only when required context loading works in both normal and background paths; preserve its current-access gates.
   2. Validate current org/team membership separately from resource precedence before each turn. Assemble workspace/app, org, bound team, personal instructions in that order. Keep unbound behavior unchanged and reject inaccessible bindings rather than omit team context.
   3. Build exact-name skill candidates in personal, bound team, org, default order before deduplication. Preserve existing skill body loading and discovery shapes. Do not let sharing/accessibility enumeration accidentally choose a sibling team's skill.
   4. Add a separate labeled team memory index/body source alongside org and personal sources, retaining provenance throughout selection/loading. Do not resolve contradictory memory facts or leak credentials into prompts.
   5. Replace silent team read/list/body coercions with explicit failures. Distinguish no matching resource from a failed/incomplete query. Preserve existing non-team compatibility deliberately; no blanket catch that produces an apparently successful team turn.
   6. Add deterministic prompt tests for collisions, multiple memberships, selection changes, unbound/legacy threads, revoked org/team membership, deleted team, and injected list/body failures. Exercise both normal and background prompt entry points. Use Epic 2's internal creation inputs and explicit preference fixtures rather than wait for Epic 4 UI. Rerun the completed authorization matrix to prove context integration preserves it.

   </implementation_tranche>

3. Leader: independent verifier inspects assembled prompts and failed-turn results before completing this child.

## Verification

Run `pnpm --dir packages/core exec vitest --run src/server/agent-chat/prompt-resources.spec.ts src/server/agent-chat-plugin.resources.spec.ts` plus focused new cases. A two-team conversation must retain team A context after selecting B. A failed team skill/memory read must not yield a successful response with missing context. Check labels and exact-name winners, and verify selection does not alter connection authorization.
