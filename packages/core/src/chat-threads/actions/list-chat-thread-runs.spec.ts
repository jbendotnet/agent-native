import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  list: vi.fn(),
}));
vi.mock("../store.js", () => ({ resolveThreadAccess: mocks.access }));
vi.mock("../../agent/run-store.js", () => ({ listRunsForThread: mocks.list }));
vi.mock("../../server/request-context.js", () => ({
  getRequestOrgId: () => "org-one",
  getRequestUserEmail: () => "member@example.test",
}));

import action from "./list-chat-thread-runs.js";

describe("list-chat-thread-runs", () => {
  beforeEach(() => {
    mocks.access.mockReset();
    mocks.list.mockReset();
  });

  it("denies linked runs after thread access is revoked", async () => {
    mocks.access.mockResolvedValue(null);
    await expect(
      action.run({ threadId: "thread-one", limit: 5 }),
    ).rejects.toThrow("Conversation not found");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("uses the existing bounded run reader for an authorized viewer", async () => {
    mocks.access.mockResolvedValue({ id: "thread-one" });
    mocks.list.mockResolvedValue([{ id: "run-one", threadId: "thread-one" }]);
    await expect(
      action.run({ threadId: "thread-one", limit: 5 }),
    ).resolves.toEqual({
      runs: [{ id: "run-one", threadId: "thread-one" }],
    });
    expect(mocks.access).toHaveBeenCalledWith(
      "member@example.test",
      "thread-one",
      "viewer",
      { orgId: "org-one" },
    );
    expect(mocks.list).toHaveBeenCalledWith("thread-one", { limit: 5 });
  });
});
