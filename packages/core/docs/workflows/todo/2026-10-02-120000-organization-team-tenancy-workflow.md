# Organization team tenancy implementation workflow

## Source request

“for each proposed epic, create it with requirements, break the work down into child plans with clear implementation details.”

This files the six-epic roadmap for the [accepted ADR](../../design/organization-team-tenancy.md). It does not authorize implementation, commits, pushes, or deployment in the planning session.

## Assumptions

- Core owns the tenancy contract. Shared Toolkit controls consume it, so this roadmap lives in Core's docs scope rather than creating separate product roadmaps.
- The ADR controls product decisions; requirements IDs below make the work traceable. Epic 1's completed children record delivered identity behavior. Epic 2 records verified authorization behavior. Epic 3 is complete with verified resource operations and bound prompt context. Epic 4 is complete with verified selection and management UX. Epic 5 is complete with verified sharing behavior. Epic 6 is complete: both the local acceptance matrix and documentation/release-readiness handoff have independent proof. The separate Content DB suite retains 16 unresolved failures; release and deployment approval are not implied.
- No new dependency, general resource ownership model, team/member table, resource move, successor ownership, automatic share, or continuous stream revocation is needed.

## Done condition

For later execution: all child-plan proof gates pass, all ten ADR acceptance criteria have recorded evidence, and UI and agent operations use the same authorized action surface. Planning completion alone does not satisfy this condition.

## Verification target

Use `verifying-changes` and `adding-tests-and-ci` for Core runtime and PostgreSQL proof. Use the OpenCode `chrome-devtools` subagent for shared UI proof. An independent verifier must not be the implementation producer. Run focused existing Vitest suites during each slice; run the final actor matrix and relevant guards before release.

## Lifecycle notes

- This file remains in `todo/` because execution was requested for individual child plans, not this whole workflow. Epic 1's status records reopening at the user's request on 2026-10-02, although its directory is currently filed in outer `completed/`. Its storage, role-policy, and lifecycle children are implemented and independently verified in inner `completed/`. Epic 2 was completed at the user's request on 2026-10-03 and is filed in outer `completed/`, preserving its three completed children. Epic 3 was completed at the user's request on 2026-10-03 and is filed in outer `completed/`, preserving both independently verified children; its proof gates satisfy the context prerequisite for Epic 4. Epic 4 was completed at the user's request on 2026-10-06 and is filed in outer `completed/`, preserving its three completed children and handover. Its proof gates clear the selection/management prerequisite for Epic 5, which is complete. Epic 6 was completed at the user's request on 2026-10-08 and is filed in outer `completed/`, preserving both completed children and their evidence. Its scoped local handoff does not claim unrestricted release approval or deployed health.
- Before execution, load and follow `workflow`, `execute-plan`, `plans-organisation`, and `subagent-delegation`. Move this workflow to `in-progress/`.
- The first child execution moves its whole epic to outer `in-progress/` and that child to inner `in-progress/`. Repair relative links after lifecycle moves, including this index. Move verified children to inner `completed/`; do not mark the entire epic completed without explicit user declaration.
- Each delegation MUST read the current child plan, its parent `epic.md`, `requirements.md`, and the ADR in full. The leader retains sequencing, documentation, state changes, and signoff.
- Read `concurrent-agents` before edits. Preserve unrelated work. Recheck current source: the October 2 inventory found index line drift, so function names and actual files take precedence over stale indexed line numbers.

## Sequential tranches

Execute whole epics in numerical order: identity → authorization → context → selection UX → sharing → compatibility proof. Every child and independent proof gate owned by an epic must pass before the next epic starts. Epic 1's retained-binding integration proof belongs to Epic 6, after authorization and context exist; it remains a release gate, not an Epic 2 start prerequisite. A later epic consumes a completed contract, not partial work. Keep requirement IDs unchanged: I, A, C, S, H, R. Lifecycle completion still requires the explicit user declaration described above.

1. <tranche id="team-identity" owner="leader">

   [Epic 1](../../plans/completed/organization-team-tenancy-01-identity/epic.md) has three completed, independently verified children. Preserve their storage, role-policy, and conversion/deletion contracts. Retained-binding integration proof remains assigned to Epic 6 before release. No UI may expose team creation before the mutation and compatibility gates pass.

   </tranche>

2. <tranche id="conversation-security" owner="leader">

   [Epic 2](../../plans/completed/organization-team-tenancy-02-authorization/epic.md) is complete: immutable creation binding and direct/list policy, public token exclusion, and linked-run/background access. Its 16-file, 209-test authorization matrix covers internal creation inputs, linked-run fixtures, seeded existing group-share rows, and denial after current membership changes. Epic 3 has replaced the temporary bound-execution rejection with required context loading; user/agent bound creation is exposed only in Epic 4. Later context, UI, and share actions are not prerequisites for Epic 2 completion.

   </tranche>

