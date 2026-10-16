import type { Role } from "@veloq/core";
import type { ErrorCode } from "@veloq/i18n";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ baseURL: window.location.origin });

/** Error carrying an API error code that maps to `errors.*` translations. */
export class ApiCallError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: ErrorCode } | null;
    throw new ApiCallError(data?.error ?? "generic");
  }
  return (await res.json()) as T;
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  role: Role;
}
export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
}
export interface AuditEntry {
  id: string;
  action: string;
  data: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
}

export const api = {
  workspaces: () => call<{ workspaces: WorkspaceSummary[] }>("GET", "/workspaces"),
  createWorkspace: (input: { name: string; slug: string }) =>
    call<{ workspace: WorkspaceSummary }>("POST", "/workspaces", input),
  workspace: (slug: string) =>
    call<{ workspace: { slug: string; name: string; role: Role } }>("GET", `/workspaces/${slug}`),
  members: (slug: string) => call<{ members: Member[] }>("GET", `/workspaces/${slug}/members`),
  addMember: (slug: string, input: { email: string; role: Role }) =>
    call("POST", `/workspaces/${slug}/members`, input),
  setRole: (slug: string, userId: string, role: Role) =>
    call("PATCH", `/workspaces/${slug}/members/${userId}`, { role }),
  removeMember: (slug: string, userId: string) => call("DELETE", `/workspaces/${slug}/members/${userId}`),
  audit: (slug: string) => call<{ entries: AuditEntry[] }>("GET", `/workspaces/${slug}/audit`),
};
