# Child 1 acceptance evidence

Scope: [child 1](completed/01-acceptance-matrix.md), R-01/R-02 only. Branch
`review/teams-5611-06-compatibility` starts at sharing-stack commit
`c8a5531000119c468712eded081290c8750c3cf8`. This record describes child 1's proof.
Child 2's subsequent completion is recorded in [release readiness](release-readiness.md).

## Independent local verdict

A different agent from the test producers reviewed the assertions and reran the
matrix. All ten ADR criteria and the R-01 unsupported-family boundary pass local
proof. Child 1 is **complete** after independent review of the final recovery
diffs and a successful complete fast-suite run. Both children are complete;
the [epic](epic.md) records the user's completion declaration.

Paths below are relative to `packages/core/src/`. Each row ran in the Core
command below: **20 files, 355 tests passed**. Toolkit added **2 files, 5 tests
passed**. Verdicts are based on assertions, not test filenames.

| ADR | Assertion-backed cases | Result |
| --- | --- | --- |
| 1. Legacy compatibility | `workspace-connections/migrations.spec.ts`, “retains migrated legacy grants through conversion and bound context through real team deletion”: five legacy row sets match across additive migrations; ordinary-group defaults remain false/empty and old threads remain null-bound. On the same PGlite fixture, viewer, connection, and old-token access survive conversion with preserved IDs/grants. `sharing/access.spec.ts`, “includes group-only shares in filtered listings while checking current membership”: after conversion, unsupported/unknown families reject team grants, no grant persists, the unsupported viewer has no access, and the supported grant survives. | PASS, local |
| 2. Team authority | `workspace-connections/store.spec.ts`, direct/action role and locked-authority cases: owners/admins with and without team membership manage teams with leads; leads manage ordinary members only in their team. Bulk writes preserve the lead/member subset and audit committed deltas. | PASS, local |
| 3. Durable selection | `workspace-connections/active-team.spec.ts` and `active-team.integration.test.ts`: fresh sessions, distinct users/organizations, organization switching, invalid-choice cleanup, removal, and failed persistence. Toolkit group/resource settings cases verify action wiring. | PASS, local |
| 4. Bound context | `server/agent-chat-plugin.resources.spec.ts`, `server/agent-chat/prompt-resources.jev.spec.ts`, and `server/agent-chat-plugin.worker-access.spec.ts`: foreground/background turns use stored binding rather than later selection; unbound prompts omit team context; instruction/skill precedence is deterministic; memory keeps source labels. | PASS, local |
| 5. Bound access and privacy | `chat-threads/store.spec.ts`, “revokes projected list, search and bulk access…”, and `store.access-projection.spec.ts`: direct/list/search/bulk gates revoke owner/viewer access on departure and restore permitted access on rejoin. `team-sharing.spec.ts` keeps private bound work undiscoverable without a grant and denies viewer continuation/management. | PASS, local |
| 6. Owner-only viewer sharing | `chat-threads/team-sharing.spec.ts`: recorded-owner grant/revocation, one allowed recipient, bound-team restriction, competing-team rejection, commenter/editor/admin rejection, resource-admin bypass rejection, and viewer read-only access. | PASS, local |
| 7. Public tokens | `chat-threads/store.spec.ts`, “refuses %s pre-existing tokens after binding, even after membership loss or team deletion”, runs indexed/legacy variants. Issuance denies bound threads; HTTP redemption returns 404 before transcript/run serialization and never calls run enrichment. Unbound shared-thread public access survives. | PASS, local |
| 8. Linked runs and streams | `server/agent-chat-plugin.run-routes.spec.ts`: new reads/lists/events/cached background requests/replay/reconnect deny after organization/team departure, deletion, share revocation, or missing thread; an already-open stream receives its post-revocation event and may finish. Worker reentry denies before dispatch-payload reads. Harness background and team-service cases cover controller/service paths. | PASS, local |
| 9. Deletion retention | The same migrated fixture uses the real delete action and compares retained bound thread, instruction/skill/memory, personal-resource, and share rows. Fresh bound/context requests deny, unbound owner/public access survives, connection/viewer access ends, deleted-ID updates fail, and same-name creation gets a new ID. `team-sharing.spec.ts` separately exercises deletion of an explicitly shared bound thread. | PASS, local |
| 10. Lookup failures | `resources/team-operations.integration.spec.ts` distinguishes authorized empty context from injected lookup failure (action rejection/HTTP 500). Foreground/background prompt cases fail required list/body reads and incomplete/timeout retrieval rather than omit context or report success. | PASS, local |

