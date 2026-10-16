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

/** What differs between editions. Code asks for a feature, never the edition. */
export interface EditionFeatures {
  /** Anyone can create an account on the sign-in page. */
  openSignUp: boolean;
  /** Plans and billing screens (cloud only, not built yet). */
  billing: boolean;
  /** The operator configures email, storage and AI themselves. */
  selfManagedServices: boolean;
}

export function editionFeatures(edition: Edition): EditionFeatures {
  return edition === "cloud"
    ? { openSignUp: true, billing: true, selfManagedServices: false }
    : { openSignUp: true, billing: false, selfManagedServices: true };
}
