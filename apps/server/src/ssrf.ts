import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Blocks webhook URLs that point into the server's own network (SSRF).
 * Self-hosters who deliberately send webhooks to internal services can set
 * WEBHOOK_ALLOW_PRIVATE=1.
 */
export class UnsafeUrlError extends Error {}

/**
 * Address ranges a webhook must never reach. Node's BlockList matches
 * IPv4-mapped IPv6 addresses (in any spelling, such as ::ffff:7f00:1)
 * against the IPv4 rules, which a string check gets wrong.
 */
const BLOCKED = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::", 96], // IPv4-compatible (deprecated)
  ["2001::", 32], // Teredo tunnels embed an IPv4 address
  ["64:ff9b::", 96], // NAT64 to any IPv4, including private ones
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 embeds an IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link local
  ["fec0::", 10], // site local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  BLOCKED.addSubnet(net, bits, "ipv6");
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return BLOCKED.check(ip, "ipv4");
  if (family === 6) {
    const v6 = ip.toLowerCase();
    // ::ffff:a.b.c.d and ::ffff:xxxx:xxxx map to IPv4, and so does the
    // "IPv4-translated" ::ffff:0:xxxx:xxxx. (A BlockList rule for these
    // would also match every plain IPv4 address, so they are unwrapped here.)
    const hex = /^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
    if (hex) {
      const n = (parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16);
      return BLOCKED.check([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."), "ipv4");
    }
    const dotted = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (dotted) return BLOCKED.check(dotted[1]!, "ipv4");
    return BLOCKED.check(v6, "ipv6");
  }
  // Not an IP at all: refuse rather than guess.
  return true;
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
