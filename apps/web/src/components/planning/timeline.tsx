import { addDays, daysBetween, eachDay, formatDate, isWorkingDay, parseDate } from "@kadrix/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Issue } from "../../api";
import { useUpdateIssue } from "../../lib/hooks";
import { StateIcon } from "../icons";

const DAY = 28; // px per day
const ROW = 36;
const HEAD = 44;

/**
 * Gantt-style timeline. Bars are positioned with logical offsets, so the
 * chart flows right-to-left in Arabic like the rest of the page. Dependency
 * arrows are drawn in an SVG that is mirrored in RTL to stay aligned.
 * Dragging a bar shifts its dates by whole days; weekends are shaded.
 */
export function TimelineTab({ slug, projectId, canEdit }: { slug: string; projectId: string; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const data = useQuery({ queryKey: ["ws", slug, "issues", "timeline", projectId], queryFn: () => api.timeline(slug, projectId) });
  const update = useUpdateIssue(slug);
  const rtl = i18n.dir() === "rtl";
  const [drag, setDrag] = useState<{ id: string; startX: number; delta: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  if (!data.data) return <p className="text-muted">{t("common.loading")}</p>;
  const { issues, dependencies, criticalPath, criticalLength, milestones, weekend, undated } = data.data;
  if (issues.length === 0) return <p className="text-muted">{t("timeline.empty")}</p>;

  const today = formatDate(new Date());
  const span = (i: Issue) => {
    const s = i.startDate ?? i.dueDate!;
    const e = i.dueDate ?? i.startDate!;
    return s <= e ? [s, e] : [e, s];
  };
  const dates = issues.flatMap(span).concat(milestones.map((m) => m.targetDate).filter((d): d is string => !!d), [today]);
  const from = addDays(dates.reduce((a, b) => (a < b ? a : b)), -3);
  const to = addDays(dates.reduce((a, b) => (a > b ? a : b)), 7);
  const days = eachDay(from, to);
  const width = days.length * DAY;
  const rows = [...issues].sort((a, b) => span(a)[0]!.localeCompare(span(b)[0]!));
  const rowOf = new Map(rows.map((r, i) => [r.id, i]));
  const critical = new Set(criticalPath);
  const offset = (d: string) => daysBetween(from, d) * DAY;
  const fmtMonth = new Intl.DateTimeFormat(i18n.language, { month: "short" });

  const shiftFor = (id: string) => (drag && drag.id === id ? Math.round(drag.delta / DAY) : 0);

  function onPointerDown(e: React.PointerEvent, id: string) {
    if (!canEdit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, startX: e.clientX, delta: 0 });
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const raw = e.clientX - drag.startX;
    setDrag({ ...drag, delta: rtl ? -raw : raw });
  }
  function onPointerUp() {
    if (!drag) return;
    const n = Math.round(drag.delta / DAY);
    const issue = issues.find((i) => i.id === drag.id);
    setDrag(null);
    if (!issue || n === 0) return;
    update.mutate(
      {
        id: issue.id,
        patch: {
          ...(issue.startDate ? { startDate: addDays(issue.startDate, n) } : {}),
          ...(issue.dueDate ? { dueDate: addDays(issue.dueDate, n) } : {}),
        },
      },
      { onSettled: () => data.refetch() },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
        {criticalPath.length > 1 && (
          <span className="flex items-center gap-2">
            <span className="inline-block h-3 w-6 rounded-sm border-2 border-signal" aria-hidden />
            {t("timeline.criticalPath", { days: criticalLength })}
          </span>
        )}
        {undated > 0 && <span>{t("timeline.undated", { count: undated })}</span>}
      </div>
      <div className="flex overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="w-56 shrink-0 border-e border-line">
          <div style={{ height: HEAD }} className="border-b border-line" />
          {rows.map((i) => (
            <div key={i.id} style={{ height: ROW }} className="flex items-center gap-2 border-b border-line px-3 text-sm last:border-b-0">
              <StateIcon category={i.stateCategory} color={i.stateColor} />
              <Link to="/w/$slug/i/$key" params={{ slug, key: i.key }} className="truncate text-ink no-underline" dir="auto" title={i.title}>
                {i.title}
              </Link>
            </div>
          ))}
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          <div className="relative" style={{ width, height: HEAD + rows.length * ROW }}>
            {/* weekend shading + day header */}
            {days.map((d, idx) => {
              const date = parseDate(d);
              const first = date.getUTCDate() === 1 || idx === 0;
              return (
                <div key={d} className="absolute top-0 bottom-0" style={{ insetInlineStart: idx * DAY, width: DAY }}>
                  {!isWorkingDay(d, weekend) && <div className="absolute inset-0 bg-paper" />}
                  <div className="relative flex h-[44px] flex-col items-center justify-end border-b border-line pb-1 text-[11px] text-muted">
                    {first && <span className="font-medium text-ink">{fmtMonth.format(date)}</span>}
                    <span className="tabular-nums">{date.getUTCDate()}</span>
                  </div>
                </div>
              );
            })}
            {/* today */}
            <div className="absolute bottom-0 w-0.5 bg-danger/70" style={{ top: HEAD, insetInlineStart: offset(today) + DAY / 2 }} title={t("timeline.today")} />
            {/* milestones */}
            {milestones
              .filter((m) => m.targetDate)
              .map((m) => (
                <div
                  key={m.id}
                  className="absolute flex items-center gap-1"
                  style={{ top: 2, insetInlineStart: offset(m.targetDate!) + DAY / 2 - 5 }}
                  title={m.name}
                >
                  <span className="size-2.5 rotate-45 bg-signal" />
                </div>
              ))}
            {/* dependency arrows (drawn LTR, mirrored in RTL) */}
            <svg
              className="pointer-events-none absolute inset-0"
              width={width}
              height={HEAD + rows.length * ROW}
              style={rtl ? { transform: "scaleX(-1)" } : undefined}
              aria-hidden
            >
              <defs>
                <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--color-muted)" />
                </marker>
              </defs>
              {dependencies.map((d) => {
                const a = issues.find((i) => i.id === d.from);
                const b = issues.find((i) => i.id === d.to);
                if (!a || !b) return null;
                const x1 = offset(span(a)[1]!) + DAY + shiftFor(a.id) * DAY;
                const x2 = offset(span(b)[0]!) + shiftFor(b.id) * DAY;
                const y1 = HEAD + rowOf.get(a.id)! * ROW + ROW / 2;
                const y2 = HEAD + rowOf.get(b.id)! * ROW + ROW / 2;
                const mid = Math.max(x1 + 8, Math.min(x2 - 8, (x1 + x2) / 2));
                const hot = critical.has(a.id) && critical.has(b.id);
                return (
                  <path
                    key={`${d.from}-${d.to}`}
                    d={`M${x1},${y1} H${mid} V${y2} H${x2}`}
                    fill="none"
                    stroke={hot ? "var(--color-signal)" : "var(--color-muted)"}
                    strokeWidth={hot ? 2 : 1.25}
                    markerEnd="url(#arrow)"
                  />
                );
              })}
            </svg>
            {/* bars */}
            {rows.map((i, r) => {
              const [s, e] = span(i);
              const shift = shiftFor(i.id);
              const left = offset(s!) + shift * DAY;
              const w = (daysBetween(s!, e!) + 1) * DAY;
              const crit = critical.has(i.id);
              return (
                <div
                  key={i.id}
                  role={canEdit ? "button" : undefined}
                  tabIndex={canEdit ? 0 : -1}
                  aria-label={`${i.key} ${i.title} ${s} – ${e}`}
                  title={`${i.key} ${i.title}`}
                  onPointerDown={(ev) => onPointerDown(ev, i.id)}
                  onKeyDown={(ev) => {
                    if (!canEdit) return;
                    const forward = rtl ? "ArrowLeft" : "ArrowRight";
                    const back = rtl ? "ArrowRight" : "ArrowLeft";
                    const n = ev.key === forward ? 1 : ev.key === back ? -1 : 0;
                    if (!n) return;
                    ev.preventDefault();
                    update.mutate(
                      {
                        id: i.id,
                        patch: {
                          ...(i.startDate ? { startDate: addDays(i.startDate, n) } : {}),
                          ...(i.dueDate ? { dueDate: addDays(i.dueDate, n) } : {}),
                        },
                      },
                      { onSettled: () => data.refetch() },
                    );
                  }}
                  className={`absolute flex items-center overflow-hidden rounded-[6px] px-2 text-xs text-white select-none ${canEdit ? "cursor-grab" : ""} ${crit ? "ring-2 ring-signal" : ""}`}
                  style={{
                    top: HEAD + r * ROW + 7,
                    height: ROW - 14,
                    insetInlineStart: left + 2,
                    width: Math.max(w - 4, 8),
                    background: i.stateCategory === "completed" ? "var(--color-muted)" : "var(--color-chart-1)",
                  }}
                >
                  <span className="truncate" dir="ltr">
                    {i.key}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {criticalPath.length > 1 && <p className="text-xs text-muted">{t("timeline.criticalHint")}</p>}
    </div>
  );
}
