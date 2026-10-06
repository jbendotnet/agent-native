# Team management browser proof — reset and seeded handover

**Date:** 2026-10-05

**Status:** Local reset and seed independently verified; browser proof incomplete.

**Next session:** Use the seeded owner/member accounts to finish only the three bounded UI assertions.

Historical handover: browser proof was subsequently completed and independently accepted. The [completed child](../completed/02-team-management-ui.md) and [epic completion record](../epic.md) supersede the pending work and runtime instructions below. Do not repeat the reset or setup.

## Executive Summary

Team controls and authenticated action/resource authorization checks are implemented and verified. Browser completion is still missing: rendering was inconsistent, save/reload lacked saved raw corroboration, and a runtime restart destroyed the stale-permission editor before a Chrome timeout. At the user's request, local Dispatch was reset with the old database preserved as a backup, and a replacement QA organization, normal sign-in accounts, team, and instructions were seeded and independently checked. The setup runtime is stopped.

## Must Read Before Continuing

- [Epic 4](../epic.md) — child state and Epic 5 dependency gate.
- [Requirements](../requirements.md) — S-04 product and permission boundaries.
- [Completed team-management child](../completed/02-team-management-ui.md) — final gate supersedes historical failures; do not repeat the role matrix.
- [Accepted tenancy ADR](../../../../design/organization-team-tenancy.md) — team membership controls context access; admin status alone is not a read exception.
- [Subagent delegation skill](/Users/jon.bennett/.config/opencode/profiles/sse-team/skills/subagent-delegation/SKILL.md) — leader owns plans/state; delegate browser work, code exploration, implementation, and independent grading. Read the appropriate reference before dispatch.

## Reset Actually Performed

- Original local Dispatch DB relocated to `templates/dispatch/data/pglite-team-management-backup-2026-10-05T21-04-25-591Z`, not deleted.
- Replacement active DB: `templates/dispatch/data/pglite`.
- One new isolated QA org was created in the replacement. This reset was explicitly requested; it does not authorize more organizations or hosted changes.
- Repo-root `data/pglite` was not part of the reset. Its ownership is unknown; leave it alone.
- The producer reported no source, branch, index, or unrelated app changes. This is a dirty shared checkout: do not reset, clean, stash, switch branches, commit, or push as part of this handoff.
- The runtime is stopped. At 21:15:02Z an independent scan found no recorded setup PIDs and no listeners on 8180/8092. Recheck ownership before startup; this is a timestamped observation, not a permanent guarantee.
- No browser was opened during reset/seeding. Historical proof tabs were producer-reported closed; browser-tab absence was not independently checked in this reset audit.

The backup directory's existence was independently verified; its contents were not opened or independently audited. Do not delete it. Historical four-actor fixtures belong to that backup, not the replacement. No broad cache, dependency, environment-file, or unrelated database reset was done.

## Seeded Data and Normal Sign-In

| Fixture               | Value                                                           |
| --------------------- | --------------------------------------------------------------- |
| Organization          | `be72552685f649b7bbde7c244eabfedd`                              |
| Owner email           | `team-owner+reset-2026-10-05t21-04-25-591z@example.test`        |
| Member email          | `team-member+reset-2026-10-05t21-04-25-591z@example.test`       |
| Team                  | `ed956b81-f235-4b36-b683-9429837f3e55`                          |
| Instructions resource | `4d2d889c-b8a1-4eef-ae8b-58ed715939fa`                          |
| Resource name         | `AGENTS.md`                                                     |
| Baseline              | `QA team instructions baseline — replace during browser proof.` |

Both actors are members of the seeded team. Their org roles are owner and member. These are real Better Auth users with credential-provider accounts, created through normal signup, with member joining through the invitation flow—not synthesized browser sessions or direct membership inserts.

- [Nonsecret seed manifest](../../../../../../../.tmp/team-management-reset-seed-manifest.json) — canonical identities, IDs, backup path, setup history, and recorded runtime ownership.
- Private sign-in file: `.tmp/team-management-reset-seed-credentials.json`, independently checked as `0600`. Read locally only to fill normal sign-in forms. Never copy passwords, cookies, session tokens, or the private file into chat, screenshots, evidence, or Git.
- [Seed script](../../../../../../../.tmp/team-management-reset-seed.ts) — setup provenance, not a command to rerun before the browser proof.
- [Owned-invitation cleanup evidence](../../../../../../../.tmp/team-management-reset-seed-cleanup-evidence.json) — one wrong-address invitation from a timestamp/resume bug was removed using an exact-ID/org/email/pending-status parameterized delete. Its absence was independently verified. No known wrong-address invitation remains.

