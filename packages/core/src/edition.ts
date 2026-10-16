/**
 * Edition flag. The same code serves self-hosted installs and the (future)
 * managed cloud. Cloud-only behaviour must be gated on `isCloud()`, never on
 * ad-hoc environment checks.
 */
export const EDITIONS = ["self-hosted", "cloud"] as const;
export type Edition = (typeof EDITIONS)[number];

export function parseEdition(value: string | undefined): Edition {
  return value === "cloud" ? "cloud" : "self-hosted";
}
