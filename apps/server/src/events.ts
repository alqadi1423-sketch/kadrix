import postgres from "postgres";

/**
 * Realtime change events. Published through PostgreSQL NOTIFY so that several
 * server instances (the future cloud edition) all see every change, with no
 * extra infrastructure for self-hosters.
 *
 * Events only say *what* changed; clients refetch through the normal API,
 * which re-applies permission checks. No data leaks through this channel.
 */
export interface ChangeEvent {
  workspaceId: string;
  /** e.g. "issue", "comment", "project", "notification" */
  entity: string;
  id?: string;
  /** Limit delivery to one user (notifications). */
  userId?: string;
}

type Listener = (e: ChangeEvent) => void;

export interface EventBus {
  publish(e: ChangeEvent): Promise<void>;
  subscribe(fn: Listener): () => void;
  close(): Promise<void>;
}

const CHANNEL = "veloq_events";

export function createPgEventBus(url: string): EventBus {
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  const listeners = new Set<Listener>();
  const ready = sql.listen(CHANNEL, (payload) => {
    let e: ChangeEvent;
    try {
      e = JSON.parse(payload) as ChangeEvent;
    } catch {
      return;
    }
    for (const fn of listeners) fn(e);
  });
  return {
    async publish(e) {
      await ready;
      await sql.notify(CHANNEL, JSON.stringify(e));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async close() {
      await sql.end();
    },
  };
}

/** In-process bus for tests. */
export function createMemoryEventBus(): EventBus & { events: ChangeEvent[] } {
  const listeners = new Set<Listener>();
  const events: ChangeEvent[] = [];
  return {
    events,
    async publish(e) {
      events.push(e);
      for (const fn of listeners) fn(e);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async close() {},
  };
}
