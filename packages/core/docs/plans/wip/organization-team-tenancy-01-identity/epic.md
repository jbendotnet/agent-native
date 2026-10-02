# Epic 1: Team identity, roles, and membership

## Problem / Goal

Enable opt-in teams on existing workspace groups without replacing the group grant system. The [accepted ADR](../../../design/organization-team-tenancy.md) is authoritative; [requirements](requirements.md) define this epic's gates.

## Purpose

All later team context and chat authorization depend on reliable current membership, lead roles, and non-reusable group identity.

## Scope / Boundaries

Extend existing group storage/actions. Keep one membership list, allow zero or multiple leads, and preserve ordinary groups. No team/member tables, implicit conversion, deconversion, or tombstone system.

## Current Context

`workspace-connections/groups.ts` owns group persistence and membership checks. Its upsert currently updates a supplied ID then inserts if no row matched. `workspace-connections/migrations.ts` owns migrations. Shared UI also invokes membership updates from `packages/toolkit/src/app/org/MembersSection.tsx`.

## Risks / Dependencies / Open Questions

No product decision remains open. Concurrent writes and stale supplied IDs are concrete risks. Validation must live below individual action wrappers. Later epics consume marked-team/current-membership checks, not active selection.

## Child Plans

Execute in order:

1. [Additive team storage and identity](wip/01-storage-and-identity.md) — I-01, I-04 identity rule.
2. [Role-aware atomic mutations and audit](wip/02-role-aware-mutations.md) — I-02, I-03.
3. [Conversion and deletion compatibility](wip/03-conversion-and-deletion.md) — I-04, I-05.

## Success Criteria

Every direct and bulk mutation enforces current organization authority and the lead/member invariant. Conversion preserves existing grants. Deletion retains bound data and cannot resurrect its ID.
