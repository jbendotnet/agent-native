// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  role: "owner",
  shares: [] as { principalType: string; principalId: string; role: string }[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => {
    if (name === "get-chat-thread-capabilities")
      return {
        data: { canManage: state.role === "owner" },
        isPending: false,
        isFetching: false,
        isError: false,
      };
    if (name === "list-workspace-user-groups")
      return {
        data: [
          {
            id: "team-one",
            name: "Writers",
            isTeam: true,
            memberEmails: ["owner@example.test"],
          },
        ],
        isPending: false,
        isError: false,
      };
    if (name === "list-resource-shares")
      return {
        data: { role: state.role, shares: state.shares },
        isPending: false,
        isError: false,
        refetch: vi.fn().mockResolvedValue(undefined),
      };
    throw new Error(`Unexpected action: ${name}`);
  },
  useActionMutation: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org-one", email: "owner@example.test" } }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, params?: { name: string }) =>
    `${key}${params ? `:${params.name}` : ""}`,
}));
vi.mock("../ui/dropdown-menu.js", () => ({
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onSelect?: (event: { preventDefault: () => void }) => void;
  }) => (
    <button
      disabled={disabled}
      onClick={() => onSelect?.({ preventDefault() {} })}
    >
      {children}
    </button>
  ),
}));

import { TeamShareMenu } from "./TeamShareMenu";

const labels = {
  unavailable: "chat.teamShareUnavailable",
  loading: "chat.teamShareLoading",
  failed: "chat.teamShareFailed",
  share: (name: string) => `chat.shareWithTeam:${name}`,
  unshare: (name: string) => `chat.unshareFromTeam:${name}`,
};

describe("owner team share menu", () => {
  let element: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.role = "owner";
    state.shares = [];
    state.mutate.mockReset();
    element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
  });

  afterEach(() => {
    act(() => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  });

  function render() {
    act(() =>
      root.render(
        <TeamShareMenu
          thread={
            {
              id: "thread-one",
              teamGroupId: "team-one",
              messageCount: 1,
            } as Parameters<typeof TeamShareMenu>[0]["thread"]
          }
          closeMenu={vi.fn()}
          labels={labels}
        />,
      ),
    );
  }

  it("rolls back an optimistic grant on failure", async () => {
    let reject!: (reason: Error) => void;
    state.mutate.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectFn) => {
          reject = rejectFn;
        }),
    );
    render();
    expect(element.textContent).toContain("chat.shareWithTeam:Writers");
    act(() => element.querySelector("button")?.click());
    expect(element.textContent).toContain("chat.unshareFromTeam:Writers");
    await act(async () => {
      reject(new Error("denied"));
    });
    expect(state.mutate).toHaveBeenCalledWith({
      threadId: "thread-one",
      teamGroupId: "team-one",
    });
    expect(element.textContent).toContain("chat.teamShareFailed");
    expect(element.textContent).toContain("chat.shareWithTeam:Writers");
  });

  it("offers no team mutation to a viewer", () => {
    state.role = "viewer";
    render();
    expect(element.querySelector("button")).toBeNull();
  });

  it("revokes an explicit team grant without changing an unbound thread", async () => {
    state.shares = [
      { principalType: "group", principalId: "team-one", role: "viewer" },
    ];
    state.mutate.mockResolvedValueOnce({ shared: false });
    act(() =>
      root.render(
        <TeamShareMenu
          thread={
            {
              id: "thread-one",
              teamGroupId: null,
              messageCount: 1,
            } as Parameters<typeof TeamShareMenu>[0]["thread"]
          }
          closeMenu={vi.fn()}
          labels={labels}
        />,
      ),
    );
    expect(element.textContent).toContain("chat.unshareFromTeam:Writers");
    await act(async () => element.querySelector("button")?.click());
    expect(state.mutate).toHaveBeenCalledWith({
      threadId: "thread-one",
      teamGroupId: "team-one",
    });
  });
});
