# Bound prompt precedence and memory provenance

Execution started on 2026-10-03. C-01 and all Epic 2 children are complete. Existing resource-access changes in the shared checkout are prerequisites and must be preserved.

Completed and independently verified on 2026-10-03. C-02–C-04 pass; the parent epic is complete.

## Problem / Goal

Meet C-02–C-04 after [resource access](../completed/01-team-resource-access.md) passes, with all Epic 2 children already complete. Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md). Current prompt skill/memory reads sometimes catch errors as omitted context.

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

## Execution result

- Authorized stored bindings reach normal and background prompt loading and JEV memory selection through request run context. Explicit unbound context stays unbound. Current organization and team membership gates remain separate from resource precedence.
- Instructions load workspace/app, organization, bound team, then personal. Exact-name skills prefer personal, bound team, organization, then defaults. Sibling-team resources cannot win. Overflow discovery names the authorized team scope and ID while preserving personal winners.
- Organization, team, and personal memory keep separate labels through candidate selection and body loading. Empty authorized team context is valid. Failed or incomplete required team lists and bodies, missing selected bodies, and timeouts fail instead of becoming empty context.
- Mounted foreground and worker tests capture the actual model prompt: a stored team A binding survives a later request selecting B. Injected team list/body failures prevent model calls and error background runs. Subsequent worker requests deny after organization or team revocation, team deletion, or missing conversation.
- Source review confirms binding remains separate from credential scope and introduces no connection grants. This is local mocked/in-memory proof, not live provider or PostgreSQL authorization proof. Epic 6 retains its release integration gate.

## Recorded proof

Independent verification passed the required two-file command with 68 tests. A fresh independent source review also ran four focused files with 109 passing tests:

```sh
pnpm --dir packages/core exec vitest --run src/server/agent-chat/prompt-resources.spec.ts src/server/agent-chat-plugin.resources.spec.ts src/server/agent-chat-plugin.worker-access.spec.ts src/server/agent-chat/prompt-resources.jev.spec.ts
```

The combined prompt-context, C-01, and Epic 2 matrix passed 25 files and 792 tests:

```sh
pnpm --dir packages/core exec vitest run --maxWorkers=1 --no-file-parallelism src/chat-threads/store.spec.ts src/chat-threads/store.access-projection.spec.ts src/application-state/store.spec.ts src/application-state/script-helpers.spec.ts src/agent/run-ownership.spec.ts src/server/agent-chat-stream.spec.ts src/server/agent-chat-plugin.lifecycle.spec.ts src/server/agent-chat-plugin.shared.spec.ts src/server/agent-chat-plugin.thread-history.spec.ts src/server/agent-chat-ai-setup.spec.ts src/server/agent-chat-plugin.run-routes.spec.ts src/server/agent-chat-plugin.worker-access.spec.ts src/server/agent-teams.spec.ts src/server/agent-teams-process-run.spec.ts src/agent/harness/background.access.spec.ts src/server/release-schema-migrations.spec.ts src/resources/script-helpers.spec.ts src/resources/handlers.spec.ts src/client/resources/use-resources.spec.ts src/server/agent-chat/script-entries.spec.ts src/agent/production-agent.spec.ts src/server/agent-chat-plugin.resources.spec.ts src/resources/team-operations.integration.spec.ts src/server/agent-chat/prompt-resources.spec.ts src/server/agent-chat/prompt-resources.jev.spec.ts
pnpm --dir packages/core typecheck
```

Core typecheck exited 0. Scoped oxfmt and `git diff --check` passed. Agent-chat-context and both i18n guards passed in producer verification; localhost-fallback, env-mutation, and unscoped-credentials guards passed independently.

## Resolved execution issues and remaining boundaries

The initial partial implementation failed typecheck and two focused tests. These were repaired before acceptance. Independent review then found that skill-summary overflow omitted scoped team discovery instructions; the fix adds the exact team lookup hint and two regression tests. No product or plan scope changed.

Branch-wide guards are not all green: `guard:no-silent-coercion` reports findings at `client/session-replay.ts:2283` and `scripts/netlify-beta-targets.ts:127,148`; `guard:no-unscoped-queries` reports `chat-threads/store.ts:916`. These paths are outside this tranche's changed files and were not altered to clear unrelated findings. No commit, push, or deployment was performed during child execution.

## Final wrap-up review

Review found two additional gaps: team-tree enrichment hid body-read failures, and compact instruction overflow hints omitted the bound team ID. Both regressions failed before the fixes. Team trees now reject unreadable or missing listed bodies while non-team trees retain best-effort behavior. Instruction hints include the team scope and ID without changing organization or personal hints.

Independent review found no remaining in-scope finding and confirmed the real resource store's visibility predicate accepts team owners. Fresh checks against the final source passed 13 files and 594 tests, Core typecheck, formatting of 23 source/test files, and `git diff --check`:

```sh
pnpm --dir packages/core exec vitest --run src/resources/handlers.spec.ts src/server/agent-chat/prompt-resources.spec.ts src/server/agent-chat/prompt-resources.jev.spec.ts src/resources/team-operations.integration.spec.ts src/server/agent-chat-plugin.worker-access.spec.ts
pnpm --dir packages/core exec vitest --run src/resources/script-helpers.spec.ts src/client/resources/use-resources.spec.ts src/server/agent-chat/script-entries.spec.ts src/agent/production-agent.spec.ts src/server/agent-chat-plugin.resources.spec.ts src/server/agent-chat-plugin.run-routes.spec.ts src/server/agent-chat-plugin.thread-history.spec.ts src/agent/harness/background.access.spec.ts
pnpm --dir packages/core typecheck
```

The earlier 25-file matrix was not rerun after these fixes. Store visibility was checked in source; tests still use mocked or in-memory storage, not live PostgreSQL. Epic 6 retains the release proof gate.
