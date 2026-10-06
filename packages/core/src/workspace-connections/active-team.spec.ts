import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: new Map<string, Record<string, unknown>>(),
  mirrors: new Map<string, Record<string, unknown>>(),
  members: new Map<string, Set<string>>(),
  groups: new Map<string, Set<string>>(),
  failSetting: false,
  failMirror: false,
}));

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: async (email: string) =>
    state.settings.get(email.trim().toLowerCase()) ?? null,
  mutateUserSetting: async (
    email: string,
    _key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    if (state.failSetting) throw new Error("settings unavailable");
    const key = email.trim().toLowerCase();
    const value = update(state.settings.get(key) ?? null);
    state.settings.set(key, value);
    return value;
  },
}));
vi.mock("../application-state/store.js", () => ({
  appStateGet: async (email: string) => state.mirrors.get(email) ?? null,
  appStatePut: async (
    email: string,
    _key: string,
    value: Record<string, unknown>,
  ) => {
    if (state.failMirror) throw new Error("mirror unavailable");
    state.mirrors.set(email, value);
  },
}));
vi.mock("./groups.js", () => ({
  workspaceUserGroupRole: async (org: string, email: string) =>
    state.members.get(org)?.has(email) ? "member" : null,
  getWorkspaceTeamForMember: async (org: string, id: string, email: string) =>
    state.members.get(org)?.has(email) &&
    state.groups.get(org)?.has(`${id}:${email}`)
      ? { id, isTeam: true }
      : null,
}));

import getAction from "./actions/get-active-workspace-team.js";
import setAction from "./actions/set-active-workspace-team.js";
import {
  readActiveWorkspaceTeam,
  restoreActiveWorkspaceTeam,
  writeActiveWorkspaceTeam,
} from "./active-team.js";

const alice = "alice@example.com";
const bob = "bob@example.com";

