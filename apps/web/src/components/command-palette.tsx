import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useProjects } from "../lib/hooks";
import { StateIcon } from "./icons";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: () => void;
}

/** Ctrl/⌘+K menu: jump anywhere, run actions, search issues by text or ID. */
export function CommandPalette({
  slug,
  open,
  onClose,
  onNewIssue,
  onShortcuts,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  onNewIssue: () => void;
  onShortcuts: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const projects = useProjects(slug);
  const search = q.trim();
  const results = useQuery({
    queryKey: ["ws", slug, "issues", "palette", search],
    queryFn: () => api.issues(slug, { search, includeClosed: true }),
    enabled: open && search.length > 1,
    select: (d) => d.issues.slice(0, 8),
  });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setActive(0);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string, params: Record<string, string>) => () => {
      void navigate({ to: to as never, params: params as never });
      onClose();
    };
    const base: Item[] = [
      { id: "new", group: t("command.actions"), label: t("issues.newIssue"), hint: "C", run: () => (onClose(), onNewIssue()) },
      { id: "keys", group: t("command.actions"), label: t("command.shortcuts"), hint: "?", run: () => (onClose(), onShortcuts()) },
      { id: "inbox", group: t("command.goTo"), label: t("nav.inbox"), run: go("/w/$slug/inbox", { slug }) },
      { id: "mine", group: t("command.goTo"), label: t("nav.myIssues"), run: go("/w/$slug", { slug }) },
      { id: "projects", group: t("command.goTo"), label: t("nav.projects"), run: go("/w/$slug/projects", { slug }) },
      { id: "settings", group: t("command.goTo"), label: t("nav.settings"), run: go("/w/$slug/settings", { slug }) },
      ...(projects.data ?? []).map((p) => ({
        id: `p-${p.id}`,
        group: t("command.goTo"),
        label: p.name,
        hint: p.key,
        run: go("/w/$slug/p/$projectId", { slug, projectId: p.id }),
      })),
    ];
    const needle = search.toLowerCase();
    const filtered = needle ? base.filter((i) => i.label.toLowerCase().includes(needle) || i.hint?.toLowerCase() === needle) : base;
    const found = (results.data ?? []).map((i) => ({
      id: `i-${i.id}`,
      group: t("command.issues"),
      label: i.title,
      hint: i.key,
      icon: <StateIcon category={i.stateCategory} color={i.stateColor} />,
      run: go("/w/$slug/i/$key", { slug, key: i.key }),
    }));
    return [...found, ...filtered];
  }, [search, results.data, projects.data, slug, t, navigate, onClose, onNewIssue, onShortcuts]);

  useEffect(() => setActive(0), [search]);

  let lastGroup = "";
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={t("command.placeholder")}
      className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-[var(--radius-panel)] border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
    >
      {open && (
        <div>
          <input
            autoFocus
            dir="auto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                items[active]?.run();
              }
            }}
            placeholder={t("command.placeholder")}
            aria-label={t("command.placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            className="w-full border-b border-line bg-transparent px-4 py-3 text-base outline-none"
          />
          <ul id="palette-list" role="listbox" className="max-h-80 overflow-y-auto py-2">
            {items.length === 0 && <li className="px-4 py-3 text-sm text-muted">{t("common.noResults")}</li>}
            {items.map((item, idx) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <li key={item.id} role="presentation">
                  {header && <div className="px-4 pb-1 pt-2 text-xs text-muted">{header}</div>}
                  <div
                    role="option"
                    aria-selected={idx === active}
                    onMouseEnter={() => setActive(idx)}
                    onClick={item.run}
                    className={`mx-2 flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm ${idx === active ? "bg-petrol/10" : ""}`}
                  >
                    {item.icon}
                    <span className="flex-1 truncate" dir="auto">
                      {item.label}
                    </span>
                    {item.hint && (
                      <kbd className="text-xs text-muted" dir="ltr">
                        {item.hint}
                      </kbd>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </dialog>
  );
}
