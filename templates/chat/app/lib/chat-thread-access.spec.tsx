// @vitest-environment happy-dom

import { useActionQuery } from "@agent-native/core/client/hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import {
  chatThreadAccessState,
  isThreadAccessDenied,
} from "./chat-thread-access";

afterEach(() => vi.unstubAllGlobals());

it("evicts only explicit access denials, not transport or server errors", () => {
  expect(
    isThreadAccessDenied(Object.assign(new Error("Denied"), { status: 403 })),
  ).toBe(true);
  expect(
    isThreadAccessDenied(Object.assign(new Error("Missing"), { status: 404 })),
  ).toBe(true);
  expect(
    isThreadAccessDenied(
      Object.assign(new Error("Unavailable"), { status: 503 }),
    ),
  ).toBe(false);
  expect(isThreadAccessDenied(new Error("Network unavailable"))).toBe(false);
});

it("keeps real action-query subscribers mounted through a stale refresh, then clears denial", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let allowed = true;
  let requests = 0;
  let mounts = 0;
  let unmounts = 0;
  let menuMounts = 0;
  let menuUnmounts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      requests++;
      return new Response(
        JSON.stringify(
          allowed
            ? { canRead: true, canContinue: true, canManage: true }
            : { error: "Conversation not found" },
        ),
        {
          status: allowed ? 200 : 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function TeamShareSubscriber() {
    useActionQuery(
      "get-chat-thread-capabilities",
      { threadId: "thread-one" },
      { staleTime: 0 },
    );
    useEffect(() => {
      menuMounts++;
      return () => {
        menuUnmounts++;
      };
    }, []);
    return null;
  }
  function Menu() {
    const access = useActionQuery<{ canManage: boolean }>(
      "get-chat-thread-capabilities",
      { threadId: "thread-one" },
      { staleTime: 0 },
    );
    if (access.isPending || access.isError || access.data?.canManage !== true)
      return null;
    return <TeamShareSubscriber />;
  }
  function Content() {
    useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    return <Menu />;
  }
  function Chat() {
    const query = useActionQuery<{ canRead: boolean; canContinue: boolean }>(
      "get-chat-thread-capabilities",
      { threadId: "thread-one" },
      { staleTime: 0 },
    );
    const { canRead, refreshing } = chatThreadAccessState(false, query);
    if (!canRead) return <div role="alert">Denied</div>;
    return (
      <div data-content="" aria-hidden={refreshing}>
        <Content />
      </div>
    );
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Chat />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(menuMounts).toBe(1);
    });
    expect(container.querySelector("[data-content]")).not.toBeNull();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    expect(menuMounts).toBe(1);
    expect(menuUnmounts).toBe(0);
    expect(requests).toBeLessThan(6);

    const requestsBeforeRevocation = requests;
    allowed = false;
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["action", "get-chat-thread-capabilities"],
      });
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(requests).toBeGreaterThan(requestsBeforeRevocation);
      expect(container.querySelector("[data-content]")).toBeNull();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Denied",
    );
    expect(unmounts).toBe(1);
    expect(menuUnmounts).toBe(1);
  } finally {
    act(() => root.unmount());
    container.remove();
    client.clear();
  }
});
