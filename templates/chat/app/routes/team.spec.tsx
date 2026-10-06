// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  groups: [
    {
      id: "team-one",
      name: "Writers",
      isTeam: true,
      memberEmails: ["member@example.test"],
    },
  ],
  error: false,
  empty: false,
  runError: false,
  runQueries: 0,
  offset: 0,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    name: string,
    params: { offset?: number },
    options?: { enabled?: boolean },
  ) => {
    if (name === "list-chat-thread-runs") {
      if (options?.enabled) state.runQueries++;
      return {
        data: { runs: [{ id: "run-one", startedAt: 1000 }] },
        isPending: false,
        isFetching: false,
        isError: state.runError,
      };
    }
    if (name === "list-workspace-user-groups")
      return { data: state.groups, isPending: false, isError: false };
    if (name !== "list-team-shared-chat-threads")
      throw new Error(`Unexpected action: ${name}`);
    state.offset = params.offset ?? 0;
    return {
      data: {
        threads: state.empty
          ? []
          : state.offset === 0
            ? [
                {
                  id: "shared-one",
                  title: "Shared",
                  preview: "",
                  messageCount: 1,
                },
              ]
            : [
                {
                  id: "shared-two",
                  title: "Second",
                  preview: "",
                  messageCount: 1,
                },
              ],
        nextOffset: state.empty ? null : state.offset === 0 ? 25 : null,
      },
      isPending: false,
      isFetching: false,
      isError: state.error,
    };
  },
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: { orgId: "org-one", email: "member@example.test" },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/rail", () => ({
  useAgentChatRunningThreads: () => ({
    workingThreadIds: new Set(["shared-one"]),
  }),
}));
vi.mock("@agent-native/core/client/org-team", () => ({
  useActiveWorkspaceTeam: () => ({
    data: { teamGroupId: "team-one" },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: () => null,
}));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: () => <div /> }));

import TeamRoute from "./team";

describe("team-shared work", () => {
  let element: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.groups = [
      {
        id: "team-one",
        name: "Writers",
        isTeam: true,
        memberEmails: ["member@example.test"],
      },
    ];
    state.error = false;
    state.empty = false;
    state.runError = false;
    state.runQueries = 0;
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
        <MemoryRouter>
          <TeamRoute />
        </MemoryRouter>,
      ),
    );
  }

  it("paginates explicit team shares and navigates through a real link", () => {
    render();
    expect(state.offset).toBe(0);
    expect(element.querySelector('a[href="/chat/shared-one"]')).toBeTruthy();
    expect(element.querySelector('[role="status"]')?.textContent).toBe(
      "agentChat.status.working",
    );
    const more = [...element.querySelectorAll("button")].find(
      (button) => button.textContent === "chat.moreSharedChats",
    );
    act(() => more?.click());
    expect(state.offset).toBe(25);
    expect(element.querySelector('a[href="/chat/shared-two"]')).toBeTruthy();
  });

  it("hides stale shared content after access fails", () => {
    render();
    state.error = true;
    render();
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(
      "chat.teamWorkUnavailable",
    );
    expect(element.querySelector("a[href^='/chat/']")).toBeNull();
  });

  it("does not query or render private work without a team", () => {
    state.groups = [];
    render();
    expect(element.textContent).toContain("chat.noTeams");
    expect(element.querySelector("a[href^='/chat/']")).toBeNull();
  });

  it("shows an empty state for an authorized team with no explicit shares", () => {
    state.empty = true;
    render();
    expect(element.textContent).toContain("chat.noSharedChats");
    expect(element.querySelector("a[href^='/chat/']")).toBeNull();
  });

  it("opens bounded linked runs through the existing authorized conversation route", () => {
    render();
    expect(state.runQueries).toBe(0);
    const runs = [...element.querySelectorAll("button")].find(
      (button) => button.textContent === "chat.linkedRuns",
    );
    act(() => runs?.click());
    expect(state.runQueries).toBeGreaterThan(0);
    expect(
      element.querySelector('a[href="/chat/shared-one"]')?.textContent,
    ).toContain("Shared");
    expect(element.textContent).toContain("run-one");
    expect(
      element.querySelector('a[href="/chat/shared-one?runId=run-one"]'),
    ).toBeTruthy();
    state.runError = true;
    render();
    expect(element.textContent).toContain("chat.linkedRunsUnavailable");
    expect(element.textContent).not.toContain("run-one");
  });
});
