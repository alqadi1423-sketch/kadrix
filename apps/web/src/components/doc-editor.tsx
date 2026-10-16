import { HocuspocusProvider } from "@hocuspocus/provider";
import { Extension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Y from "yjs";

/**
 * Every block gets dir="auto", so an Arabic paragraph flows right-to-left
 * and an English one left-to-right inside the same document.
 */
const AutoDirection = Extension.create({
  name: "autoDirection",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "blockquote", "listItem", "bulletList", "orderedList"],
        attributes: { dir: { default: "auto", renderHTML: () => ({ dir: "auto" }), parseHTML: () => "auto" } },
      },
    ];
  },
});

function colorFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `hsl(${h} 60% 45%)`;
}

/** Live collaborative editor for one page. Content syncs over Yjs; no save button. */
export function DocEditor({ slug, pageId, userName, readOnly }: { slug: string; pageId: string; userName: string; readOnly: boolean }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [peers, setPeers] = useState(1);

  const { doc, provider } = useMemo(() => {
    const d = new Y.Doc();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const p = new HocuspocusProvider({
      url: `${proto}://${location.host}/api/workspaces/${slug}/pages/${pageId}/collab`,
      name: `page:${pageId}`,
      document: d,
    });
    return { doc: d, provider: p };
  }, [slug, pageId]);

  useEffect(() => {
    const onStatus = ({ status: s }: { status: string }) => setStatus(s as typeof status);
    const onAwareness = () => setPeers(provider.awareness?.getStates().size ?? 1);
    provider.on("status", onStatus);
    provider.awareness?.on("change", onAwareness);
    return () => {
      provider.off("status", onStatus);
      provider.awareness?.off("change", onAwareness);
      provider.destroy();
      doc.destroy();
    };
  }, [provider, doc]);

  const editor = useEditor(
    {
      editable: !readOnly,
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: doc }),
        CollaborationCaret.configure({ provider, user: { name: userName, color: colorFor(userName) } }),
        Placeholder.configure({ placeholder: t("docs.placeholder", { example: "WEB-12" }) }),
        AutoDirection,
      ],
      editorProps: { attributes: { class: "prose-kadrix min-h-[50vh] outline-none", "aria-label": t("docs.title") } },
    },
    [doc, provider, readOnly],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-muted" role="status">
        <span className={`inline-block size-2 rounded-full ${status === "connected" ? "bg-[#2e8b57]" : "bg-signal"}`} aria-hidden />
        {status === "connected" ? t("docs.saved") : t("docs.connecting")}
        {peers > 1 && <span>{t("docs.editing", { count: peers })}</span>}
        {readOnly && <span>{t("docs.readOnly")}</span>}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
