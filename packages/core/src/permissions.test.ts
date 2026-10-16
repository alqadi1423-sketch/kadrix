import { describe, expect, it } from "vitest";
import { ACTIONS, ROLES, can, canManageRole, type Action, type Role } from "./permissions.js";

// The full expected matrix, written out by hand. Changing a permission means
// changing this table on purpose, so every role/action pair is reviewed.
const GUEST: Action[] = ["workspace.read", "issue.read", "comment.create"];
const MEMBER: Action[] = [
  ...GUEST,
  "member.read",
  "project.create",
  "issue.create",
  "issue.update",
  "view.manage",
  "planning.manage",
  "token.manage",
  "template.manage",
  "time.log",
  "report.read",
];
const ADMIN: Action[] = [
  ...MEMBER,
  "workspace.update",
  "member.invite",
  "member.updateRole",
  "member.remove",
  "audit.read",
  "project.update",
  "project.delete",
  "workflow.manage",
  "label.manage",
  "issue.delete",
  "integration.manage",
  "webhook.manage",
  "field.manage",
  "automation.manage",
  "import.run",
];
const EXPECTED: Record<Role, Action[]> = {
  owner: [...ACTIONS],
  admin: ADMIN,
  member: MEMBER,
  guest: GUEST,
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

  it("only owners can delete a workspace", () => {
    expect(ROLES.filter((r) => can(r, "workspace.delete"))).toEqual(["owner"]);
  });

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
