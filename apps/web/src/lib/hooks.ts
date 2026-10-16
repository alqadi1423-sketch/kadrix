import type { IssueFilter } from "@veloq/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Issue } from "../api";

/** All workspace queries live under ["ws", slug, ...] so realtime can refresh them. */
export const keys = {
  ws: (slug: string) => ["ws", slug] as const,
  workspace: (slug: string) => ["ws", slug, "workspace"] as const,
  members: (slug: string) => ["ws", slug, "members"] as const,
  projects: (slug: string) => ["ws", slug, "projects"] as const,
  project: (slug: string, id: string) => ["ws", slug, "projects", id] as const,
  labels: (slug: string) => ["ws", slug, "label"] as const,
  issues: (slug: string, filter: IssueFilter) => ["ws", slug, "issues", filter] as const,
  issue: (slug: string, id: string) => ["ws", slug, "issue", id] as const,
  notifications: (slug: string) => ["ws", slug, "notification"] as const,
  views: (slug: string) => ["ws", slug, "views"] as const,
  me: ["me"] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: Infinity });
export const useWorkspace = (slug: string) =>
  useQuery({ queryKey: keys.workspace(slug), queryFn: () => api.workspace(slug) });
export const useMembers = (slug: string) =>
  useQuery({ queryKey: keys.members(slug), queryFn: () => api.members(slug), select: (d) => d.members });
export const useProjects = (slug: string) =>
  useQuery({ queryKey: keys.projects(slug), queryFn: () => api.projects(slug), select: (d) => d.projects });
export const useProject = (slug: string, id: string) =>
  useQuery({ queryKey: keys.project(slug, id), queryFn: () => api.project(slug, id), enabled: !!id });
export const useLabels = (slug: string) =>
  useQuery({ queryKey: keys.labels(slug), queryFn: () => api.labels(slug), select: (d) => d.labels });
export const useIssues = (slug: string, filter: IssueFilter) =>
  useQuery({ queryKey: keys.issues(slug, filter), queryFn: () => api.issues(slug, filter), select: (d) => d.issues });

/**
 * Updates an issue optimistically in every cached list, then confirms with
 * the server. On failure the caches are restored.
 */
export function useUpdateIssue(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Issue> & Record<string, unknown> }) =>
      api.updateIssue(slug, id, patch),
    onMutate: async ({ id, patch }) => {
      const prefix = ["ws", slug, "issues"];
      await qc.cancelQueries({ queryKey: prefix });
      const snapshot = qc.getQueriesData<{ issues: Issue[] }>({ queryKey: prefix });
      for (const [key, data] of snapshot) {
        // Only list-shaped caches; single-issue lookups share the prefix.
        if (!data || !Array.isArray(data.issues)) continue;
        qc.setQueryData(key, { ...data, issues: data.issues.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
      }
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: ["ws", slug, "issues"] });
      void qc.invalidateQueries({ queryKey: keys.issue(slug, id) });
    },
  });
}
