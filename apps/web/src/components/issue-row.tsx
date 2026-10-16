import { Link } from "@tanstack/react-router";
import type { Issue, Label } from "../api";
import { Avatar, LabelChip, PriorityIcon, StateIcon } from "./icons";

export function IssueRow({
  issue,
  slug,
  labels,
  selected,
  onSelect,
}: {
  issue: Issue;
  slug: string;
  labels: Label[];
  selected?: boolean;
  onSelect?: (on: boolean) => void;
}) {
  const own = labels.filter((l) => issue.labelIds.includes(l.id));
  return (
    <div className={`group flex items-center gap-3 px-4 py-2 hover:bg-paper ${selected ? "bg-petrol/5" : ""}`}>
      {onSelect && (
        <input
          type="checkbox"
          aria-label={issue.key}
          checked={!!selected}
          onChange={(e) => onSelect(e.target.checked)}
          className="accent-petrol opacity-40 group-hover:opacity-100 focus:opacity-100"
        />
      )}
      <PriorityIcon priority={issue.priority} />
      <span className="w-16 shrink-0 text-xs text-muted tabular-nums" dir="ltr">
        {issue.key}
      </span>
      <StateIcon category={issue.stateCategory} color={issue.stateColor} />
      <Link
        to="/w/$slug/i/$key"
        params={{ slug, key: issue.key }}
        className="min-w-0 flex-1 truncate text-ink no-underline"
        dir="auto"
      >
        {issue.title}
      </Link>
      <span className="hidden gap-1 md:flex">
        {own.slice(0, 3).map((l) => (
          <LabelChip key={l.id} name={l.name} color={l.color} />
        ))}
      </span>
      {issue.dueDate && (
        <span className="hidden text-xs text-muted tabular-nums sm:inline" dir="ltr">
          {issue.dueDate}
        </span>
      )}
      <Avatar name={issue.assigneeName} />
    </div>
  );
}
