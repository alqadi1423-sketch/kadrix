import { issueKey } from "@veloq/core";
import { messages } from "@veloq/i18n";
import { issue, notification, project, user, userPreference, workspace, type Database } from "@veloq/db";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export type SendMail = (m: Mail) => Promise<void>;

const DAY = 24 * 3600_000;

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function interpolate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? "");
}

/**
 * Sends at most one email a day per person, listing unread notifications,
 * in the language they use in the app. People can turn it off in their
 * preferences. Returns how many emails were sent.
 */
export async function sendDigests(db: Database, send: SendMail, baseUrl: string, now = new Date()): Promise<number> {
  const candidates = await db
    .selectDistinct({ userId: notification.userId, email: user.email, name: user.name })
    .from(notification)
    .innerJoin(user, eq(user.id, notification.userId))
    .leftJoin(userPreference, eq(userPreference.userId, notification.userId))
    .where(
      and(
        isNull(notification.readAt),
        // Give people a chance to see it in the app first.
        lt(notification.createdAt, new Date(now.getTime() - 3600_000)),
        or(isNull(userPreference.userId), eq(userPreference.emailDigest, true)),
        or(isNull(userPreference.lastDigestAt), lt(userPreference.lastDigestAt, new Date(now.getTime() - DAY))),
      ),
    )
    .limit(500);

  let sent = 0;
  for (const c of candidates) {
    const [pref] = await db.select().from(userPreference).where(eq(userPreference.userId, c.userId));
    const locale = pref?.locale === "ar" ? "ar" : "en";
    const t = messages[locale];
    const items = await db
      .select({
        kind: notification.kind,
        data: notification.data,
        actorName: sql<string | null>`(select name from "user" a where a.id = ${notification.actorId})`,
        title: issue.title,
        number: issue.number,
        projectKey: project.key,
        slug: workspace.slug,
        workspaceName: workspace.name,
      })
      .from(notification)
      .innerJoin(workspace, eq(workspace.id, notification.workspaceId))
      .leftJoin(issue, eq(issue.id, notification.issueId))
      .leftJoin(project, eq(project.id, issue.projectId))
      .where(and(eq(notification.userId, c.userId), isNull(notification.readAt)))
      .orderBy(desc(notification.createdAt))
      .limit(30);
    if (items.length === 0) continue;

    const lines = items.map((n) => {
      const key = n.projectKey && n.number ? issueKey(n.projectKey, n.number) : "";
      const tpl = (t.notifications.kinds as Record<string, string>)[n.kind] ?? n.kind;
      const line = interpolate(tpl, { actor: n.actorName ?? "?", issue: key, state: String((n.data as { state?: string }).state ?? "") });
      const url = key ? `${baseUrl}/w/${n.slug}/i/${key}` : `${baseUrl}/w/${n.slug}/inbox`;
      return { line, title: n.title ?? "", url, workspace: n.workspaceName };
    });
    const subject = interpolate(t.email.digestSubject, { count: String(items.length) });
    const dir = locale === "ar" ? "rtl" : "ltr";
    const text = [interpolate(t.email.greeting, { name: c.name }), "", ...lines.map((l) => `- ${l.line}: ${l.title}\n  ${l.url}`), "", t.email.footer].join("\n");
    const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#0c2a30">
<p>${escape(interpolate(t.email.greeting, { name: c.name }))}</p>
<ul>${lines.map((l) => `<li><a href="${escape(l.url)}">${escape(l.line)}</a><br><span dir="auto">${escape(l.title)}</span></li>`).join("")}</ul>
<p style="color:#5b7176;font-size:13px">${escape(t.email.footer)}</p></body></html>`;
    await send({ to: c.email, subject, text, html });
    await db
      .insert(userPreference)
      .values({ userId: c.userId, lastDigestAt: now, locale })
      .onConflictDoUpdate({ target: userPreference.userId, set: { lastDigestAt: now } });
    sent++;
  }
  return sent;
}

/** SMTP mailer from SMTP_URL (smtp://user:pass@host:587). Without it, email is off. */
export async function createMailer(smtpUrl: string | null, from: string): Promise<SendMail | null> {
  if (!smtpUrl) return null;
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(smtpUrl);
  return async (m) => {
    await transport.sendMail({ from, ...m });
  };
}

export function startDigestWorker(db: Database, send: SendMail, baseUrl: string, everyMs = 15 * 60_000) {
  const timer = setInterval(() => {
    sendDigests(db, send, baseUrl).catch((e) => console.error("digest", e));
  }, everyMs);
  return () => clearInterval(timer);
}