Actors across relevant cases: organization owner/admin as team member and
nonmember, lead, ordinary member, recorded owner, explicit viewer, outsider,
and departed organization/team member. Private binding and explicit sharing are
separate. Removal, rejoin, share revocation, and deletion run where relevant;
this does not claim every Cartesian actor/path pair.

## Reproduce

Run from `.tmp/teams-5611-06-compatibility` with the pinned runtime:

```sh
source "$HOME/.nvm/nvm.sh"
nvm use 24.14.0
pnpm --dir packages/core exec vitest --run src/workspace-connections/migrations.spec.ts src/workspace-connections/store.spec.ts src/workspace-connections/active-team.spec.ts src/workspace-connections/active-team.integration.test.ts src/chat-threads/store.spec.ts src/chat-threads/store.access-projection.spec.ts src/chat-threads/team-sharing.spec.ts src/chat-threads/actions/get-chat-thread-run.spec.ts src/chat-threads/actions/list-chat-thread-runs.spec.ts src/agent/run-ownership.spec.ts src/agent/harness/background.access.spec.ts src/server/agent-chat-plugin.run-routes.spec.ts src/server/agent-chat-plugin.worker-access.spec.ts src/server/agent-chat-plugin.shared.spec.ts src/server/agent-chat-plugin.resources.spec.ts src/server/agent-chat/prompt-resources.jev.spec.ts src/resources/team-operations.integration.spec.ts src/server/agent-teams.spec.ts src/server/agent-teams-process-run.spec.ts src/sharing/access.spec.ts
pnpm --dir packages/toolkit exec vitest --run src/app/org/GroupsSection.team.spec.tsx src/app/resources/ResourceSettingsGroups.team.spec.tsx
pnpm exec oxfmt --check packages/core/src/workspace-connections/migrations.spec.ts packages/core/src/chat-threads/team-sharing.spec.ts packages/core/src/agent/harness/background.access.spec.ts packages/core/src/sharing/access.spec.ts
git diff --check
```

Independent transcript: worktree-local `.tmp/independent-tenancy-final.log`.
Core reports `Test Files 20 passed (20)` and `Tests 355 passed (355)`.
Toolkit reports `Test Files 2 passed (2)` and `Tests 5 passed (5)`.
Formatting and diff checks pass. Logs are local scratch artifacts; the commands
and assertions above are the durable proof.

## Recovery and required wider checks

| Command | Actual result | Evidence / remaining failure |
| --- | --- | --- |
| `pnpm typecheck` | PASS after isolated workspace prebuild | Production-secret/database configuration warnings are not production-health proof. Core and Toolkit package typechecks also pass. |
| `pnpm test:fast` | PASS, complete configured run | `.tmp/final-compatibility-complete.log`. Command scope: 52 of 53 workspace projects. Core: 1,123 files / 18,663 tests; Toolkit: 330 files / 3,508 tests; Chat: 53/53 tests; Content: 345 files / 4,399 passed and 3 expected failures. Both subsequent root guard-test commands passed. |
| `GUARD_DIFF_BASE=review/teams-5611-05-sharing pnpm guards` | PASS: 85/85 | The existing origin ref resolves to the exact stack base. Import/eject boundaries were repaired without changing guard rules. No skipped/exit-2 check counts as passing. Default-main diff failures from earlier stacked work are not the child PR's diff. |
| `pnpm --dir templates/content exec vitest --run shared/search-title-ranking.perf.test.ts` | PASS: 2/2 | Original 10,000-title result checks and 50 ms assertions remain unchanged. Combined correctness/performance proof also passed 19/19. |

