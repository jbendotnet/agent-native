# Shared team management and context controls

## Problem / Goal

Meet S-04 after Epic 1 roles and Epic 2 resource access. Read [epic](../epic.md), [requirements](../requirements.md), and [ADR](../../../../design/organization-team-tenancy.md).

## Solution

Extend Toolkit's existing org groups surface and shared agent resource editor. Present actions according to current authority, but enforce all permissions on the server. Reuse existing standard controls and avoid a second settings system.

## Implementation Plan

1. Leader: move child/epic to `in-progress/`, repair links, and load `execute-plan`, `frontend-design`, `agent-native-toolkit`, `shadcn-ui`, `internationalization`, `client-methods`, and `concurrent-agents`.

2. <implementation_tranche id="team-management-controls" agent="medium">

   1. Extend `packages/toolkit/src/app/org/GroupsSection.tsx` group queries/editor with team designation and explicit conversion. Owners/admins retain create/delete/full membership/lead controls. Conversion must not reset shares, members, or connection references.
   2. Add a member/lead-accessible view using the existing settings surface rather than simply opening all owner/admin controls. Leads can add existing org members/remove ordinary members only; any current member can open team context. Inspect `MembersSection.tsx` bulk controls so they honor the same capability outputs.
   3. Locate the actual current shared agent resources editor and compose team scope with Epic 2's named helpers. Allow instructions/skills/memory editing without exposing org-default editing to ordinary team members or nonmember admins. Preserve inherited-default and stale-delete behavior.
   4. Use shared dialogs/controls, optimistic changes with rollback, accessible labels, and configured locale catalogs. Display errors from rejected stale permissions; do not pretend a failed mutation saved. Keep density consistent with the repo's no-default-chrome rule.
   5. Add focused existing UI/action tests where appropriate; format changed source with oxfmt and run configured localization guards.

   </implementation_tranche>

3. <implementation_tranche id="team-management-browser-proof" agent="chrome-devtools">

   1. Independently verify create/convert, zero/multiple leads, admin membership removal, lead ordinary-member changes, rejected lead removal, member context editing, and admin-nonmember context denial in the shared settings runtime.
   2. Verify the corresponding agent actions produce the same outcomes. Close owned tabs/processes and return concrete proof or failure evidence to the producer.

   </implementation_tranche>

## Verification

Use `verifying-changes` to select the repository's actual shared Toolkit host; browser proof belongs to `chrome-devtools`. Run affected Toolkit/Core typechecks and focused tests, `pnpm guard:i18n-catalogs`, and `pnpm guard:i18n-changed-copy`. Do not add an unexplained localization ignore/baseline. Hidden controls are not proof of authorization: invoke forbidden actions directly too.
