import type { StateCategory } from "@kadrix/core";
import { PRIORITY_KEYS } from "@kadrix/core";
import { useTranslation } from "react-i18next";

/** Signal bars; urgent gets a solid amber block so it reads at a glance. */
export function PriorityIcon({ priority }: { priority: number }) {
  const { t } = useTranslation();
  const label = t(`priority.${PRIORITY_KEYS[priority] ?? "none"}`);
  if (priority === 1) {
    return (
      <span title={label} aria-label={label} role="img" className="inline-grid size-4 place-items-center rounded-[3px] bg-signal text-[10px] font-bold text-ink">
        !
      </span>
    );
  }
  const level = priority === 0 ? 0 : 5 - priority; // high=3 bars, medium=2, low=1
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={label}>
      <title>{label}</title>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * 5}
          y={11 - i * 4}
          width="3"
          height={3 + i * 4}
          rx="1"
          fill={i < level ? "currentColor" : "var(--color-line)"}
        />
      ))}
    </svg>
  );
}

/** Ring that fills as work progresses through the state categories. */
export function StateIcon({ category, color }: { category: StateCategory; color: string }) {
  const fill = { triage: 0, backlog: 0, unstarted: 0, started: 0.5, completed: 1, canceled: 1 }[category];
  const dashed = category === "backlog" || category === "triage";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={dashed ? "2 2" : undefined} />
      {fill > 0 && category !== "canceled" && (
        <path
          d={fill === 1 ? "M7 3a4 4 0 1 1 0 8a4 4 0 1 1 0-8" : "M7 3a4 4 0 0 1 0 8z"}
          fill={color}
        />
      )}
      {category === "canceled" && <path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke={color} strokeWidth="1.5" />}
    </svg>
  );
}

export function Avatar({ name, size = 20 }: { name: string | null | undefined; size?: number }) {
  if (!name) {
    return <span className="inline-block rounded-full border border-dashed border-muted" style={{ width: size, height: size }} />;
  }
  // Stable hue per name so people are recognisable across lists.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  const initial = [...name.trim()][0] ?? "?";
  return (
    <span
      title={name}
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.5, background: `hsl(${h} 45% 42%)` }}
    >
      {initial}
    </span>
  );
}

export function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}
