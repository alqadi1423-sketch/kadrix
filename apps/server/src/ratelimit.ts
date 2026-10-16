import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { ApiError } from "./errors.js";

/**
 * Fixed-window limiter kept in memory: fine for one self-hosted instance.
 * The cloud edition can swap in a shared store behind the same middleware.
 * Keyed by user id when signed in, otherwise by client IP.
 */
export function rateLimit(
  perMinute: number,
  keyOf: (c: Parameters<MiddlewareHandler>[0]) => string | null,
  windowMs = 60_000,
): MiddlewareHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  let sweep = Date.now();
  return async (c, next) => {
    if (perMinute <= 0) return next();
    const now = Date.now();
    if (now - sweep > windowMs) {
      for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      sweep = now;
    }
    const key = keyOf(c) ?? "anon";
    const cur = hits.get(key);
    const entry = cur && cur.reset > now ? cur : { n: 0, reset: now + windowMs };
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

/**
 * The caller's address. Behind a reverse proxy the socket address is the
 * proxy's, so with `trustProxy` hops we read X-Forwarded-For from the right:
 * each trusted proxy appends the address it saw, and anything further left
 * was written by the client and cannot be trusted.
 */
export function clientIp(c: Parameters<MiddlewareHandler>[0], trustProxy = 0): string | null {
  if (trustProxy > 0) {
    const chain = (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (chain.length >= trustProxy) return chain[chain.length - trustProxy]!;
  }
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}