The producer reported successful normal password sign-ins for both accounts. The independent audit verified persisted users, credential-provider accounts, roles, and fixtures, not live authentication or browser login. Confirm both browser identities early in the next session.

## Start the Next Session

Do **not** reset or seed again. The replacement is ready. First confirm there is no live owner of its PGlite directory and that 8180/8092 are available; preserve unrelated processes.

From repository root, start one owned Dispatch runtime:

```bash
DATABASE_URL=pglite:./data/pglite WORKSPACE_PORT=8180 AUTO_CREATE_DEFAULT_ORG=0 AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1 pnpm dev -- --apps dispatch --no-kill
```

The recorded local URL resolves under Dispatch's app working directory to `templates/dispatch/data/pglite`. Do not point it at the backup or repo-root database. Keep automatic organization creation and the automatic dev account disabled.

1. Prepare the two credentials from the private file before starting browser proof.
2. Open separate isolated browser contexts for owner and member; use normal Dispatch password sign-in in each. Do not inject database session cookies.
3. Confirm `org/me` identifies the expected actor, organization, and role in each context. Prepare the owner's team-management controls **before** opening the member's stale editor.
4. Use these shared settings routes:
   - `http://127.0.0.1:8180/dispatch/settings/members`
   - `http://127.0.0.1:8180/dispatch/settings/instructions`
5. Keep the same runtime running for all checks and membership revocation. Never stop it to read an admin session from SQL.

Do not invoke the old [v2 setup](../../../../../../../.tmp/team-management-browser-v2-setup.ts) or [v2 control](../../../../../../../.tmp/team-management-browser-v2-control.ts) scripts: both start a runtime and were implicated in destroying the stale editor. Do not open PGlite from a second process while Dispatch holds its lock.

## What Has Already Passed

- Focused Core checks: 60 tests across the three planned files.
- Focused Toolkit checks: five tests across the two planned files.
- Affected Core/Toolkit typechecks, localization guards, formatting/whitespace checks.
- Scoped permission-error recovery: six bare group-management permission throws changed to the existing typed 403 contract, without relaxing policy. Independent review and a mounted 403/unchanged-state regression passed.
- Real normal-cookie scripted matrix: 42 assertions; bounded supplement: 23 assertions. Independent grading accepted their combined authorization and persistence evidence. **Do not rerun this matrix.**
- Reset-seed audit: 13/13 parameterized SELECT checks passed at 21:14:55–21:14:56Z, exit zero. Checked the expected org, roles, auth users/accounts, team roster, instructions baseline, correct accepted invitation, and wrong invitation absence. Credential-file mode, backup-directory existence, and recorded PID/port absence were checked separately.

These are distinct proof layers. SQL seed checks are not browser proof, HTTP save responses alone are not visible rollback, and a transient 503 is not a permission denial.

## Exactly What Remains

### 1. Shared settings render

As the confirmed ordinary member, show the seeded team in Members and select its context in Instructions. Previously Members showed “No groups yet” while a producer-reported authenticated group-list 200 contained the team. Capture the actual response and rendered snapshot before diagnosing or changing code.

A read-only investigation found a possible email-case boundary: the list action compares membership case-insensitively, while `GroupsSection` uses exact roster matching against a lowercased actor email. This is **an unconfirmed hypothesis**, not an established bug. The fresh seed uses lowercase emails; do not claim the discrepancy is fixed because this fixture passes.

### 2. Allowed edit survives reload

In the member's team Instructions editor, change the baseline to a unique nonsecret proof value. Save, reload fully, reopen `AGENTS.md`, and capture that same value. Save raw successful mutation/readback responses and rendered evidence. A previous producer reported this flow passed, but saved no raw corroboration; independent grading did not pass it.

### 3. Stale-permission error and rollback

Leave the member editor open. In the owner's separate context, remove **only the member** from this team using the existing shared management surface. Do not remove the org membership, delete the team/resource, restart the runtime, or refresh away the stale editor.

