# Child 2 local release-readiness handoff

## Disposition

R-03 is complete for the scoped documentation and local release-artifact checks on
`review/teams-5611-06-compatibility`, with HEAD
`c8a5531000119c468712eded081290c8750c3cf8`. This is not an unrestricted release
approval. The user declared the outer epic complete on 2026-10-08. Commit, push,
and a new PR stacked on PR #9 are authorized separately from this local proof.
No merge, publication, or deployment is claimed.

The three public references are `organizations-teams-permissions.mdx`,
`sharing.mdx`, and `agent-resources.mdx` under `packages/core/docs/content`.
Their matching translations were updated for `ar-SA`, `de-DE`, `es-ES`, `fr-FR`,
`hi-IN`, `ja-JP`, `ko-KR`, `pt-BR`, `zh-CN`, and `zh-TW`. No locale follow-up,
localization baseline change, or copy-ignore exemption was used.

The docs describe explicit group conversion, owner/admin and team-lead authority,
per-organization active selection, immutable conversation binding, private
personal ownership, one viewer-only team grant, retention after departure or
deletion, and fresh-connection revocation. Team context is limited to
instructions, skills, and memory, not general app-data ownership. Examples use
the exported `callAction` helper rather than raw framework-route requests.

`packages/core/docs/migrations/team-chat-history.md`, linked from the migration
checklist, explains the app chat-history wrapper and the capability-hook
requirement for enforcing callers of the retained legacy presentation component.
The independent review confirmed the action schemas and import paths. Its
example findings were repaired across English and all ten locales: creation no
longer assumes the caller belongs to the new team, and conversion first resolves
an existing group and preserves its member list.

## Release artifacts and preservation

The existing `.changeset/tenancy-compatibility-boundaries.md` declares Core and
Toolkit patch releases and covers the action classification and chat-history
entrypoint compatibility changes. It was preserved, not replaced. No package
version was manually changed. The Chat sidebar change is import wiring, and Chat
disables its app changelog, so no template changelog entry was added.

An independent comparison verified all 31 recorded baseline file hashes and all
five baseline deletions. Child 1 implementation, tests, completed plan, changeset,
and [acceptance evidence](acceptance-evidence.md) remain unchanged. In particular:

- Acceptance evidence SHA256: `c6018528210188e8f9dafe77c1de6477b837c33a8c944f738d806d2eb03c76b6`.
- Changeset SHA256: `60ce911ce8a798ed493d2c5081774e9a33bb719573115a5bbdc159ce3bb8e857`.
- Completed child 1 SHA256: `bae84040b38f5a011fc169cb99b1ef40460b32fa76f8b24c979b262c305d5df4`.

## Local verification

All pnpm commands ran in the existing task worktree after
`source "$HOME/.nvm/nvm.sh" && nvm use 24.14.0`. No Node installation or global
default change was made. The independent final run recorded these results:

| Command                                                                               | Exit | Result                                             |
| ------------------------------------------------------------------------------------- | ---: | -------------------------------------------------- |
| `pnpm --dir packages/core build`                                                      |    0 | Build and dist-import check passed                 |
| `pnpm --dir packages/core typecheck`                                                  |    0 | Typecheck passed                                   |
| `pnpm --dir packages/toolkit build`                                                   |    0 | Build passed                                       |
| `pnpm --dir packages/toolkit typecheck`                                               |    0 | Typecheck passed                                   |
| `pnpm --dir packages/docs build`                                                      |    0 | Docs application build passed                      |
| `pnpm --dir packages/docs exec vitest run app/components/docBlocks.validate.test.tsx` |    0 | 1 file, 12 tests passed                            |
| `pnpm --filter @agent-native/docs validate-doc-blocks`                                |    0 | Supported docs validation, 1 file, 12 tests passed |
| `pnpm guard:i18n-catalogs`                                                            |    0 | 19 catalog directories checked                     |
| `GUARD_DIFF_BASE=review/teams-5611-05-sharing pnpm guard:i18n-changed-copy`           |    0 | 3 changed copy surfaces checked                    |
| `GUARD_DIFF_BASE=review/teams-5611-05-sharing pnpm guards`                            |    0 | 85/85 passed, no skipped guard reported            |
| `git diff --check`                                                                    |    0 | Whitespace check passed                            |

