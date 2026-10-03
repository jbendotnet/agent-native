import { afterEach, describe, expect, it, vi } from "vitest";

const getRun = vi.fn();
const getRunById = vi.fn();
const resolveThreadAccess = vi.fn();

vi.mock("./run-manager.js", () => ({ getRun: (...a: any[]) => getRun(...a) }));
vi.mock("./run-store.js", () => ({
  getRunById: (...a: any[]) => getRunById(...a),
}));
vi.mock("../chat-threads/store.js", () => ({
  resolveThreadAccess: (...a: any[]) => resolveThreadAccess(...a),
}));

import {
  resolveRunThreadId,
  callerOwnsThread,
  callerOwnsRun,
  callerHasThreadAccess,
  callerHasRunAccess,
} from "./run-ownership.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("run-ownership", () => {
  describe("resolveRunThreadId", () => {
    it("prefers the in-memory run and does not hit SQL", async () => {
      getRun.mockReturnValue({ threadId: "t-mem" });
      expect(await resolveRunThreadId("r1")).toBe("t-mem");
      expect(getRunById).not.toHaveBeenCalled();
    });

    it("falls back to SQL when not in memory", async () => {
      getRun.mockReturnValue(null);
      getRunById.mockResolvedValue({ threadId: "t-sql" });
      expect(await resolveRunThreadId("r1")).toBe("t-sql");
    });

    it("returns null for an unknown run", async () => {
      getRun.mockReturnValue(null);
      getRunById.mockResolvedValue(null);
      expect(await resolveRunThreadId("nope")).toBeNull();
    });
  });

  describe("callerOwnsThread", () => {
    it("true when the thread owner matches", async () => {
      resolveThreadAccess.mockResolvedValue({ ownerEmail: "a@x.com" });
      expect(await callerOwnsThread("a@x.com", "t1")).toBe(true);
    });

    it("false for a different owner (cross-tenant)", async () => {
      resolveThreadAccess.mockResolvedValue(null);
      expect(await callerOwnsThread("b@x.com", "t1")).toBe(false);
    });

    it("false for a missing/deleted thread", async () => {
      resolveThreadAccess.mockResolvedValue(null);
      expect(await callerOwnsThread("a@x.com", "t1")).toBe(false);
    });

    it("false when no threadId is given", async () => {
      expect(await callerOwnsThread("a@x.com", null)).toBe(false);
      expect(await callerOwnsThread("a@x.com", undefined)).toBe(false);
      expect(resolveThreadAccess).not.toHaveBeenCalled();
    });
  });

  describe("callerOwnsRun", () => {
    it("true when the caller owns the run's thread", async () => {
      getRun.mockReturnValue({ threadId: "t1" });
      resolveThreadAccess.mockResolvedValue({ ownerEmail: "a@x.com" });
      expect(await callerOwnsRun("a@x.com", "r1")).toBe(true);
    });

    it("false when another tenant requests the run", async () => {
      getRun.mockReturnValue({ threadId: "t1" });
      resolveThreadAccess.mockResolvedValue(null);
      expect(await callerOwnsRun("attacker@evil.com", "r1")).toBe(false);
    });

    it("false for an unknown run (no thread to own)", async () => {
      getRun.mockReturnValue(null);
      getRunById.mockResolvedValue(null);
      expect(await callerOwnsRun("a@x.com", "ghost")).toBe(false);
      expect(resolveThreadAccess).not.toHaveBeenCalled();
    });

    it("resolves ownership via the SQL fallback (cross-isolate)", async () => {
      getRun.mockReturnValue(null);
      getRunById.mockResolvedValue({ threadId: "t-sql" });
      resolveThreadAccess.mockResolvedValue({ ownerEmail: "a@x.com" });
      expect(await callerOwnsRun("a@x.com", "r1")).toBe(true);
    });

    it("denies the owner when current thread policy denies the linked conversation", async () => {
      getRun.mockReturnValue({ threadId: "t1" });
      resolveThreadAccess.mockResolvedValue(null);
      expect(await callerOwnsRun("a@x.com", "r1", { orgId: "org-a" })).toBe(
        false,
      );
      expect(resolveThreadAccess).toHaveBeenCalledWith(
        "a@x.com",
        "t1",
        "owner",
        { orgId: "org-a" },
      );
    });
  });

  describe("callerHasThreadAccess", () => {
    it("true when the caller has the requested shared role", async () => {
      resolveThreadAccess.mockResolvedValue({ id: "t1" });
      expect(await callerHasThreadAccess("b@x.com", "t1", "editor")).toBe(true);
      expect(resolveThreadAccess).toHaveBeenCalledWith(
        "b@x.com",
        "t1",
        "editor",
        {},
      );
    });

    it("false when the caller lacks shared access", async () => {
      resolveThreadAccess.mockResolvedValue(null);
      expect(await callerHasThreadAccess("b@x.com", "t1")).toBe(false);
    });
  });

  describe("callerHasRunAccess", () => {
    it("checks shared access on the run's thread", async () => {
      getRun.mockReturnValue({ threadId: "t1" });
      resolveThreadAccess.mockResolvedValue({ id: "t1" });
      expect(await callerHasRunAccess("b@x.com", "r1", "viewer")).toBe(true);
    });
  });
});
