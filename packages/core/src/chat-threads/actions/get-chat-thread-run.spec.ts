import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), run: vi.fn() }));
vi.mock("../store.js", () => ({ resolveThreadAccess: mocks.access }));
vi.mock("../../agent/run-store.js", () => ({ getRunById: mocks.run }));
vi.mock("../../server/request-context.js", () => ({
  getRequestOrgId: () => "org-one",
  getRequestUserEmail: () => "viewer@example.test",
}));

import action from "./get-chat-thread-run.js";

describe("get-chat-thread-run", () => {
  beforeEach(() => {
    mocks.access.mockReset();
    mocks.run.mockReset();
  });

  it("denies a run when current conversation membership or sharing has ended", async () => {
    mocks.access.mockResolvedValue(null);
    await expect(
      action.run({ threadId: "thread-one", runId: "run-one" }),
    ).rejects.toThrow("Run not found");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rejects another conversation's run without returning its contents", async () => {
    mocks.access.mockResolvedValue({ id: "thread-one" });
    mocks.run.mockResolvedValue({ id: "run-one", threadId: "thread-two" });
    await expect(
      action.run({ threadId: "thread-one", runId: "run-one" }),
    ).rejects.toThrow("Run not found");
  });

  it("reads the selected run after the current thread access check", async () => {
    mocks.access.mockResolvedValue({ id: "thread-one" });
    mocks.run.mockResolvedValue({
      id: "run-one",
      threadId: "thread-one",
      status: "completed",
    });
    await expect(
      action.run({ threadId: "thread-one", runId: "run-one" }),
    ).resolves.toEqual({
      run: { id: "run-one", threadId: "thread-one", status: "completed" },
    });
    expect(mocks.run).toHaveBeenCalledWith("run-one");
  });
});
