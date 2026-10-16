import { describe, expect, it } from "vitest";
import { ACTIONS, ROLES, can, canManageRole, type Action, type Role } from "./permissions.js";

// The full expected matrix. Changing a permission means changing this table
// on purpose, so every role/action pair is reviewed explicitly.
const EXPECTED: Record<Role, Action[]> = {
  owner: [...ACTIONS],
  admin: [
    "workspace.read",
    "workspace.update",
    "member.read",
    "member.invite",
    "member.updateRole",
    "member.remove",
    "audit.read",
  ],
  member: ["workspace.read", "member.read"],
  guest: ["workspace.read"],
};

describe("permission matrix", () => {
  for (const role of ROLES) {
    for (const action of ACTIONS) {
      const allowed = EXPECTED[role].includes(action);
      it(`${role} ${allowed ? "can" : "cannot"} ${action}`, () => {
        expect(can(role, action)).toBe(allowed);
      });
    }
  }

  it("denies everything without a role", () => {
    for (const action of ACTIONS) expect(can(null, action)).toBe(false);
  });
});

describe("canManageRole", () => {
  it("lets owners do anything", () => {
    expect(canManageRole("owner", "owner", "member")).toBe(true);
    expect(canManageRole("owner", null, "owner")).toBe(true);
  });
  it("stops admins touching owners or other admins", () => {
    expect(canManageRole("admin", "owner", "member")).toBe(false);
    expect(canManageRole("admin", "admin", "member")).toBe(false);
  });
  it("stops admins granting admin or owner", () => {
    expect(canManageRole("admin", "member", "admin")).toBe(false);
    expect(canManageRole("admin", null, "owner")).toBe(false);
  });
  it("lets admins move people between member and guest", () => {
    expect(canManageRole("admin", "member", "guest")).toBe(true);
    expect(canManageRole("admin", null, "member")).toBe(true);
  });
  it("never lets members or guests manage roles", () => {
    expect(canManageRole("member", "guest", "guest")).toBe(false);
    expect(canManageRole("guest", null, "guest")).toBe(false);
  });
});
