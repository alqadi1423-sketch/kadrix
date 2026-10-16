import { PRIORITY_KEYS } from "@kadrix/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Issue, type Label, type Member, type State } from "../api";
import { useQueryClient } from "@tanstack/react-query";
import { Select } from "../ui";
import { StateIcon } from "./icons";
import { IssueRow } from "./issue-row";

/** Issues grouped by state (or flat when states span projects), with multi-select bulk edit. */
export function IssueList({
  slug,
  issues,
  states,
  labels,
  members,
  canEdit,
}: {
  slug: string;
  issues: Issue[];
  states?: State[];
  labels: Label[];
  members: Member[];
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  async function bulk(patch: Record<string, unknown>) {
    await api.bulkUpdate(slug, [...selected], patch);
    setSelected(new Set());
    void qc.invalidateQueries({ queryKey: ["ws", slug, "issues"] });
  }

  const groups: { key: string; title: React.ReactNode; items: Issue[] }[] = states
    ? states
        .map((s) => ({
          key: s.id,
          title: (
            <span className="flex items-center gap-2">
              <StateIcon category={s.category} color={s.color} />
              {s.name}
            </span>
          ),
          items: issues.filter((i) => i.stateId === s.id),
        }))
        .filter((g) => g.items.length > 0)
    : [{ key: "all", title: null, items: issues }];

  return (
    <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      {selected.size > 0 && canEdit && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 text-sm">
          <span className="font-medium">{t("issues.selected", { count: selected.size })}</span>
          {states && (
            <Select aria-label={t("issues.state")} value="" onChange={(e) => e.target.value && bulk({ stateId: e.target.value })}>
              <option value="">{t("issues.state")}</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
          <Select aria-label={t("priority.label")} value="" onChange={(e) => e.target.value && bulk({ priority: Number(e.target.value) })}>
            <option value="">{t("priority.label")}</option>
            {PRIORITY_KEYS.map((k, i) => (
              <option key={k} value={i}>
                {t(`priority.${k}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("issues.assignee")}
            value=""
            onChange={(e) => e.target.value && bulk({ assigneeId: e.target.value === "none" ? null : e.target.value })}
          >
            <option value="">{t("issues.assignee")}</option>
            <option value="none">{t("issues.unassigned")}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
          <button className="ms-auto text-muted hover:text-ink" onClick={() => setSelected(new Set())}>
            {t("common.clear")}
          </button>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.key}>
          {g.title && (
            <h3 className="flex items-center justify-between bg-paper px-4 py-1.5 text-sm font-medium">
              {g.title}
              <span className="text-muted tabular-nums">{g.items.length}</span>
            </h3>
          )}
          <div className="divide-y divide-line">
            {g.items.map((i) => (
              <IssueRow
                key={i.id}
                issue={i}
                slug={slug}
                labels={labels}
                selected={selected.has(i.id)}
                onSelect={canEdit ? (on) => toggle(i.id, on) : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
