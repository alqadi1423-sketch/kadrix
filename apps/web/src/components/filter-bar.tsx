import { ISSUE_TYPES, PRIORITY_KEYS, type IssueFilter } from "@kadrix/core";
import { useTranslation } from "react-i18next";
import type { Label, Member } from "../api";
import { Select } from "../ui";

/** Compact filters that edit an IssueFilter. Each control maps to one field. */
export function FilterBar({
  filter,
  onChange,
  members,
  labels,
}: {
  filter: IssueFilter;
  onChange: (f: IssueFilter) => void;
  members: Member[];
  labels: Label[];
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<IssueFilter>) => onChange({ ...filter, ...patch });
  const one = <T,>(v: string, map: (s: string) => T) => (v === "" ? undefined : [map(v)]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        dir="auto"
        placeholder={t("common.search")}
        aria-label={t("common.search")}
        value={filter.search ?? ""}
        onChange={(e) => set({ search: e.target.value || undefined })}
        className="min-w-40 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-petrol sm:flex-none"
      />
      <Select
        aria-label={t("issues.assignee")}
        value={filter.assigneeId?.[0] ?? ""}
        onChange={(e) => set({ assigneeId: one(e.target.value, String) })}
      >
        <option value="">{t("issues.assignee")}</option>
        <option value="none">{t("issues.unassigned")}</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t("priority.label")}
        value={filter.priority?.[0] ?? ""}
        onChange={(e) => set({ priority: one(e.target.value, Number) })}
      >
        <option value="">{t("priority.label")}</option>
        {PRIORITY_KEYS.map((k, i) => (
          <option key={k} value={i}>
            {t(`priority.${k}`)}
          </option>
        ))}
      </Select>
      <Select aria-label={t("labels.title")} value={filter.labelId?.[0] ?? ""} onChange={(e) => set({ labelId: one(e.target.value, String) })}>
        <option value="">{t("labels.title")}</option>
        {labels.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t("issueTypes.label")}
        value={filter.type?.[0] ?? ""}
        onChange={(e) => set({ type: one(e.target.value, (v) => v as (typeof ISSUE_TYPES)[number]) })}
      >
        <option value="">{t("issueTypes.label")}</option>
        {ISSUE_TYPES.map((k) => (
          <option key={k} value={k}>
            {t(`issueTypes.${k}`)}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1.5 text-sm text-muted">
        <input
          type="checkbox"
          className="accent-petrol"
          checked={!!filter.includeClosed}
          onChange={(e) => set({ includeClosed: e.target.checked || undefined })}
        />
        {t("common.showClosed")}
      </label>
    </div>
  );
}
