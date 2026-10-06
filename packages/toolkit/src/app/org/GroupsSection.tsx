import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { useShareOrgMemberSearch } from "@agent-native/core/client/sharing/share-controller-helpers";
import type { WorkspaceUserGroup } from "@agent-native/core/workspace-connections/groups";
import { Skeleton } from "@agent-native/toolkit/design-system";
import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@agent-native/toolkit/ui/empty";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@agent-native/toolkit/ui/input-group";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  IconPencil,
  IconPlus,
  IconUsersGroup,
  IconSearch,
  IconDots,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import { SettingsRow } from "../settings/SettingsRow.js";
import {
  DialogErrorAlert,
  PendingLabel,
  SectionTooltipProvider,
} from "./TeamPrimitives.js";

const EMPTY_MEMBER_EMAILS: string[] = [];

export function WorkspaceGroupEditor({
  open,
  group,
  initialMemberEmails = EMPTY_MEMBER_EMAILS,
  canManageAll = true,
  onClose,
}: {
  open: boolean;
  group: WorkspaceUserGroup | null;
  initialMemberEmails?: string[];
  canManageAll?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const nameId = useId();
  const peopleId = useId();
  const [name, setName] = useState("");
  const [isTeam, setIsTeam] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const memberSearch = useShareOrgMemberSearch(search, open, { limit: 100 });
  const saveGroup = useActionMutation("upsert-workspace-user-group");
  const updateMembers = useActionMutation("bulk-update-workspace-user-groups");
  const [saveError, setSaveError] = useState<unknown>(null);
  const selected = useMemo(
    () => new Set(members.map((email) => email.toLowerCase())),
    [members],
  );

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setIsTeam(group?.isTeam ?? false);
    setMembers(group?.memberEmails ?? initialMemberEmails);
    setSearch("");
    setSaveError(null);
  }, [group, initialMemberEmails, open]);

  const searchMembers = memberSearch.members.map((member) => ({
    email: member.email.toLowerCase(),
    name: member.name,
  }));
  const selectedMembersNotInSearch = members
    .map((email) => email.toLowerCase())
    .filter((email) => !searchMembers.some((member) => member.email === email))
    .map((email) => ({ email, name: undefined }));
  const visibleMembers = [...selectedMembersNotInSearch, ...searchMembers];

  function toggleMember(email: string, checked: boolean) {
    const normalized = email.trim().toLowerCase();
    setMembers((current) =>
      checked
        ? Array.from(new Set([...current, normalized]))
        : current.filter((value) => value !== normalized),
    );
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || saveGroup.isPending || updateMembers.isPending) return;
    setSaveError(null);
    if (!canManageAll) return;
    saveGroup.mutate(
      {
        ...(group?.id ? { id: group.id } : {}),
        name: trimmedName,
        memberEmails: members,
        ...(!group?.isTeam && isTeam ? { isTeam: true } : {}),
      },
      { onSuccess: onClose, onError: setSaveError },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <form className="grid gap-4" onSubmit={save}>
          <DialogHeader>
            <DialogTitle>
              {group
                ? t("org.editGroup", { defaultValue: "Edit group" })
                : t("org.createGroup", { defaultValue: "Create group" })}
            </DialogTitle>
          </DialogHeader>
          {canManageAll ? (
            <div className="grid gap-2">
              <Label htmlFor={nameId}>
                {t("org.groupName", { defaultValue: "Group name" })}
              </Label>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Rev Ops"
                autoComplete="off"
                autoFocus
              />
            </div>
          ) : null}
          {canManageAll && !group?.isTeam ? (
            <label
              className="flex items-center gap-2 text-sm"
              htmlFor={`${nameId}-team`}
            >
              <Checkbox
                id={`${nameId}-team`}
                checked={isTeam}
                onCheckedChange={(value) => setIsTeam(value === true)}
              />
              {t("agentChat.settingsResources.designateTeam")}
            </label>
          ) : null}
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={peopleId}>
                {t("org.groupMembers", { defaultValue: "People" })}
              </Label>
              <span className="text-sm tabular-nums text-muted-foreground">
                {members.length}
              </span>
            </div>
            <InputGroup>
              <InputGroupInput
                id={peopleId}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("org.searchPeople", {
                  defaultValue: "Search people",
                })}
                autoComplete="off"
              />
              <InputGroupAddon>
                <IconSearch aria-hidden="true" />
              </InputGroupAddon>
            </InputGroup>
            <div
              className="h-64 overflow-y-auto rounded-md border border-border p-1"
              aria-busy={memberSearch.isLoading}
            >
              {memberSearch.isLoading ? (
                <div className="grid gap-1">
                  {["w-40", "w-52", "w-36", "w-48"].map((width) => (
                    <div
                      key={width}
                      className="flex h-9 items-center justify-between gap-3 px-3"
                    >
                      <Skeleton className={`h-3.5 ${width}`} />
                      <Skeleton className="size-4 rounded-sm" />
                    </div>
                  ))}
                </div>
              ) : visibleMembers.length > 0 ? (
                visibleMembers.map((member) => (
                  <label
                    key={member.email}
                    htmlFor={`workspace-group-member-${member.email}`}
                    className="flex h-9 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 hover:bg-accent"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {member.name || member.email}
                    </span>
                    <Checkbox
                      id={`workspace-group-member-${member.email}`}
                      checked={selected.has(member.email)}
                      disabled={
                        updateMembers.isPending ||
                        (!canManageAll &&
                          group?.leadEmails.includes(member.email))
                      }
                      onCheckedChange={(value) => {
                        if (canManageAll)
                          return toggleMember(member.email, value === true);
                        if (!group) return;
                        const previous = members;
                        setSaveError(null);
                        toggleMember(member.email, value === true);
                        updateMembers.mutate(
                          {
                            groupId: group.id,
                            memberEmails: [member.email],
                            operation: value === true ? "add" : "remove",
                          },
                          {
                            onSuccess: (updated) =>
                              setMembers(updated.memberEmails),
                            onError: (error) => {
                              setMembers(previous);
                              setSaveError(error);
                            },
                          },
                        );
                      }}
                      aria-label={member.email}
                    />
                  </label>
                ))
              ) : (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {t("org.noPeopleFound", { defaultValue: "No people found" })}
                </p>
              )}
            </div>
            {memberSearch.hasMore ? (
              <ToolkitButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={memberSearch.loadMore}
                disabled={memberSearch.isLoadingMore}
                className="justify-self-start"
              >
                {t("org.loadMorePeople", { defaultValue: "Load more" })}
              </ToolkitButton>
            ) : null}
            {memberSearch.error ? (
              <p className="text-sm text-destructive">
                {t("agentChat.share.loadPeopleFailed")}
              </p>
            ) : null}
          </div>
          <DialogErrorAlert error={saveError} />
          <DialogFooter>
            <ToolkitButton type="button" variant="secondary" onClick={onClose}>
              {t("org.cancel")}
            </ToolkitButton>
            {canManageAll ? (
              <ToolkitButton
                type="submit"
                disabled={!name.trim() || saveGroup.isPending}
              >
                <PendingLabel
                  pending={saveGroup.isPending}
                  label={t("org.saveGroup", { defaultValue: "Save group" })}
                  pendingLabel={t("agentChat.common.saving")}
                />
              </ToolkitButton>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteGroupDialog({
  group,
  onOpenChange,
}: {
  group: WorkspaceUserGroup | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const deleteGroup = useActionMutation("delete-workspace-user-group");
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const canConfirm = group !== null && confirmText.trim() === group.name.trim();

  const groupId = group?.id;
  useEffect(() => {
    setConfirmText("");
    setDeleteError(null);
  }, [groupId]);

  return (
    <Dialog open={group !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!group || !canConfirm || deleteGroup.isPending) return;
            setDeleteError(null);
            deleteGroup.mutate(
              { id: group.id },
              { onSuccess: () => onOpenChange(false), onError: setDeleteError },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("org.deleteGroup", { defaultValue: "Delete group?" })}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`workspace-delete-group-name-${groupId}`}>
              {t("org.deleteGroupConfirm", { name: group?.name ?? "" })}
            </Label>
            <Input
              id={`workspace-delete-group-name-${groupId}`}
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={t("org.groupName", { defaultValue: "Group name" })}
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogErrorAlert error={deleteError} />
          <DialogFooter>
            <ToolkitButton
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              {t("org.cancel")}
            </ToolkitButton>
            <ToolkitButton
              type="submit"
              variant="destructive"
              disabled={!canConfirm || deleteGroup.isPending}
            >
              <PendingLabel
                pending={deleteGroup.isPending}
                label={t("org.delete", { defaultValue: "Delete" })}
                pendingLabel={t("org.deleting", { defaultValue: "Deleting…" })}
              />
            </ToolkitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TeamLeadsDialog({
  group,
  onClose,
}: {
  group: WorkspaceUserGroup | null;
  onClose: () => void;
}) {
  const t = useT();
  const [leads, setLeads] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const setTeamLeads = useActionMutation("set-workspace-team-leads");
  useEffect(() => {
    setLeads(group?.leadEmails ?? []);
    setError(null);
  }, [group]);

  return (
    <Dialog
      open={group !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("agentChat.settingsResources.manageLeads")}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto">
          {group?.memberEmails.map((email) => (
            <label key={email} className="flex items-center gap-2 py-2 text-sm">
              <Checkbox
                checked={leads.includes(email)}
                onCheckedChange={(checked) =>
                  setLeads((current) =>
                    checked === true
                      ? [...current, email]
                      : current.filter((item) => item !== email),
                  )
                }
                aria-label={t("agentChat.settingsResources.leadFor", { email })}
              />
              {email}
            </label>
          ))}
        </div>
        <DialogErrorAlert error={error} />
        <DialogFooter>
          <ToolkitButton variant="secondary" onClick={onClose}>
            {t("org.cancel")}
          </ToolkitButton>
          <ToolkitButton
            disabled={!group || setTeamLeads.isPending}
            onClick={() => {
              if (!group) return;
              setError(null);
              setTeamLeads.mutate(
                { teamGroupId: group.id, leadEmails: leads },
                {
                  onSuccess: onClose,
                  onError: (failure) => {
                    setLeads(group.leadEmails);
                    setError(failure);
                  },
                },
              );
            }}
          >
            {t("org.save")}
          </ToolkitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceGroupsCard({
  groups,
  onNewGroup,
  onEditGroup,
  emptyMessage,
  canManageAll = true,
  currentUserEmail = "",
}: {
  groups: WorkspaceUserGroup[];
  onNewGroup: () => void;
  onEditGroup: (group: WorkspaceUserGroup) => void;
  /** The empty state's description when there are no groups. */
  emptyMessage?: string;
  canManageAll?: boolean;
  currentUserEmail?: string;
}) {
  const t = useT();
  const [deleting, setDeleting] = useState<WorkspaceUserGroup | null>(null);
  const [editingLeads, setEditingLeads] = useState<WorkspaceUserGroup | null>(
    null,
  );
  const newGroupLabel = t("org.newGroup", { defaultValue: "New group" });

  return (
    <section className="scroll-mt-16">
      <header className="mb-2.5 flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("org.groups", { defaultValue: "Groups" })}
        </h2>
        {canManageAll && groups.length > 0 ? (
          <ToolkitButton
            type="button"
            variant="outline"
            size="xs"
            onClick={onNewGroup}
          >
            <IconPlus />
            {newGroupLabel}
          </ToolkitButton>
        ) : null}
      </header>
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground">
        {groups.length > 0 ? (
          groups.map((group) => (
            <SettingsRow
              key={group.id}
              icon={<IconUsersGroup />}
              label={group.name}
              description={
                group.isTeam ? t("agentChat.settingsResources.team") : undefined
              }
              control={
                <div className="flex items-center gap-1">
                  {canManageAll ||
                  (group.isTeam &&
                    group.leadEmails.includes(currentUserEmail)) ? (
                    <ToolkitButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onEditGroup(group)}
                      aria-label={t("org.editGroupAria", {
                        defaultValue: "Edit group {{name}}",
                        name: group.name,
                      })}
                    >
                      <IconPencil />
                    </ToolkitButton>
                  ) : null}
                  {canManageAll && group.isTeam ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <ToolkitButton
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t(
                            "agentChat.settingsResources.groupActions",
                            {
                              name: group.name,
                            },
                          )}
                        >
                          <IconDots />
                        </ToolkitButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setEditingLeads(group)}
                        >
                          {t("agentChat.settingsResources.manageLeads")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                  {canManageAll ? (
                    <ToolkitButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleting(group)}
                      aria-label={t("org.deleteGroupAria", {
                        name: group.name,
                      })}
                    >
                      <IconTrash />
                    </ToolkitButton>
                  ) : null}
                </div>
              }
            />
          ))
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconUsersGroup />
              </EmptyMedia>
              <EmptyTitle>
                {t("org.noGroups", { defaultValue: "No groups yet" })}
              </EmptyTitle>
              {emptyMessage ? (
                <EmptyDescription>{emptyMessage}</EmptyDescription>
              ) : null}
            </EmptyHeader>
            {canManageAll ? (
              <EmptyContent>
                <ToolkitButton type="button" size="sm" onClick={onNewGroup}>
                  <IconPlus />
                  {newGroupLabel}
                </ToolkitButton>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </div>
      <DeleteGroupDialog
        group={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
      <TeamLeadsDialog
        group={editingLeads}
        onClose={() => setEditingLeads(null)}
      />
    </section>
  );
}

export function useWorkspaceUserGroups(enabled: boolean) {
  return useActionQuery<WorkspaceUserGroup[]>(
    "list-workspace-user-groups",
    {},
    { enabled },
  );
}

export interface WorkspaceGroupEditorController {
  openGroupEditor: (
    group: WorkspaceUserGroup | null,
    memberEmails?: string[],
  ) => void;
  dialogProps: {
    open: boolean;
    group: WorkspaceUserGroup | null;
    initialMemberEmails: string[];
    canManageAll?: boolean;
    onClose: () => void;
  };
}

/**
 * Owns the group editor dialog that the members table ("create group from
 * selection") and the groups list share. When both sections render on one
 * page, pass them the same controller so they open a single dialog.
 */
export function useWorkspaceGroupEditor(): WorkspaceGroupEditorController {
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<WorkspaceUserGroup | null>(
    null,
  );
  const [initialGroupMembers, setInitialGroupMembers] = useState<string[]>([]);

  function openGroupEditor(
    group: WorkspaceUserGroup | null,
    memberEmails: string[] = [],
  ) {
    setEditingGroup(group);
    setInitialGroupMembers(memberEmails);
    setGroupEditorOpen(true);
  }

  function closeGroupEditor() {
    setGroupEditorOpen(false);
    setEditingGroup(null);
    setInitialGroupMembers([]);
  }

  return {
    openGroupEditor,
    dialogProps: {
      open: groupEditorOpen,
      group: editingGroup,
      initialMemberEmails: initialGroupMembers,
      onClose: closeGroupEditor,
    },
  };
}

/** Workspace user groups and marked team membership in organization settings. */
export function GroupsSection({
  groupEditor,
  emptyMessage,
}: {
  groupEditor?: WorkspaceGroupEditorController;
  /** Replaces "No groups yet" when there are no groups. */
  emptyMessage?: string;
}) {
  const t = useT();
  const { data: org } = useOrg();
  const isOwnerOrAdmin = org?.role === "owner" || org?.role === "admin";
  const groupsQuery = useWorkspaceUserGroups(Boolean(org?.orgId));
  const ownGroupEditor = useWorkspaceGroupEditor();
  const editor = groupEditor ?? ownGroupEditor;

  if (!org?.orgId) return null;
  const email = org.email.trim().toLowerCase();
  const visibleGroups = isOwnerOrAdmin
    ? (groupsQuery.data ?? [])
    : (groupsQuery.data ?? []).filter(
        (group) => group.isTeam && group.memberEmails.includes(email),
      );

  return (
    <SectionTooltipProvider>
      {groupsQuery.isLoading && !groupsQuery.data ? (
        <div className="grid gap-2" aria-busy="true">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : groupsQuery.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-sm text-destructive"
        >
          {groupsQuery.error?.message ?? t("org.loadErrorFallback")}
          <ToolkitButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void groupsQuery.refetch()}
          >
            {t("org.tryAgain")}
          </ToolkitButton>
        </div>
      ) : (
        <WorkspaceGroupsCard
          groups={visibleGroups}
          onNewGroup={() => editor.openGroupEditor(null)}
          onEditGroup={(group) => editor.openGroupEditor(group)}
          canManageAll={isOwnerOrAdmin}
          currentUserEmail={email}
          emptyMessage={emptyMessage}
        />
      )}
      <WorkspaceGroupEditor
        {...editor.dialogProps}
        canManageAll={isOwnerOrAdmin}
      />
    </SectionTooltipProvider>
  );
}
