import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Blocks webhook URLs that point into the server's own network (SSRF).
 * Self-hosters who deliberately send webhooks to internal services can set
 * WEBHOOK_ALLOW_PRIVATE=1.
 */
export class UnsafeUrlError extends Error {}

function v4ToInt(ip: string) {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
  }
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff")
  );
}

/** Validates scheme and resolves the host; every resolved address must be public. */
export async function assertSafeUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("invalid url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("scheme");
  if (url.username || url.password) throw new UnsafeUrlError("credentials in url");
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new UnsafeUrlError("private host");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (addrs.length === 0) throw new UnsafeUrlError("unresolvable");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError("private address");
  return url;
}


/**
 * A fetch that re-checks the address at connection time, so a hostname that
 * resolves to a public address during validation cannot switch to a private
 * one when the request is made (DNS rebinding).
 */
export function createSafeFetch(allowPrivate: boolean): typeof fetch {
  if (allowPrivate) return fetch;
  const agent = new Agent({
    connect: {
      lookup(hostname, options, cb) {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return cb(err, "", 4);
          const list = (Array.isArray(addresses) ? addresses : [{ address: addresses as unknown as string, family: 4 }]) as {
            address: string;
            family: number;
          }[];
          const bad = list.find((a) => isPrivateAddress(a.address));
          if (bad) return cb(new UnsafeUrlError("private address"), "", 4);
          const first = list[0]!;
          // Node passes all:true from the caller; answer in the shape it asked for.
          if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
          cb(null, first.address, first.family);
        });
      },
    },
  });
  return ((input: string | URL | Request, init?: RequestInit) =>
    undiciFetch(input as string, { ...(init as object), dispatcher: agent } as never)) as unknown as typeof fetch;
}
