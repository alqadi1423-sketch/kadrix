/**
 * Central permission model. Every authorization decision in Veloq goes
 * through `can()`. Never check roles directly anywhere else.
 */

export const ROLES = ["owner", "admin", "member", "guest"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "workspace.read",
  "workspace.update",
  "workspace.delete",
  "member.read",
  "member.invite",
  "member.updateRole",
  "member.remove",
  "audit.read",
] as const;
export type Action = (typeof ACTIONS)[number];

const MATRIX: Record<Role, readonly Action[]> = {
  owner: ACTIONS,
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

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return MATRIX[role].includes(action);
}

/** Rank used to stop someone granting or removing a role above their own. */
const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1, guest: 0 };

/**
 * May `actor` assign `target` role to someone, or change someone who currently
 * holds `current`? Only owners touch owners; nobody grants above their rank.
 */
export function canManageRole(actor: Role, current: Role | null, target: Role): boolean {
  if (!can(actor, "member.updateRole")) return false;
  if (actor === "owner") return true;
  if (current !== null && RANK[current] >= RANK[actor]) return false;
  return RANK[target] < RANK[actor];
}
