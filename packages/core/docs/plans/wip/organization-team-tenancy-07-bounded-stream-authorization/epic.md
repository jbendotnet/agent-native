# Epic 7: Bounded run-stream authorization

## Problem / Goal

Replace unbounded access on already-open run streams with an approved, implemented, and independently proven viewer authorization lease. See [requirements](requirements.md).

## Purpose

The completed six-PR tenancy stack implements the original connection-scoped contract. Steve's [review request](https://github.com/BuilderIO/agent-native/pull/5777#issuecomment-6081437360) requires bounded active-stream authorization and an owning framework follow-up. This epic owns that additional work without reopening Epics 2 or 6.

## Scope / Boundaries

Implement the framework-wide [lease contract](../../../design/durable-agent-runs.md#bounded-viewer-authorization-leases) and its [tenancy amendment](../../../design/organization-team-tenancy.md#proposed-stream-policy-amendment-2026-10-10). Cover all authorized run subscriptions, including linked, non-team, standalone, and supported public policies. Preserve their access rights while changing stream enforcement.

The proposed design sections live in [design PR #5777](https://github.com/BuilderIO/agent-native/pull/5777), not on the Epic 6 base. The links pin the reviewed design revision. Design approval and integration remain dependencies of implementation, not claims of this planning PR.

Close the viewer subscription, not the producing run. Include fresh policy decisions, the final delivery gate, reconnect behavior, compatibility proof, and release documentation. No distributed invalidation channel, separate run sharing, timing configuration framework, or unrelated tenancy changes.

## Current Context

Epics 1–6 are complete in the existing stacked PR series. Their documents on earlier branches retain the original requirements and proof gates. Completion of that baseline does not prove the new lease.

The design amendment remains proposed. Its 10-second lease and 5-second renewal interval require policy approval. The design docs do not link to concrete plans. Planning and PR discussion provide the follow-up links instead.

## Risks / Dependencies / Open Questions

Base the implementation branch and seventh PR on the final branch of the existing six-PR stack. Do not insert this work beneath completed PRs or make earlier epics depend on it. Recheck their integrated source and evidence at execution time.

Approve the duration, renewal interval, disclosure window, and fail-closed behavior before runtime acceptance. Measure authorization cost and prove coherent policy reads and the final writer boundary. Neither complete session validation nor a common final writer is an established existing capability.

Design approval, runtime completion, and amended V1 release are separate gates. Release under the amended contract requires this epic's implementation and independent proof. This planning change does not publish a follow-up, modify the PR stack, or authorize shipping.

## Work Areas

1. Record policy approval and the exposure/availability tradeoff.
2. Implement the shared lease and current tenancy-policy integration.
3. Independently prove revocation and compatibility against the final stack.
4. Update release documentation, configured translations, and package metadata from actual behavior.

## Child Plans

1. [Shared runtime authorization and proof](wip/01-bounded-stream-authorization.md) — S-01–S-04. Moved from the earlier draft Epic 2 child, not a new dependency for that completed epic.

## Completion / Handoff

The leader owns S-05 after the runtime child passes independent verification. Keep this completion work in Epic 7, not Epic 6.

1. Record the child's authorization-cost measurements and independent compatibility evidence beside this epic. Map each S-01–S-04 gate to its command and result.
2. Update public reference docs and configured translations from the implemented contract. Include the final-write bound, fail-closed behavior, transport-byte limitation, and viewer/producer distinction.
3. Include the required package changeset. Record an app changelog only for an actual user-facing template change. Run the relevant documentation and localization guards.
4. Obtain independent review of the evidence, documentation, translations, and release metadata. Resolve failures before completing S-05.
5. When publication is authorized, publish the owning follow-up and link its URL in the PR discussion. Until then, report this plan as local and that part of Steve's request as open.

S-05 is complete only with the recorded evidence, passing documentation checks, independent review, and published follow-up URL. Keep policy approval, local proof, and CI/deployment status separate. This gate does not authorize a merge or deployment.

## Success Criteria

All S-01–S-05 gates pass. Evidence records approved timing, final-write measurements, fault cases, compatibility, producer continuity, and authorization cost. Documentation distinguishes the approved target from shipped behavior. The owning follow-up is published and linked in the PR discussion before claiming Steve's request is fully addressed.
