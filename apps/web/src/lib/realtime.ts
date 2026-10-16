import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Keeps the open workspace live: the server sends "something changed"
 * notices and we refetch the affected queries through the normal API.
 * Reconnects with backoff when the connection drops.
 */
export function useRealtime(slug: string) {
  const qc = useQueryClient();
  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${location.host}/api/workspaces/${slug}/live`);
      socket.onopen = () => {
        retry = 0;
        // Anything may have changed while we were offline.
        void qc.invalidateQueries({ queryKey: ["ws", slug] });
      };
      socket.onmessage = (msg) => {
        let e: { entity: string; id: string | null };
        try {
          e = JSON.parse(String(msg.data));
        } catch {
          return;
        }
        if (e.entity === "ping") return;
        const scope = ["ws", slug];
        if (e.entity === "issue" || e.entity === "comment") {
          void qc.invalidateQueries({ queryKey: [...scope, "issues"] });
          if (e.id) void qc.invalidateQueries({ queryKey: [...scope, "issue", e.id] });
        } else {
          void qc.invalidateQueries({ queryKey: [...scope, e.entity] });
          if (e.entity === "project") void qc.invalidateQueries({ queryKey: [...scope, "projects"] });
        }
      };
      socket.onclose = (ev) => {
        if (closed || ev.code === 4401 || ev.code === 4403) return;
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, 500 * 2 ** retry);
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [slug, qc]);
}
