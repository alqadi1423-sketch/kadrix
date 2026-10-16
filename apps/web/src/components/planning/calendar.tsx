import { addDays, formatDate, parseDate } from "@veloq/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api";
import { useWorkspace } from "../../lib/hooks";
import { StateIcon } from "../icons";

/**
 * Month grid of due dates. The week starts the day after the workspace's
 * weekend ends (Sunday for a Friday–Saturday weekend, Monday for
 * Saturday–Sunday), and weekend columns are shaded.
 */
export function CalendarTab({ slug, projectId }: { slug: string; projectId?: string }) {
  const { t, i18n } = useTranslation();
  const ws = useWorkspace(slug);
  const weekend = ws.data?.workspace.weekendDays ?? [5, 6];
  const [month, setMonth] = useState(() => formatDate(new Date()).slice(0, 7));
  const first = `${month}-01`;
  const firstDate = parseDate(first);
  const weekStart = weekend.length ? (Math.max(...weekend) + 1) % 7 : 0;
  const lead = (firstDate.getUTCDay() - weekStart + 7) % 7;
  const gridStart = addDays(first, -lead);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const gridEnd = cells.at(-1)!;
  const data = useQuery({
    queryKey: ["ws", slug, "issues", "calendar", projectId ?? "all", gridStart],
    queryFn: () => api.calendar(slug, gridStart, gridEnd, projectId),
  });
  const shiftMonth = (n: number) => {
    const d = parseDate(first);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(formatDate(d).slice(0, 7));
  };
  const title = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric", timeZone: "UTC" }).format(firstDate);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "short", timeZone: "UTC" });
  const today = formatDate(new Date());

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button className="rounded px-2 py-1 text-muted hover:bg-paper" onClick={() => shiftMonth(-1)} aria-label={t("calendar.previous")}>
          <span className="inline-block rtl:rotate-180">‹</span>
        </button>
        <h3 className="min-w-40 text-center font-semibold">{title}</h3>
        <button className="rounded px-2 py-1 text-muted hover:bg-paper" onClick={() => shiftMonth(1)} aria-label={t("calendar.next")}>
          <span className="inline-block rtl:rotate-180">›</span>
        </button>
        <button className="ms-2 text-sm text-petrol" onClick={() => setMonth(today.slice(0, 7))}>
          {t("calendar.today")}
        </button>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface text-sm">
        {cells.slice(0, 7).map((d) => (
          <div key={`h${d}`} className="border-b border-line px-2 py-1 text-xs text-muted">
            {weekday.format(parseDate(d))}
          </div>
        ))}
        {cells.map((d) => {
          const inMonth = d.startsWith(month);
          const items = (data.data?.issues ?? []).filter((i) => i.dueDate === d);
          const ms = (data.data?.milestones ?? []).filter((m) => m.targetDate === d);
          const off = weekend.includes(parseDate(d).getUTCDay());
          return (
            <div key={d} className={`min-h-24 border-b border-e border-line p-1 ${off ? "bg-paper" : ""} ${inMonth ? "" : "opacity-50"}`}>
              <div className={`mb-1 text-xs tabular-nums ${d === today ? "inline-grid size-5 place-items-center rounded-full bg-petrol text-white dark:text-ink" : "text-muted"}`}>
                {parseDate(d).getUTCDate()}
              </div>
              {ms.map((m) => (
                <div key={m.id} className="mb-0.5 flex items-center gap-1 truncate text-xs" title={m.name}>
                  <span className="size-2 shrink-0 rotate-45 bg-signal" />
                  <span className="truncate">{m.name}</span>
                </div>
              ))}
              {items.slice(0, 4).map((i) => (
                <Link
                  key={i.id}
                  to="/w/$slug/i/$key"
                  params={{ slug, key: i.key }}
                  className="mb-0.5 flex items-center gap-1 truncate rounded px-1 text-xs text-ink no-underline hover:bg-paper"
                  title={i.title}
                >
                  <StateIcon category={i.stateCategory} color={i.stateColor} />
                  <span className="truncate" dir="auto">
                    {i.title}
                  </span>
                </Link>
              ))}
              {items.length > 4 && <div className="px-1 text-xs text-muted">+{items.length - 4}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
