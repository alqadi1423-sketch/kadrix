import { useRef, useState, type TextareaHTMLAttributes } from "react";
import type { Member } from "../api";
import { Avatar } from "./icons";

/**
 * Textarea with @-mention autocomplete. Picking a person inserts <@userId>,
 * which the Markdown renderer shows as @Name and the server turns into a
 * notification. Works the same for Arabic and Latin names.
 */
export function MentionTextarea({
  value,
  onChange,
  members,
  className = "",
  onKeyDown: onKeyDownProp,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  value: string;
  onChange: (v: string) => void;
  members: Member[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);

  const matches = query
    ? members.filter((m) => m.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 6)
    : [];

  function detect(el: HTMLTextAreaElement) {
    const upto = el.value.slice(0, el.selectionStart);
    const m = /(^|\s)@([^\s@<>]{0,30})$/.exec(upto);
    setQuery(m ? { start: upto.length - m[2]!.length - 1, text: m[2]! } : null);
    setActive(0);
  }

  function pick(m: Member) {
    const el = ref.current;
    if (!el || !query) return;
    const before = value.slice(0, query.start);
    const after = value.slice(el.selectionStart);
    const token = `<@${m.userId}> `;
    onChange(before + token + after);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        dir="auto"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target);
        }}
        onKeyDown={(e) => {
          if (!matches.length) {
            onKeyDownProp?.(e);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(matches[active]!);
          } else if (e.key === "Escape") {
            setQuery(null);
          }
        }}
        className={`w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-petrol ${className}`}
        {...rest}
      />
      {matches.length > 0 && (
        <ul role="listbox" className="absolute start-2 top-full z-20 mt-1 w-60 overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface shadow-lg">
          {matches.map((m, i) => (
            <li
              key={m.userId}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${i === active ? "bg-petrol/10" : ""}`}
            >
              <Avatar name={m.name} />
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
