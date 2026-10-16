import { z } from "zod";
import { ROLES } from "./permissions.js";

export const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug");

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slugSchema,
});

export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES).exclude(["owner"]),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(ROLES),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
