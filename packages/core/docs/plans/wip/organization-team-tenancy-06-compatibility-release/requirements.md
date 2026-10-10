# Epic 6 requirements

Source: [accepted ADR](../../../design/organization-team-tenancy.md) and the coordinator workflow's ten-row acceptance map.

| ID   | Requirement                                                                                                                                                                                                                                          | Acceptance evidence                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| R-01 | Ordinary groups, legacy null-bound threads, existing shares/connections, and unsupported resource families preserve behavior. Conversion retains identity/grants; deletion retains bound rows/context but ends access; no ID reuse/backfill/cascade. | Seed old schema/records; migrate; compare before/after data and access.          |
| R-02 | All ADR criteria are verified across direct/list/search/cache, agent/UI, prompt, public, run/service/controller/background paths using current membership and owner/viewer separation.                                                               | Recorded actor/revocation matrix, fault injection, open stream versus reconnect. |
| R-03 | Publishable changes have changesets; public APIs/actions/docs explain V1 limits and localizations match source changes. Relevant checks pass or failures are explicitly unresolved.                                                                  | Changeset/docs diff, focused tests/typechecks/guards, honest release handoff.    |

No deployment claim without deployment proof. No routine ship/merge permission is implied by this planning request. Record a template app changelog only if implementation changes that app's user-facing behavior; shared refactors alone do not invent app entries.