No guard, baseline, test, or runtime contract was weakened. Dependency-resolution
failures were repaired with an isolated frozen-lockfile install and repository
prebuild. Shared installs and the lockfile were not changed. Runtime selection
uses `nvm`; no global default alias is retained. Browser and ffmpeg provisioning
used the system CA trust store, not a TLS bypass.

Independent recovery proof also passed 24 Core files / 765 tests and six Toolkit
files / 34 tests. The commands extend the matrix above with Core
`src/org/context.spec.ts src/server/auth.spec.ts src/scripts/runner.spec.ts src/framework-tools.spec.ts`
and Toolkit
`src/app/settings/shell/pages/resource-pages.spec.tsx src/chat-history/ChatHistoryList.spec.tsx src/app/chat-history/ChatHistoryList.spec.tsx src/app/chat-history/TeamShareMenu.spec.tsx`.
See worktree-local `.tmp/recovery-independent-review.log` for that run.

The final independent Toolkit command used the same six files listed above and
passed **6 files / 35 tests**, including the added legacy-export compatibility
assertions. All **29 modified source files** passed `oxfmt --check`, and
`git diff --check` passed. Final command output is in worktree-local
`.tmp/final-compatibility-complete.log`; those results supersede earlier failed
attempts, rather than treating focused reruns as a whole-suite pass.

Required-check recovery changed only the relevant boundaries:

- Organization/auth/resource-page fixtures now model persisted settings,
  current membership, session mirrors, and actual group-list response shapes.
- CLI subprocess fixtures declare their ES-module mode rather than change
  AgentKit's import-only exports. Framework tool classification includes the
  three existing chat capability/run actions in the sharing group.
- Core-backed Toolkit chat-history wiring lives under `app/chat-history`.
  Core-free lists receive a capability hook and deny management when it is
  absent. Legacy TeamShareMenu imports remain compatibility re-exports; Chat
  uses the focused app entrypoints. Eject metadata matches these boundaries.
- Test locale is explicit; UI tests await actual chooser, denial, dialog, and
  focus state instead of fixed delays. Assertions are retained.
- Design's canvas test uses its actual Vitest lane. Checked-in Figma cases are
  distinguished from the designated ad-hoc corpus directory, not any parent
  path containing `.tmp`. Browser setup uses the existing 30-second budget.
- The two 10,000-title timing checks keep their original 50 ms assertions in
  `shared/search-title-ranking.perf.test.ts`; explicit proof passed 2/2, while
  the original fast correctness file passed 17/17.

## Boundaries and remaining work

- The initial proof adds integrated migrated-fixture lifecycle, explicit-share
  deletion retention, unsupported-family denial, and the required membership
  fixture ID. Subsequent recovery includes the small runtime classification and
  Toolkit import-boundary changes described above. Their patch changeset is
  `.changeset/tenancy-compatibility-boundaries.md`.
- Lifecycle proof uses PGlite. Mounted route/service/controller tests are local
  runtime proof, not independent live-PostgreSQL concurrency or deployment proof.
  No new browser run is claimed. Earlier completed Epic 4 browser proof is a
  prerequisite; partial S03 scratch artifacts do not prove first-turn/cross-org
  behavior.
- Initial broader runs exposed a Node-pin mismatch, incomplete local binary
  provisioning, stale fixtures, fixed-delay UI waits, and benchmark lane
  placement. The final complete run passes after the bounded repairs above.
  No thresholds, authorization checks, fidelity baselines, or assertions were
  weakened. Earlier failed-run transcripts remain in local scratch storage.
- An additional Content DB-suite invocation reported 16 failures outside the
  required fast lane. No Content database implementation changed; this is not
  proof of the wider Content DB suite and is not counted as passing.
- At child 1's completion, child 2 had not executed. The changeset covers runtime
  recovery. Child 1 changed no user-facing copy, and both i18n guards passed.
  Child 2's later documentation, translations, and checks are recorded separately
  in [release readiness](release-readiness.md). This proof includes no merge,
  deployment, or new browser verification.
