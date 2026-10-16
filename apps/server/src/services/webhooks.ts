import type { WebhookEvent } from "@kadrix/core";
import { webhook, webhookDelivery, workspace, type Database } from "@kadrix/db";
import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../context.js";
import { hmacSha256, type Sealer } from "../crypto.js";
import { assertSafeUrl, createSafeFetch } from "../ssrf.js";
import { chatBody, chatText } from "./chat-format.js";

export const MAX_ATTEMPTS = 8;

/**
 * Queues an event for every active webhook of the workspace that listens to
 * it. Called inside the same transaction as the change, so events are never
 * lost or sent for changes that rolled back (transactional outbox).
 */
export async function enqueueWebhooks(db: Db, workspaceId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const hooks = await db
    .select({ id: webhook.id })
    .from(webhook)
    .where(and(eq(webhook.workspaceId, workspaceId), eq(webhook.active, true), sql`${event} = any(${webhook.events})`));
  if (hooks.length === 0) return;
  const payload = { event, createdAt: new Date().toISOString(), data };
  await db.insert(webhookDelivery).values(hooks.map((h) => ({ workspaceId, webhookId: h.id, event, payload })));
}

/** Exponential backoff: 30s, 2m, 8m, 32m, ~2h, ~8h, ~1d. */
export function backoffMs(attempt: number) {
  return Math.min(30_000 * 4 ** (attempt - 1), 24 * 3600_000);
}

export interface DeliveryOptions {
  sealer: Sealer;
  allowPrivate: boolean;
  fetchImpl?: typeof fetch;
  batch?: number;
  /** Used for links in chat messages. */
  baseUrl?: string;
}

/**
 * Sends due deliveries. Rows are claimed with FOR UPDATE SKIP LOCKED so
 * several server instances can run this loop without double-sending.
 * Signature header: X-Kadrix-Signature: sha256=<hex HMAC of the raw body>.
 */
export async function processDeliveries(db: Database, opts: DeliveryOptions): Promise<number> {
  const doFetch = opts.fetchImpl ?? createSafeFetch(opts.allowPrivate);
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: webhookDelivery.id,
        event: webhookDelivery.event,
        payload: webhookDelivery.payload,
        attempts: webhookDelivery.attempts,
        url: webhook.url,
        secret: webhook.secret,
        format: webhook.format,
        locale: webhook.locale,
        slug: workspace.slug,
      })
      .from(webhookDelivery)
      .innerJoin(webhook, eq(webhook.id, webhookDelivery.webhookId))
      .innerJoin(workspace, eq(workspace.id, webhookDelivery.workspaceId))
      .where(and(eq(webhookDelivery.status, "pending"), lte(webhookDelivery.nextAttemptAt, new Date())))
      .limit(opts.batch ?? 20)
      .for("update", { skipLocked: true, of: webhookDelivery });
    // Push the claimed rows a little into the future while we work on them.
    for (const r of rows) {
      await tx
        .update(webhookDelivery)
        .set({ nextAttemptAt: new Date(Date.now() + 60_000) })
        .where(eq(webhookDelivery.id, r.id));
    }
    return rows;
  });

  for (const d of claimed) {
    const attempts = d.attempts + 1;
    const body =
      d.format === "slack" || d.format === "discord"
        ? JSON.stringify(
            chatBody(d.format, chatText(d.payload as { event: string; data: Record<string, unknown> }, d.locale, opts.baseUrl ?? "", d.slug)),
          )
        : JSON.stringify({ id: d.id, ...d.payload });
    let status: number | null = null;
    let error: string | null = null;
    try {
      await assertSafeUrl(d.url, opts.allowPrivate);
      const secret = opts.sealer.open(d.secret);
      const res = await doFetch(d.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          "user-agent": "Kadrix-Webhooks/1",
          "x-kadrix-event": d.event,
          "x-kadrix-delivery": d.id,
          "x-kadrix-signature": `sha256=${hmacSha256(secret, body)}`,
        },
        body,
      });
      status = res.status;
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 300) : "error";
    }
    const ok = !error;
    await db
      .update(webhookDelivery)
      .set({
        attempts,
        lastStatusCode: status,
        lastError: error,
        status: ok ? "success" : attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        deliveredAt: ok ? new Date() : null,
        nextAttemptAt: new Date(Date.now() + (ok ? 0 : backoffMs(attempts))),
      })
      .where(eq(webhookDelivery.id, d.id));
  }
  return claimed.length;
}

export function startDeliveryWorker(db: Database, opts: DeliveryOptions, everyMs = 3000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      while ((await processDeliveries(db, opts)) > 0) {
        // keep draining while there is work
      }
    } catch (e) {
      console.error("webhook worker", e);
    } finally {
      running = false;
    }
  }, everyMs);
  return () => clearInterval(timer);
}
