// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  useActionMutation: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: mocks.useActionMutation,
  useActionQuery: () => ({ data: [] }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: { orgId: "org-1", role: "member", email: "lead@example.test" },
  }),
}));
vi.mock("@agent-native/core/client/sharing/share-controller-helpers", () => ({
  useShareOrgMemberSearch: () => ({
    members: [{ email: "new@example.test", name: "New member" }],
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: false,
  }),
}));

import { WorkspaceGroupEditor, WorkspaceGroupsCard } from "./GroupsSection.js";

const team = {
  id: "team-1",
  orgId: "org-1",
  name: "Engineering",
  isTeam: true,
  memberEmails: ["lead@example.test", "member@example.test"],
  leadEmails: ["lead@example.test"],
  createdByEmail: "admin@example.test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("team controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.useActionMutation.mockImplementation(() => ({
      mutate: mocks.mutate,
      isPending: false,
      error: null,
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps group deletion and lead appointment unavailable to ordinary members", () => {
    act(() =>
      root.render(
        <WorkspaceGroupsCard
          groups={[team]}
          canManageAll={false}
          currentUserEmail="member@example.test"
          onNewGroup={vi.fn()}
          onEditGroup={vi.fn()}
        />,
      ),
    );
    expect(
      document.querySelector('[aria-label="Delete group Engineering"]'),
    ).toBeNull();
    expect(
      document.querySelector('[aria-label="Actions for Engineering"]'),
    ).toBeNull();
    expect(
      document.querySelector('[aria-label="Edit group Engineering"]'),
    ).toBeNull();
  });

  it("converts only on an explicit team choice while keeping the group id and members", () => {
    const group = { ...team, isTeam: false, leadEmails: [] };
    act(() =>
      root.render(
        <WorkspaceGroupEditor open group={group} onClose={vi.fn()} />,
      ),
    );
    const checkbox = document.querySelector<HTMLElement>(
      '[role="checkbox"][id$="-team"]',
    );
    expect(checkbox).not.toBeNull();
    act(() => checkbox?.click());
    act(() =>
      document
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: team.id,
        isTeam: true,
        memberEmails: team.memberEmails,
      }),
      expect.any(Object),
    );
  });

  it("sends one lead membership change at a time and shows server rejection", () => {
    mocks.mutate.mockImplementation((_args, options) =>
      options.onError(new Error("Membership changed")),
    );
    act(() =>
      root.render(
        <WorkspaceGroupEditor
          open
          group={team}
          canManageAll={false}
          onClose={vi.fn()}
        />,
      ),
    );
    const leadCheckbox = document.querySelector<HTMLElement>(
      '[aria-label="lead@example.test"]',
    );
    expect(leadCheckbox?.getAttribute("data-disabled")).not.toBeNull();
    act(() =>
      document
        .querySelector<HTMLElement>('[aria-label="new@example.test"]')
        ?.click(),
    );
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        groupId: team.id,
        memberEmails: ["new@example.test"],
        operation: "add",
      },
      expect.any(Object),
    );
    expect(document.body.textContent).toContain("Membership changed");
    expect(
      document
        .querySelector('[aria-label="new@example.test"]')
        ?.getAttribute("data-state"),
    ).toBe("unchecked");
    expect(document.querySelector('button[type="submit"]')).toBeNull();
  });
});