describe("durable active workspace team", () => {
  beforeEach(() => {
    state.settings.clear();
    state.mirrors.clear();
    state.members.clear();
    state.groups.clear();
    state.failSetting = false;
    state.failMirror = false;
    state.members.set("org-a", new Set([alice, bob]));
    state.members.set("org-b", new Set([alice]));
    state.groups.set("org-a", new Set([`team-a:${alice}`, `team-a:${bob}`]));
    state.groups.set("org-b", new Set([`team-b:${alice}`]));
  });

  it("restores the same user's choice in fresh sessions without selecting for another user", async () => {
    await writeActiveWorkspaceTeam("ALICE@example.com", "org-a", "team-a");
    expect(await restoreActiveWorkspaceTeam(alice, "org-a")).toEqual({
      orgId: "org-a",
      teamGroupId: "team-a",
    });
    state.mirrors.clear();
    expect(await restoreActiveWorkspaceTeam(alice, "org-a")).toEqual({
      orgId: "org-a",
      teamGroupId: "team-a",
    });
    expect(await restoreActiveWorkspaceTeam(bob, "org-a")).toEqual({
      orgId: "org-a",
      teamGroupId: null,
    });
    expect(state.settings.get(alice)).toEqual({ byOrg: { "org-a": "team-a" } });
  });

  it("keeps concurrent changes to different organizations and restores on switches", async () => {
    await Promise.all([
      writeActiveWorkspaceTeam(alice, "org-a", "team-a"),
      writeActiveWorkspaceTeam(alice, "org-b", "team-b"),
    ]);
    expect(await restoreActiveWorkspaceTeam(alice, "org-b")).toEqual({
      orgId: "org-b",
      teamGroupId: "team-b",
    });
    expect(await restoreActiveWorkspaceTeam(alice, "org-a")).toEqual({
      orgId: "org-a",
      teamGroupId: "team-a",
    });
    expect(state.settings.get(alice)).toEqual({
      byOrg: { "org-a": "team-a", "org-b": "team-b" },
    });
    await writeActiveWorkspaceTeam(alice, "org-a", null);
    expect(await restoreActiveWorkspaceTeam(alice, "org-a")).toEqual({
      orgId: "org-a",
      teamGroupId: null,
    });
    expect(state.settings.get(alice)).toEqual({ byOrg: { "org-b": "team-b" } });
    expect(await restoreActiveWorkspaceTeam(alice, null)).toEqual({
      orgId: null,
      teamGroupId: null,
    });
  });

  it("rejects ordinary, missing and nonmember team selection", async () => {
    await expect(
      writeActiveWorkspaceTeam(alice, "org-a", "ordinary"),
    ).rejects.toThrow("membership");
    await expect(
      writeActiveWorkspaceTeam(alice, "org-a", "missing"),
    ).rejects.toThrow("membership");
    await expect(writeActiveWorkspaceTeam(bob, "org-b", null)).rejects.toThrow(
      "organization membership",
    );
    expect(state.settings.size).toBe(0);
  });

  it("clears deleted teams and lost membership rather than carrying the prior choice", async () => {
    await writeActiveWorkspaceTeam(alice, "org-a", "team-a");
    state.groups.get("org-a")?.delete(`team-a:${alice}`);
    expect(await restoreActiveWorkspaceTeam(alice, "org-a")).toEqual({
      orgId: "org-a",
      teamGroupId: null,
    });
    expect(state.settings.get(alice)).toEqual({ byOrg: {} });
    state.groups.get("org-a")?.add(`team-a:${alice}`);
    await writeActiveWorkspaceTeam(alice, "org-a", "team-a");
    state.members.get("org-a")?.delete(alice);
    await expect(readActiveWorkspaceTeam(alice, "org-a")).rejects.toThrow(
      "organization membership",
    );
  });

  it("does not report a cleared selection when invalid-choice cleanup fails", async () => {
    await writeActiveWorkspaceTeam(alice, "org-a", "team-a");
    state.groups.get("org-a")?.delete(`team-a:${alice}`);
    state.failSetting = true;
    await expect(restoreActiveWorkspaceTeam(alice, "org-a")).rejects.toThrow(
      "could not be cleared",
    );
    expect(state.settings.get(alice)).toEqual({ byOrg: { "org-a": "team-a" } });
    expect(state.mirrors.size).toBe(0);
  });

  it("rejects malformed settings and keeps persistence and mirror failures explicit", async () => {
    state.settings.set(alice, { byOrg: { "org-a": 3 } });
    await expect(restoreActiveWorkspaceTeam(alice, "org-a")).rejects.toThrow(
      "invalid",
    );
    state.settings.clear();
    state.failSetting = true;
    await expect(
      writeActiveWorkspaceTeam(alice, "org-a", "team-a"),
    ).rejects.toThrow("could not be saved");
    expect(state.mirrors.size).toBe(0);
    state.failSetting = false;
    state.failMirror = true;
    await expect(restoreActiveWorkspaceTeam(alice, "org-a")).rejects.toThrow(
      "mirror could not be updated",
    );
    state.failMirror = false;
    expect(await restoreActiveWorkspaceTeam(alice, "org-a")).toEqual({
      orgId: "org-a",
      teamGroupId: null,
    });
  });

  it("exposes authenticated action read and write with explicit null and failed mirror", async () => {
    await expect(
      setAction.run(
        { teamGroupId: "team-a" },
        { userEmail: bob, orgId: "org-b" },
      ),
    ).rejects.toThrow("membership");
    await expect(
      getAction.run({}, { userEmail: bob, orgId: "org-b" }),
    ).rejects.toThrow("membership");
    await expect(
      setAction.run(
        { teamGroupId: "team-a" },
        { userEmail: alice, orgId: "org-a" },
      ),
    ).resolves.toEqual({ orgId: "org-a", teamGroupId: "team-a" });
    expect(
      await getAction.run({}, { userEmail: alice, orgId: "org-a" }),
    ).toEqual({ orgId: "org-a", teamGroupId: "team-a" });
    state.failMirror = true;
    await expect(
      setAction.run(
        { teamGroupId: null },
        { userEmail: alice, orgId: "org-a" },
      ),
    ).rejects.toThrow("mirror could not be updated");
    expect(state.settings.get(alice)).toEqual({ byOrg: {} });
    state.failMirror = false;
    expect(
      await getAction.run({}, { userEmail: alice, orgId: "org-a" }),
    ).toEqual({ orgId: "org-a", teamGroupId: null });
  });
});
