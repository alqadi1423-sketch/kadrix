import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Small dependency-free charts. Charts keep a left-to-right numeric axis in
 * both languages (time flows the same way in Arabic dashboards), while all
 * text around them follows the page direction.
 *
 * Rules applied: one y-axis, thin 2px lines, recessive grid, legend for 2+
 * series plus direct end labels, crosshair tooltip on hover/focus, and a
 * table view so nothing is conveyed by colour alone.
 */

export interface Series {
  name: string;
  /** CSS colour, e.g. var(--color-chart-1). Reference lines use var(--color-muted). */
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

const W = 640;
const H = 220;
const PAD = { top: 12, right: 64, bottom: 28, left: 36 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

export function LineChart({ labels, series, title }: { labels: string[]; series: Series[]; title: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(labels.length / 6));

  if (table) {
    return (
      <figure className="space-y-2">
        <ChartHeader title={title} table={table} onToggle={() => setTable(false)} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted">
                <th className="px-2 py-1 text-start font-normal" />
                {series.map((s) => (
                  <th key={s.name} className="px-2 py-1 text-end font-normal">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={l} className="border-t border-line">
                  <td className="px-2 py-1" dir="ltr">
                    {l}
                  </td>
                  {series.map((s) => (
                    <td key={s.name} className="px-2 py-1 text-end tabular-nums">
                      {s.values[i] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>
    );
  }

  return (
    <figure className="space-y-2">
      <ChartHeader title={title} table={table} onToggle={() => setTable(true)} />
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <svg width="18" height="6">
                <line x1="0" y1="3" x2="18" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
              </svg>
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <div dir="ltr" className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-labelledby={`${id}-t`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min((h ?? -1) + 1, labels.length - 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max((h ?? labels.length) - 1, 0));
            if (e.key === "Escape") setHover(null);
          }}
          onBlur={() => setHover(null)}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const i = Math.round(((px - PAD.left) / iw) * (labels.length - 1));
            setHover(Math.min(Math.max(i, 0), labels.length - 1));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <title id={`${id}-t`}>{title}</title>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">
                {Math.round(v * 10) / 10}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || i === labels.length - 1 ? (
              <text key={l} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
                {l.slice(5)}
              </text>
            ) : null,
          )}
          {series.map((s) => {
            const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
            const lastIdx = s.values.reduce<number>((a, v, i) => (v === null ? a : i), -1);
            const last = lastIdx >= 0 ? s.values[lastIdx]! : null;
            return (
              <g key={s.name}>
                <polyline
                  points={pts.join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                />
                {last !== null && (
                  <text x={x(lastIdx) + 6} y={y(last) + 4} fontSize="11" fill="var(--color-ink)">
                    {s.name.length > 10 ? `${s.name.slice(0, 9)}…` : s.name}
                  </text>
                )}
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} stroke="var(--color-muted)" strokeWidth="1" />
              {series.map((s) =>
                s.values[hover] != null ? (
                  <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r="4.5" fill={s.color} stroke="var(--color-surface)" strokeWidth="2" />
                ) : null,
              )}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs shadow"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${x(hover) > W / 2 ? "-105%" : "5%"})` }}
          >
            <div className="mb-1 font-medium">{labels[hover]}</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                <span className="text-muted">{s.name}</span>
                <span className="ms-auto tabular-nums">{s.values[hover] ?? "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="sr-only">{t("charts.keyboardHint")}</p>
    </figure>
  );
}

export function BarChart({ labels, values, title, color = "var(--color-chart-1)" }: { labels: string[]; values: number[]; title: string; color?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = niceMax(Math.max(1, ...values));
  const iw = W - PAD.left - 16;
  const ih = H - PAD.top - PAD.bottom;
  const band = iw / Math.max(values.length, 1);
  const bw = Math.min(40, band * 0.6);
  if (table) {
    return (
      <figure className="space-y-2">
        <ChartHeader title={title} table onToggle={() => setTable(false)} />
        <table className="w-full text-sm">
          <tbody>
            {labels.map((l, i) => (
              <tr key={l} className="border-t border-line">
                <td className="px-2 py-1">{l}</td>
                <td className="px-2 py-1 text-end tabular-nums">{values[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    );
  }
  return (
    <figure className="space-y-2">
      <ChartHeader title={title} table={false} onToggle={() => setTable(true)} />
      <div dir="ltr">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title} onPointerLeave={() => setHover(null)}>
          {[0, max / 2, max].map((v) => {
            const yy = PAD.top + ih - (v / max) * ih;
            return (
              <g key={v}>
                <line x1={PAD.left} x2={W - 16} y1={yy} y2={yy} stroke="var(--color-line)" />
                <text x={PAD.left - 6} y={yy + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">
                  {Math.round(v * 10) / 10}
                </text>
              </g>
            );
          })}
          {values.map((v, i) => {
            const h = (v / max) * ih;
            const cx = PAD.left + band * i + band / 2;
            return (
              <g key={labels[i]} onPointerEnter={() => setHover(i)}>
                <rect x={cx - band / 2} y={PAD.top} width={band} height={ih} fill="transparent" />
                <path
                  d={`M${cx - bw / 2},${PAD.top + ih} V${PAD.top + ih - h + 4} Q${cx - bw / 2},${PAD.top + ih - h} ${cx - bw / 2 + 4},${PAD.top + ih - h} H${cx + bw / 2 - 4} Q${cx + bw / 2},${PAD.top + ih - h} ${cx + bw / 2},${PAD.top + ih - h + 4} V${PAD.top + ih} Z`}
                  fill={color}
                  opacity={hover === null || hover === i ? 1 : 0.5}
                />
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
                  {labels[i]}
                </text>
                {hover === i && (
                  <text x={cx} y={PAD.top + ih - h - 6} textAnchor="middle" fontSize="12" fill="var(--color-ink)">
                    {v}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

function ChartHeader({ title, table, onToggle }: { title: string; table: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <figcaption className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold">{title}</span>
      <button className="text-xs text-muted hover:text-ink" onClick={onToggle}>
        {table ? t("charts.showChart") : t("charts.showTable")}
      </button>
    </figcaption>
  );
}
