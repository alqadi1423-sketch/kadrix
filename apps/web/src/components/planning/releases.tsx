import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Issue } from "../../api";
import { Button, ErrorText, Field } from "../../ui";
import { Markdown } from "../markdown";

/** Groups issues into Markdown release notes in the reader's language. */
function notesFrom(issues: Issue[], t: (k: string) => string) {
  const groups: [string, Issue[]][] = [
    [t("releases.features"), issues.filter((i) => i.type === "feature" || i.type === "epic")],
    [t("releases.fixes"), issues.filter((i) => i.type === "bug")],
    [t("releases.other"), issues.filter((i) => i.type === "task")],
  ];
  return groups
    .filter(([, items]) => items.length)
    .map(([title, items]) => `### ${title}\n\n${items.map((i) => `- ${i.title} (${i.key})`).join("\n")}`)
    .join("\n\n");
}

export function ReleasesTab({ slug, projectId, canManage }: { slug: string; projectId: string; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const key = ["ws", slug, "release", projectId];
  const list = useQuery({ queryKey: key, queryFn: () => api.releases(slug, projectId) });
  const draft = useQuery({ queryKey: [...key, "draft"], queryFn: () => api.releaseDraft(slug, projectId), enabled: canManage });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [notes, setNotes] = useState("");
  const pending = draft.data?.issues ?? [];
  const chosen = picked ?? new Set(pending.map((i) => i.id));
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: (input: { version: string; name: string | null }) =>
      api.createRelease(slug, projectId, { ...input, notes: notes || null, issueIds: [...chosen] }),
    onSuccess: () => {
      setNotes("");
      setPicked(null);
      void refresh();
    },
  });
  const publish = useMutation({ mutationFn: (id: string) => api.publishRelease(slug, id), onSuccess: refresh });
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  return (
    <div className="space-y-4">
      {list.isSuccess && list.data.releases.length === 0 && <p className="text-muted">{t("releases.empty")}</p>}
      <ul className="space-y-3">
        {list.data?.releases.map((r) => (
          <li key={r.id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold" dir="ltr">
                {r.version}
              </span>
              {r.name && <span dir="auto">{r.name}</span>}
              <span className={`rounded-full px-2 py-0.5 text-xs ${r.releasedAt ? "bg-[#2e8b57]/15" : "border border-line text-muted"}`}>
                {r.releasedAt ? t("releases.published", { date: fmt.format(new Date(r.releasedAt)) }) : t("releases.draft")}
              </span>
              <span className="text-sm text-muted">{t("releases.issues", { count: r.issueCount })}</span>
              {canManage && !r.releasedAt && (
                <Button className="ms-auto" onClick={() => publish.mutate(r.id)}>
                  {t("releases.publish")}
                </Button>
              )}
            </div>
            {r.notes && <Markdown text={r.notes} />}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="space-y-3 rounded-[var(--radius-panel)] border border-dashed border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create.mutate({ version: String(f.get("version")), name: String(f.get("name") || "") || null });
          }}
        >
          <h3 className="font-semibold">{t("releases.create")}</h3>
          <div className="flex flex-wrap gap-3">
            <div className="w-40">
              <Field label={t("releases.version")} name="version" required maxLength={40} dir="ltr" placeholder="1.0.0" />
            </div>
            <div className="min-w-48 flex-1">
              <Field label={t("releases.name")} name="name" maxLength={120} dir="auto" />
            </div>
          </div>
          {pending.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-sm text-muted">{t("releases.include")}</legend>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {pending.map((i) => (
                  <label key={i.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-petrol"
                      checked={chosen.has(i.id)}
                      onChange={(e) => {
                        const n = new Set(chosen);
                        if (e.target.checked) n.add(i.id);
                        else n.delete(i.id);
                        setPicked(n);
                      }}
                    />
                    <span className="text-xs text-muted" dir="ltr">
                      {i.key}
                    </span>
                    <span dir="auto">{i.title}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm text-muted">{t("releases.notes")}</span>
              <Button type="button" variant="quiet" onClick={() => setNotes(notesFrom(pending.filter((i) => chosen.has(i.id)), t))}>
                {t("releases.generate")}
              </Button>
            </div>
            <textarea
              dir="auto"
              rows={6}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2"
            />
          </div>
          <Button type="submit" disabled={create.isPending}>
            {t("releases.create")}
          </Button>
          <ErrorText error={create.error} />
        </form>
      )}
    </div>
  );
}
