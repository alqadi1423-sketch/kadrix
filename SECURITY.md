# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
**Report a vulnerability** button on the repository's Security tab. Do not
open public issues for security problems. Reports in Arabic or English are
welcome.

We aim to acknowledge reports within 3 days and to ship a fix for confirmed
high or critical issues within 14 days, crediting you if you wish.

## Supported versions

Until 1.0, only the latest release (and `main`) receive security fixes.

## What is in place

- Every query is scoped to the caller's workspace; guests are limited to the
  projects they are given; non-members get 404. Each change to these rules
  ships with tests, and browser tests run in CI.
- Passwords follow NIST SP 800-63B-4 (15 to 128 characters, common and
  account-derived passwords refused); optional breach check; two-step
  sign-in with an authenticator app and backup codes.
- Rate limits on the API and on credential endpoints; the real client
  address is only read from proxies you trust (`TRUST_PROXY`).
- Cookie requests from other origins are refused; WebSockets check Origin.
- API tokens are stored as SHA-256 hashes and bound to one workspace;
  webhook and integration secrets are encrypted with AES-256-GCM.
- Outgoing webhooks and imports cannot reach private networks (checked again
  when connecting, against DNS rebinding) and never follow redirects.
- Uploads are always downloaded, never rendered; Markdown is sanitised.
- The audit log is append-only, enforced by the database.

## Known limits

- Rate limit counters live in memory. Running several app instances needs a
  shared store first.
- An admin can add any person who already has an account on the same server
  to a workspace by email; there are no invitations to accept yet.
