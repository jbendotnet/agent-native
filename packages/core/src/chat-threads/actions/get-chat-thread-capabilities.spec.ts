import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => vi.fn());

vi.mock("../store.js", () => ({ resolveThreadAccess: access }));
vi.mock("../../server/request-context.js", () => ({
  getRequestOrgId: () => "org-one",
  getRequestUserEmail: () => "member@example.test",
}));

import action from "./get-chat-thread-capabilities.js";

describe("get-chat-thread-capabilities", () => {
  beforeEach(() => access.mockReset());

  it("denies a thread when the authoritative read gate denies it", async () => {
    access.mockResolvedValue(null);
    await expect(action.run({ threadId: "thread-one" })).rejects.toThrow(
      "Conversation not found",
    );
    expect(access).toHaveBeenCalledTimes(1);
    expect(access).toHaveBeenCalledWith(
      "member@example.test",
      "thread-one",
      "viewer",
      { orgId: "org-one" },
    );
  });

  it("lets a shared team viewer read but never continue or manage", async () => {
    access.mockImplementation(async (_email, _thread, role) =>
      role === "viewer" ? { ownerEmail: "owner@example.test" } : null,
    );
    await expect(action.run({ threadId: "thread-one" })).resolves.toEqual({
      threadId: "thread-one",
      canRead: true,
      canContinue: false,
      canManage: false,
    });
  });

  it("keeps owner management behind the same read gate", async () => {
    access.mockResolvedValue({ ownerEmail: "member@example.test" });
    await expect(action.run({ threadId: "thread-one" })).resolves.toEqual({
      threadId: "thread-one",
      canRead: true,
      canContinue: true,
      canManage: true,
    });
  });

  it("preserves an existing editor share without granting owner management", async () => {
    access.mockResolvedValue({ ownerEmail: "owner@example.test" });
    await expect(action.run({ threadId: "thread-one" })).resolves.toEqual({
      threadId: "thread-one",
      canRead: true,
      canContinue: true,
      canManage: false,
    });
    expect(access).toHaveBeenCalledWith(
      "member@example.test",
      "thread-one",
      "editor",
      { orgId: "org-one" },
    );
  });
});
