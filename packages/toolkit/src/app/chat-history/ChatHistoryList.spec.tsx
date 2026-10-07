// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", () => ({ useActionQuery: query }));

import { ChatHistoryList } from "./ChatHistoryList.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("checks current management access when opening a history menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  query.mockReturnValue({
    data: { canManage: false },
    isPending: false,
    isFetching: false,
    isError: false,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChatHistoryList
        items={[{ id: "shared-thread", title: "Shared" }]}
        onSelect={() => {}}
        onRename={() => {}}
        enforceThreadCapabilities
        capabilityLabels={{ readOnly: "Read only", unavailable: "Unavailable" }}
      />,
    );
  });
  expect(query).toHaveBeenCalledWith(
    "get-chat-thread-capabilities",
    { threadId: "shared-thread" },
    { enabled: false, staleTime: 0, refetchOnWindowFocus: "always" },
  );
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(".an-chat-history-row__menu-trigger")
      ?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
  });
  expect(query).toHaveBeenCalledWith(
    "get-chat-thread-capabilities",
    { threadId: "shared-thread" },
    { enabled: true, staleTime: 0, refetchOnWindowFocus: "always" },
  );
  expect(document.body.textContent).toContain("Read only");
  expect(document.body.textContent).not.toContain("Rename");
  act(() => root.unmount());
});
