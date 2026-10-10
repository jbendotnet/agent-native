# Epic 4: Durable team selection and management UX

## Problem / Goal

Make team management, context editing, and new-conversation selection usable through shared UI and agent actions. Follow the [accepted ADR](../../../design/organization-team-tenancy.md) and [requirements](requirements.md).

## Scope / Boundaries

Selection is a per-user/per-org preference, not authorization. Existing conversations retain their binding. Extend shared Toolkit settings/chat rather than build separate app-specific team systems.

## Current Context

Core `settings/user-settings.ts` provides user-scoped settings. Application state is session-keyed. Toolkit `GroupsSection.tsx` is owner/admin-only; `MembersSection.tsx` also changes group membership. `use-chat-threads.ts` creates optimistic local drafts before actual server insertion.

## Dependencies / Risks

Start only after all children and proof gates in Epics 1–3 pass: Epic 1 roles, Epic 2 complete thread/run/token security, and Epic 3 prompt/resource authorization. Complete all three selection/management children before Epic 5 starts. Draft creation must not be confused with durable creation. Exact resource-editor placement should follow the existing shared agent settings surface, not an invented new panel.

## Child Plans

1. [Durable selection and session mirror](wip/01-durable-selection.md) — S-01/S-02.
2. [Team management and context editing](wip/02-team-management-ui.md) — S-04.
3. [New-chat selection and stable binding display](wip/03-new-chat-selection.md) — S-03.

## Success Criteria

The user's choice survives sessions and restores per organization. Authorized roles can manage their permitted operations. New chats bind once; changing selection cannot alter an existing conversation's context or access.