Submit a different nonsecret value from that stale member editor. Capture the actual forbidden request, visible error, rollback/unsaved-state behavior, and an owner-authenticated readback proving the denied value did not persist. A hidden control or a scripted denial is not sufficient UI proof. Restore membership only after saving the evidence.

## Browser Discipline and Independent Acceptance

- Delegate one bounded browser slice; an independent grader of at least the producer's tier checks the saved raw evidence.
- Save snapshots, screenshots, sanitized request/response captures, and timestamps to root `.tmp/`. A narrative JSONL written afterward is not enough.
- Record relevant console/network errors. Do not assert a clean console unless checked. Omit auth headers and cookies from captures.
- Chrome DevTools failure/flakiness stops browser work immediately. Diagnose connectivity separately; do not restart the suite or disguise a timeout as a product failure.
- The historical timeout followed a runtime restart, but its cause was never independently established.
- All three UI checks must independently pass before moving the child to `completed/`. The leader owns that move and epic updates.
- New-chat child 3 remains pending. Even completing this browser child alone does not open the Epic 5 gate.

## Readback, Cleanup, and Reset Recovery

With Dispatch stopped, from `templates/dispatch`:

```bash
DATABASE_URL=pglite:./data/pglite pnpm exec tsx ../../.tmp/team-management-reset-seed-readback.ts
```

[Readback source](../../../../../../../.tmp/team-management-reset-seed-readback.ts) is SELECT-only and closes its connection. It currently checks the **baseline** and intended roster. After the proof deliberately changes these, baseline/roster failure is not automatically a product regression; restore the fixture or use a proof-specific readback of the new expected state. Do not weaken its checks to manufacture a pass.

The seeded org/accounts/team/resource are intentionally retained for the new session. Preserve them until testing is finished. At wrap-up, close only owned tabs and stop only owned runtime processes. If deleting proof fixtures, track exact IDs, clean Better Auth account/session rows as well as framework fixtures, and independently read back absence; earlier cleanup missed auth rows on its first pass.

No second full reset is required. If a later reset is explicitly requested, stop every confirmed owner first, verify the target is the local Dispatch path, and relocate that active database to a new timestamped backup rather than deleting it. Never overwrite the existing backup. Restoring the previous environment would likewise require stopping Dispatch, preserving the current replacement separately, and moving the selected backup back to the active app path. Do not reset files or Git to restore database state.

All seed/evidence files are local `.tmp/` artifacts, not committed deliverables. Do not run `git clean` or delete `.tmp/` before the next session; it would lose the private credentials and evidence.

## Useful Source and Evidence References

- [GroupsSection](../../../../../../../packages/toolkit/src/app/org/GroupsSection.tsx) — member visibility and team controls.
- [Group-list action](../../../../../../../packages/core/src/workspace-connections/actions/list-workspace-user-groups.ts) — returned rosters and membership matching.
- [Org hooks](../../../../../../../packages/core/src/client/org/hooks.ts) — normal invitations and acceptance.
- [Org handlers](../../../../../../../packages/core/src/org/handlers.ts) — authorization and exact-email invitation acceptance.
- [Group mutation boundary](../../../../../../../packages/core/src/workspace-connections/groups.ts) — typed permission rejection.
- [Prior v2 browser report](../../../../../../../.tmp/team-management-browser-v2-evidence-20261005.jsonl) — incomplete producer evidence, not passing raw UI proof.
- [Authentication skill](../../../../../../../.agents/skills/authentication/SKILL.md), [concurrency skill](../../../../../../../.claude/skills/concurrent-agents/SKILL.md), and [verification skill](../../../../../../../.agents/skills/verifying-changes/SKILL.md).

## Next-Session Checklist

- [ ] Read current child/epic and this handover; inspect the canonical seed manifest.
- [ ] Preserve backup, `.tmp/` credentials/evidence, unrelated databases, and dirty checkout.
- [ ] Start one owned local runtime and normally sign in owner/member in separate browser contexts.
- [ ] Resolve or precisely reproduce the rendering discrepancy and establish browser/runtime stability.
- [ ] Capture all three actual UI checks with raw, sanitized evidence; stop on Chrome failure.
- [ ] Independently grade the evidence; do not repeat the policy matrix.
- [ ] Restore or clean only owned proof changes and stop owned runtime/tabs.
- [ ] Leader updates the child/epic honestly; keep Epic 5 gated while any required child remains open.
