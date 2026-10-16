import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";
import type { Member } from "../api";

marked.setOptions({ gfm: true, breaks: true });

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Renders user Markdown safely. Mentions are stored as <@userId> and shown
 * as @Name. Output is sanitized, so raw HTML in descriptions can't run.
 * `dir="auto"` lets each paragraph follow its own language direction.
 */
export function Markdown({ text, members = [] }: { text: string; members?: Member[] }) {
  const html = useMemo(() => {
    const byId = new Map(members.map((m) => [m.userId, m.name]));
    const withMentions = text.replace(/<@([A-Za-z0-9_-]{6,64})>/g, (_m, id: string) => {
      const name = byId.get(id);
      return name ? `<span class="mention" dir="auto">@${escapeHtml(name)}</span>` : "@?";
    });
    const raw = marked.parse(withMentions, { async: false });
    return DOMPurify.sanitize(raw, { ADD_ATTR: ["dir"], FORBID_TAGS: ["style", "form", "input"] });
  }, [text, members]);
  return <div dir="auto" className="prose-kadrix" dangerouslySetInnerHTML={{ __html: html }} />;
}