3. <tranche id="team-context" owner="leader">

   [Epic 3](../../plans/completed/organization-team-tenancy-03-context/epic.md) is complete: member-authorized resource operations, prompt precedence, and labeled memory. Binding and current-access checks come from completed Epic 2, never from the active preference on a later turn. Required context loads in normal/background paths, replacing the pre-context execution denial. A required team lookup failure stops the turn. Context proof does not depend on selection UI or share actions; the authorization matrix was rerun before completion.

   [C-01 resource operations](../../plans/completed/organization-team-tenancy-03-context/completed/01-team-resource-access.md) completed with independent 7-file/515-test proof, Core typecheck, and scoped formatting on 2026-10-03. Proof covers mounted HTTP and callable agent operations with the real membership assertion and mocked storage. [C-02–C-04 bound prompt context](../../plans/completed/organization-team-tenancy-03-context/completed/02-bound-prompt-context.md) completed with independent 25-file/792-test context and authorization proof, plus assembled normal/background prompt and failed-turn review. Both context children pass; the epic was explicitly completed on 2026-10-03. Live PostgreSQL, deployment, and retained-binding release integration remain unproved.

   </tranche>

4. <tranche id="selection-and-management" owner="leader">

   [Epic 4](../../plans/completed/organization-team-tenancy-04-selection-ux/epic.md) is complete: durable user/org selection, management/context controls, and new-chat selection with stable binding display. Shared UI and agent operations use the authorized Core action surface.

   Completion status, 2026-10-06: all three children and their independent local proof gates passed. Team management covers rejected-save recovery with visible failure, retained unsaved text, and unchanged stored instructions. New-chat proof covers first-send context, stable A/B/no-team bindings, mounted refresh, denied creation, and per-organization switching/reload restoration. The authorized disposable second organization was deleted and original state restored. The user-requested runtime and page 21 remain open. Epic 5's prerequisite is clear; full V1 release and deployed acceptance remain separate.

   </tranche>

5. <tranche id="explicit-team-work" owner="leader">

   [Epic 5](../../plans/completed/organization-team-tenancy-05-sharing/epic.md) is complete: owner-only viewer grant/revoke, paginated explicit-share discovery, shared Toolkit controls, and read-only linked-run UI. Independent local proof passed 224 Core tests, 45 Toolkit tests, 27 Chat tests, three PostgreSQL contention tests, and authenticated browser/action/SQL checks for private-work exclusion and lifecycle denial. The follow-on [PR #9](https://github.com/jbendotnet/agent-native/pull/9) is stacked on PR #6 and remains unmerged. Epic 6 records the combined local handoff separately from hosted and full V1 release acceptance.

   </tranche>

6. <tranche id="compatibility-and-release-proof" owner="leader">

   [Epic 6](../../plans/completed/organization-team-tenancy-06-compatibility-release/epic.md) is complete. It consolidates actor and revocation evidence, docs/translations, changesets, and relevant checks. Shipping is a separate authorized action; this workflow neither requests a merge nor claims deployed health.

   Child 1 is complete with independently passing local evidence for all ten
   ADR criteria (355 Core and 5 Toolkit matrix tests). [Acceptance evidence](../../plans/completed/organization-team-tenancy-06-compatibility-release/acceptance-evidence.md)
   records the recovery review, successful complete fast-suite run, typecheck,
   85 child-base guards, and explicit performance checks. Child 2 is complete;
   [release readiness](../../plans/completed/organization-team-tenancy-06-compatibility-release/release-readiness.md)
   records the public docs, all ten locales, package/docs builds, focused tests,
   and independent checks. Sixteen separate Content DB failures remain unresolved.
   No unrestricted release approval or deployment is claimed.

   </tranche>

## ADR acceptance coverage

Numbering follows the ten bullets in the ADR's V1 acceptance criteria.

| ADR criterion                                            | Owning requirements    | Final proof                                            |
| -------------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| 1. Old groups/threads unchanged; conversion keeps grants | I-01, I-04, A-01, R-01 | Migration, conversion, legacy access fixtures          |
| 2. Owner/admin and lead roles, including bulk            | I-02, I-03             | Direct/bulk actor matrix and concurrent updates        |
| 3. Durable selection per user/org                        | S-01, S-02             | Two sessions/devices, organization switch              |
| 4. Stable bound context and deterministic precedence     | C-02, C-03, A-01, S-03 | Conflicting instructions/skills and two-team turns     |
| 5. Former member/owner denied; private stays private     | A-02, H-02             | Direct/list/search/cache and continuation              |
| 6. Owner-only allowed-team viewer sharing                | H-01, H-02             | All roles/authorities plus generic bypass attempts     |
| 7. Public issuance/redemption denial                     | A-03                   | Indexed and legacy tokens, public transcript/runs      |
| 8. Fresh run request denial; existing stream may finish  | A-04                   | Every route, replay/reconnect, background, open stream |
| 9. Deletion strands bindings/context, not unrelated data | I-04, C-01, A-02       | Delete team; inspect retained rows and denied requests |
| 10. Failed lookup not empty context/success              | C-04, A-04             | Fault injection, no successful response or fallback    |

## Stop conditions

Stop only for missing access, an unsafe/destructive action, or a new product decision outside the accepted ADR. Route ordinary test failures back to the producing tranche and independently reverify. Keep implementation state in progress until proof passes. Do not weaken guards or silently turn failed authorization into normal empty data.
