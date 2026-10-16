import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { ApiError } from "./errors.js";

/**
 * Fixed-window limiter kept in memory: fine for one self-hosted instance.
 * The cloud edition can swap in a shared store behind the same middleware.
 * Keyed by user id when signed in, otherwise by client IP.
 */
export function rateLimit(perMinute: number, keyOf: (c: Parameters<MiddlewareHandler>[0]) => string | null): MiddlewareHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  let sweep = Date.now();
  return async (c, next) => {
    if (perMinute <= 0) return next();
    const now = Date.now();
    if (now - sweep > 60_000) {
      for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      sweep = now;
    }
    const key = keyOf(c) ?? "anon";
    const cur = hits.get(key);
    const entry = cur && cur.reset > now ? cur : { n: 0, reset: now + 60_000 };
    entry.n++;
    hits.set(key, entry);
    c.header("x-ratelimit-limit", String(perMinute));
    c.header("x-ratelimit-remaining", String(Math.max(perMinute - entry.n, 0)));
    if (entry.n > perMinute) {
      c.header("retry-after", String(Math.ceil((entry.reset - now) / 1000)));
      throw new ApiError(429, "rateLimited");
    }
    await next();
  };
}

export function clientIp(c: Parameters<MiddlewareHandler>[0]): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}
