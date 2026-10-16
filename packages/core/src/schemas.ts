import { z } from "zod";
import { ROLES } from "./permissions.js";

/**
 * Every field optional and no defaults: the shape for PATCH bodies.
 * (`.partial()` keeps `.default()`s, which would silently reset fields
 * the caller never sent.)
 */
export function patchOf<T extends z.ZodObject>(schema: T): ReturnType<T["partial"]> {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    shape[k] = (v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : v).optional();
  }
  return z.object(shape) as unknown as ReturnType<T["partial"]>;
}

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
