// @vitest-environment happy-dom

import { IconUsersGroup } from "@tabler/icons-react";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("../org/workspace-app-links.js", () => ({
  useOrgSwitcherAppLinks: () => ({ isWorkspace: false }),
}));

import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";

import {
  isResourceRowReadOnly,
  ResourceSettingsGroups,
} from "./ResourceSettingsGroups.js";

const resource = {
  id: "context-1",
  path: "AGENTS.md",
  owner: "__team__:team-1",
  mimeType: "text/markdown",
  size: 10,
  createdAt: 0,
  updatedAt: 0,
  createdBy: "user" as const,
  visibility: "workspace" as const,
  threadId: null,
  runId: null,
  expiresAt: null,
  metadata: null,
};

describe("team resource settings", () => {
  it("allows editing team rows without allowing ordinary members to edit organization defaults", () => {
    expect(isResourceRowReadOnly("team", resource, false)).toBe(false);
    expect(isResourceRowReadOnly("shared", resource, false)).toBe(true);
  });

  it("hides stale team rows when their membership-scoped lookup fails", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const tree = [
      { name: "AGENTS.md", path: "AGENTS.md", type: "file" as const, resource },
    ];
    const empty = {
      nodes: [],
      isLoading: false,
      isError: false,
      retry: vi.fn(),
    };
    const render = (isError: boolean) =>
      act(() =>
        root.render(
          <TooltipProvider>
            <ResourceSettingsGroups
              groups={[
                {
                  id: "team",
                  view: "instructions",
                  sources: ["team"],
                  teamGroupId: "team-1",
                  emptyIcon: IconUsersGroup,
                  emptyTitle: "Empty",
                },
              ]}
              trees={{
                personal: empty,
                shared: empty,
                workspace: empty,
                team: {
                  nodes: tree,
                  isLoading: false,
                  isError,
                  retry: vi.fn(),
                },
              }}
              canEditOrg={false}
              orgName="Acme"
              deletingId={null}
              onOpen={vi.fn()}
              onRemove={vi.fn()}
            />
          </TooltipProvider>,
        ),
      );
    render(false);
    expect(
      container.querySelector('[data-resource-row="AGENTS.md"]'),
    ).not.toBeNull();
    render(true);
    expect(
      container.querySelector('[data-resource-row="AGENTS.md"]'),
    ).toBeNull();
    expect(container.textContent).toContain(
      "agentChat.settingsResources.loadFailed",
    );
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
});
