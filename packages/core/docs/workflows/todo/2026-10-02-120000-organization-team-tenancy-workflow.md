# Organization team tenancy implementation workflow

## Source request

“for each proposed epic, create it with requirements, break the work down into child plans with clear implementation details.”

This files the six-epic roadmap for the [accepted ADR](../../design/organization-team-tenancy.md). It does not authorize implementation, commits, pushes, or deployment in the planning session.

## Assumptions

- Core owns the tenancy contract. Shared Toolkit controls consume it, so this roadmap lives in Core's docs scope rather than creating separate product roadmaps.
- Every document describes future work, not delivered behavior. The ADR controls product decisions; requirements IDs below make the work traceable.
- No new dependency, general resource ownership model, team/member table, resource move, successor ownership, automatic share, or continuous stream revocation is needed.

## Done condition

For later execution: all child-plan proof gates pass, all ten ADR acceptance criteria have recorded evidence, and UI and agent operations use the same authorized action surface. Planning completion alone does not satisfy this condition.

## Verification target

Use `verifying-changes` and `adding-tests-and-ci` for Core runtime and PostgreSQL proof. Use the OpenCode `chrome-devtools` subagent for shared UI proof. An independent verifier must not be the implementation producer. Run focused existing Vitest suites during each slice; run the final actor matrix and relevant guards before release.

## Lifecycle notes

- This file is staged in `todo/` for later execution. Epics and newly filed child plans are in outer and inner `wip/`, respectively, as required by the planning conventions.
- Before execution, load and follow `workflow`, `execute-plan`, `plans-organisation`, and `subagent-delegation`. Move this workflow to `in-progress/`.
- The first child execution moves its whole epic to outer `in-progress/` and that child to inner `in-progress/`. Repair relative links after lifecycle moves, including this index. Move verified children to inner `completed/`; do not mark the entire epic completed without explicit user declaration.
- Each delegation MUST read the current child plan, its parent `epic.md`, `requirements.md`, and the ADR in full. The leader retains sequencing, documentation, state changes, and signoff.
- Read `concurrent-agents` before edits. Preserve unrelated work. Recheck current source: the October 2 inventory found index line drift, so function names and actual files take precedence over stale indexed line numbers.

## Sequential tranches

1. <tranche id="team-identity" owner="leader">

   MUST load and follow `execute-plan` to execute the three children of [Epic 1](../../plans/wip/organization-team-tenancy-01-identity/epic.md) in order. Delegate implementation to `medium`; verify PostgreSQL mutation invariants and conversion/deletion compatibility before proceeding. No UI may expose team creation before those gates pass.

   </tranche>

2. <tranche id="conversation-security" owner="leader">

   MUST load and follow `execute-plan` for [Epic 3](../../plans/wip/organization-team-tenancy-03-authorization/epic.md): immutable creation binding and direct/list policy, public token exclusion, then linked-run/background access. These protections precede exposing bound conversation creation or team shares. Verify denial after current membership changes, not only initial grants.

   </tranche>

3. <tranche id="team-context" owner="leader">

   MUST load and follow `execute-plan` for [Epic 2](../../plans/wip/organization-team-tenancy-02-context/epic.md): member-authorized resource operations, then prompt precedence and labeled memory. A required team lookup failure must stop the turn. Binding comes from Epic 3, never from the active preference on a later turn.

   </tranche>

4. <tranche id="selection-and-management" owner="leader">

   MUST load and follow `execute-plan` for [Epic 4](../../plans/wip/organization-team-tenancy-04-selection-ux/epic.md): durable user/org selection, management/context controls, then new-chat selection and binding display. MUST follow `frontend-design`, `agent-native-toolkit`, `client-methods`, and `internationalization` for UI work. Browser proof covers multi-session selection, switching organizations, and draft versus persisted threads.

   </tranche>

5. <tranche id="explicit-team-work" owner="leader">

   MUST load and follow `execute-plan` for [Epic 5](../../plans/wip/organization-team-tenancy-05-sharing/epic.md): owner-only viewer grant/revoke and paginated list, then shared-work UI. Recheck generic sharing cannot bypass chat policy and private bound work never appears in the list.

   </tranche>

6. <tranche id="compatibility-and-release-proof" owner="leader">

   MUST load and follow `execute-plan` for [Epic 6](../../plans/wip/organization-team-tenancy-06-compatibility-release/epic.md). Consolidate actor and revocation evidence, docs/translations, changesets, and relevant checks. Shipping is a separate authorized action through `ship`; this workflow neither requests a merge nor claims deployed health.

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