The guard base is the preceding sharing stack, not `main`. Existing non-failing
template-standard, dependency-band, and instruction-length warnings remain.
The following formatter command exited 0 for all 35 public-doc and migration
files, after formatting only those files:

```bash
pnpm exec oxfmt --check packages/core/docs/content/{organizations-teams-permissions,sharing,agent-resources}.mdx packages/core/docs/content/locales/*/{organizations-teams-permissions,sharing,agent-resources}.mdx packages/core/docs/migrations/{README,team-chat-history}.md
```

The ten-row acceptance matrix was independently rerun with the following exact
commands. All exited 0. Core passed 20 files and 355 tests. Toolkit passed 2 files
and 5 tests. The expanded Toolkit compatibility check passed 6 files and 35 tests,
including the two matrix files rather than 35 additional distinct tests.

```bash
pnpm --dir packages/core exec vitest --run src/workspace-connections/migrations.spec.ts src/workspace-connections/store.spec.ts src/workspace-connections/active-team.spec.ts src/workspace-connections/active-team.integration.test.ts src/chat-threads/store.spec.ts src/chat-threads/store.access-projection.spec.ts src/chat-threads/team-sharing.spec.ts src/chat-threads/actions/get-chat-thread-run.spec.ts src/chat-threads/actions/list-chat-thread-runs.spec.ts src/agent/run-ownership.spec.ts src/agent/harness/background.access.spec.ts src/server/agent-chat-plugin.run-routes.spec.ts src/server/agent-chat-plugin.worker-access.spec.ts src/server/agent-chat-plugin.shared.spec.ts src/server/agent-chat-plugin.resources.spec.ts src/server/agent-chat/prompt-resources.jev.spec.ts src/resources/team-operations.integration.spec.ts src/server/agent-teams.spec.ts src/server/agent-teams-process-run.spec.ts src/sharing/access.spec.ts
pnpm --dir packages/toolkit exec vitest --run src/app/org/GroupsSection.team.spec.tsx src/app/resources/ResourceSettingsGroups.team.spec.tsx
pnpm --dir packages/toolkit exec vitest --run src/app/settings/shell/pages/resource-pages.spec.tsx src/chat-history/ChatHistoryList.spec.tsx src/app/chat-history/ChatHistoryList.spec.tsx src/app/chat-history/TeamShareMenu.spec.tsx src/app/org/GroupsSection.team.spec.tsx src/app/resources/ResourceSettingsGroups.team.spec.tsx
```

The task-local scratch record `.tmp/final-child2-independent-proof.log` contains
the command and exit summaries, including failed exploratory probes. It is not
a published artifact or a replacement for this durable handoff.

## Failed probes and proof boundaries

A standalone `@mdx-js/mdx` import probe exited 1 with `ERR_MODULE_NOT_FOUND`.
Strict whole-file `remark-mdx` parsing also exited 1 and rejected all 33 docs
because of custom expression/comment syntax. Neither is a passing check. These
were unsuitable validation targets: the actual docs runtime splits Markdown and
parses registered JSX fragments, and the supported doc-block validation checks
those fragments and their server rendering. No dependency was installed, and no
docs syntax was weakened to accommodate a different compiler. The docs build and
validation do not establish whole-file MDX compilation or browser appearance.

The earlier separate Content DB-suite invocation still has **16 unresolved
failures**. It was not rerun or repaired by child 2. The passing focused matrix,
builds, and guards do not resolve that suite. Child 1's wider fast-suite results
remain historical evidence, not a fresh child 2 workspace-wide rerun.

Local PGlite, route, controller, package, and docs checks are not live PostgreSQL
concurrency proof, browser proof, deployed behavior proof, or CI status. No new
browser or server session was started or left running. Any broader release
decision must account for the unresolved Content DB failures and separately
obtain whatever CI or environment-specific evidence that decision requires.
