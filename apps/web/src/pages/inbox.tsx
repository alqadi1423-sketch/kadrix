import { issueKey } from "@kadrix/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { Avatar } from "../components/icons";
import { keys } from "../lib/hooks";
import { Button, Empty } from "../ui";

export function InboxPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: keys.notifications(slug), queryFn: () => api.notifications(slug) });
  const read = useMutation({
    mutationFn: (ids?: string[]) => api.markRead(slug, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications(slug) }),
  });
  const fmt = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
  const ago = (iso: string) => {
    const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (Math.abs(mins) < 60) return fmt.format(mins, "minute");
    const hrs = Math.round(mins / 60);
    if (Math.abs(hrs) < 24) return fmt.format(hrs, "hour");
    return fmt.format(Math.round(hrs / 24), "day");
  };
  const items = list.data?.notifications ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("notifications.title")}</h1>
        {items.some((n) => !n.readAt) && (
          <Button variant="quiet" onClick={() => read.mutate(undefined)}>
            {t("notifications.markAllRead")}
          </Button>
        )}
      </div>
      {list.isSuccess && items.length === 0 && <Empty>{t("notifications.empty")}</Empty>}
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        {items.map((n) => {
          const key = n.projectKey && n.issueNumber ? issueKey(n.projectKey, n.issueNumber) : null;
          const text = t(`notifications.kinds.${n.kind}`, {
            actor: n.actorName ?? "?",
            issue: key ?? "",
            state: String(n.data.state ?? ""),
          });
          return (
            <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.readAt ? "" : "bg-petrol/5"}`}>
              <Avatar name={n.actorName} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{text}</p>
                {key && (
                  <Link
                    to="/w/$slug/i/$key"
                    params={{ slug, key }}
                    onClick={() => !n.readAt && read.mutate([n.id])}
                    className="block truncate text-sm"
                    dir="auto"
                  >
                    {n.issueTitle}
                  </Link>
                )}
              </div>
              <time className="shrink-0 text-xs text-muted" dateTime={n.createdAt}>
                {ago(n.createdAt)}
              </time>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
