// @vitest-environment happy-dom

import { useChatThreads } from "@agent-native/core/client/agent-chat";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("removes only a denied chat row and retains owner or unreadable rows", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
  const threads = ["shared", "owner", "other"].map((id) => ({
    id,
    title: id,
    preview: "",
    messageCount: 1,
    createdAt: 1,
    updatedAt: 1,
    scope: null,
  }));
  let sharedStatus = 404;
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/threads")) return respond({ threads });
      if (url.endsWith("/threads/shared"))
        return respond({ error: "Denied" }, sharedStatus);
      if (url.endsWith("/threads/owner")) return respond(threads[1]);
      throw new Error(`Unexpected request ${url}`);
    }),
  );
  const holder: { current: ReturnType<typeof useChatThreads> | null } = {
    current: null,
  };
  function Probe() {
    holder.current = useChatThreads(
      "/_agent-native/agent-chat",
      "test-h03",
      undefined,
      {
        autoCreate: false,
        restoreActiveThread: false,
        browserTabId: "test-h03",
      },
    );
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(holder.current?.threads.map((thread) => thread.id)).toEqual([
      "shared",
      "owner",
      "other",
    ]);
    await act(async () => {
      expect(await holder.current?.openThread("shared")).toBe("missing");
    });
    expect(holder.current?.threads.map((thread) => thread.id)).toEqual([
      "owner",
      "other",
    ]);

    await act(async () => {
      expect(await holder.current?.openThread("owner")).toBe("opened");
    });
    expect(holder.current?.threads.map((thread) => thread.id)).toContain(
      "owner",
    );

    await act(async () => {
      await holder.current?.refreshThreads();
    });
    sharedStatus = 503;
    await act(async () => {
      expect(await holder.current?.openThread("shared")).toBe("unavailable");
    });
    expect(holder.current?.threads.map((thread) => thread.id)).toContain(
      "shared",
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
