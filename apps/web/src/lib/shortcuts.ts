import { useEffect } from "react";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest("[contenteditable=true]"));

/**
 * Global keyboard shortcuts. Single keys and "g then x" sequences are ignored
 * while typing; Ctrl/⌘+K always works. Keys are matched on `event.code` for
 * letters so they work on an Arabic keyboard layout too.
 */
export function useShortcuts(map: { palette: () => void; newIssue: () => void; help: () => void; go: (k: "i" | "m" | "p") => void }) {
  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK") {
        e.preventDefault();
        map.palette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      if (pendingG) {
        pendingG = false;
        if (timer) clearTimeout(timer);
        const k = { KeyI: "i", KeyM: "m", KeyP: "p" }[e.code] as "i" | "m" | "p" | undefined;
        if (k) {
          e.preventDefault();
          map.go(k);
        }
        return;
      }
      if (e.code === "KeyC") {
        e.preventDefault();
        map.newIssue();
      } else if (e.code === "KeyG") {
        pendingG = true;
        timer = setTimeout(() => (pendingG = false), 1000);
      } else if (e.key === "?" || (e.shiftKey && e.code === "Slash")) {
        e.preventDefault();
        map.help();
      } else if (e.code === "Slash") {
        e.preventDefault();
        map.palette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}
