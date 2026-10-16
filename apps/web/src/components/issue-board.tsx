import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { Issue, Label, State } from "../api";
import { useUpdateIssue } from "../lib/hooks";
import { Avatar, LabelChip, PriorityIcon, StateIcon } from "./icons";

/**
 * Kanban board. Dragging between columns changes the state; dragging within
 * a column changes sortOrder (midpoint between neighbours). Keyboard dragging
 * works through dnd-kit's keyboard sensor. Columns flow in reading direction.
 */
export function IssueBoard({
  slug,
  issues,
  states,
  labels,
  wipLimits = {},
}: {
  slug: string;
  issues: Issue[];
  states: State[];
  labels: Label[];
  wipLimits?: Record<string, number>;
}) {
  const update = useUpdateIssue(slug);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byState = new Map(states.map((s) => [s.id, [] as Issue[]]));
  for (const i of [...issues].sort((a, b) => a.sortOrder - b.sortOrder)) byState.get(i.stateId)?.push(i);

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    const moving = issues.find((i) => i.id === id);
    if (!moving) return;
    const targetState = states.find((s) => s.id === overId)?.id ?? issues.find((i) => i.id === overId)?.stateId;
    if (!targetState) return;
    const column = (byState.get(targetState) ?? []).filter((i) => i.id !== id);
    const overIndex = column.findIndex((i) => i.id === overId);
    const index = overIndex === -1 ? column.length : overIndex;
    const prev = column[index - 1]?.sortOrder;
    const next = column[index]?.sortOrder;
    const sortOrder =
      prev !== undefined && next !== undefined ? (prev + next) / 2 : prev !== undefined ? prev + 1000 : next !== undefined ? next - 1000 : 0;
    const patch: Record<string, unknown> = { sortOrder };
    if (targetState !== moving.stateId) {
      const s = states.find((x) => x.id === targetState)!;
      Object.assign(patch, { stateId: s.id, stateName: s.name, stateCategory: s.category, stateColor: s.color });
    }
    update.mutate({ id, patch });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {states.map((s) => (
          <Column key={s.id} state={s} issues={byState.get(s.id) ?? []} slug={slug} labels={labels} wip={wipLimits[s.id]} />
        ))}
      </div>
    </DndContext>
  );
}

function Column({ state, issues, slug, labels, wip }: { state: State; issues: Issue[]; slug: string; labels: Label[]; wip?: number }) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: state.id });
  const over = wip !== undefined && issues.length > wip;
  return (
    <section
      ref={setNodeRef}
      aria-label={state.name}
      className={`flex w-72 shrink-0 flex-col rounded-[var(--radius-panel)] bg-paper p-2 ${isOver ? "ring-2 ring-petrol/40" : ""}`}
    >
      <header className="mb-2 flex items-center gap-2 px-1 text-sm font-medium">
        <StateIcon category={state.category} color={state.color} />
        <span className="flex-1 truncate">{state.name}</span>
        <span className={`tabular-nums ${over ? "font-semibold text-danger" : "text-muted"}`}>
          {issues.length}
          {wip !== undefined && ` / ${wip}`}
        </span>
      </header>
      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-16 flex-col gap-2">
          {issues.map((i) => (
            <Card key={i.id} issue={i} slug={slug} labels={labels} />
          ))}
          {issues.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted">{t("common.none")}</p>}
        </div>
      </SortableContext>
    </section>
  );
}

function Card({ issue, slug, labels }: { issue: Issue; slug: string; labels: Label[] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.id });
  const own = labels.filter((l) => issue.labelIds.includes(l.id));
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`cursor-grab rounded-[var(--radius-control)] border border-line bg-surface p-3 text-sm ${isDragging ? "opacity-60 shadow-lg" : ""}`}
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-muted">
        <span dir="ltr" className="tabular-nums">
          {issue.key}
        </span>
        <span className="flex-1" />
        <Avatar name={issue.assigneeName} size={18} />
      </div>
      <Link
        to="/w/$slug/i/$key"
        params={{ slug, key: issue.key }}
        className="mb-2 block text-ink no-underline"
        dir="auto"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {issue.title}
      </Link>
      <div className="flex flex-wrap items-center gap-1">
        <PriorityIcon priority={issue.priority} />
        {own.map((l) => (
          <LabelChip key={l.id} name={l.name} color={l.color} />
        ))}
        {issue.estimate !== null && <span className="text-xs text-muted tabular-nums">{issue.estimate}</span>}
      </div>
    </article>
  );
}
