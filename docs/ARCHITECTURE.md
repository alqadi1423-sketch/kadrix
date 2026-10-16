# Architecture

```
apps/web      React app (Vite). Talks only to /api.
apps/server   Hono API, auth, realtime, collaboration, workers. Serves the web build in production.
packages/core Permissions, Zod schemas, pure logic (planning math, Git key parsing). No I/O.
packages/db   Drizzle schema and SQL migrations.
packages/i18n Arabic and English messages; the type system keeps them in sync.
```

## Request path
1. `app.ts` resolves the caller: `Authorization: Bearer vlq_…` token, or the session cookie.
2. `workspaceGuard(action)` loads the membership for `:slug`, checks `can(role, action)`,
   and for guests loads the visible project ids.
3. Routes call services; queries take the membership as their scope.
4. Errors are `ApiError(status, code)`; the web app translates `code`.

## Writes and side effects
Issue changes go through `services/issues.ts`, which in one transaction:
updates the row, records state transitions and field activity, queues
webhooks (outbox), and creates notifications. Realtime notices are
published only after commit.

## Background work (inside the server process)
- Webhook deliveries: polled every few seconds, claimed with `SKIP LOCKED`.
- Email digest: every 15 minutes when `SMTP_URL` is set.

Both are safe to run on several instances.

## Live features
- `/api/workspaces/:slug/live`: change notices; the client refetches.
- `/api/workspaces/:slug/pages/:id/collab`: Yjs sync for a page (Hocuspocus).

## Configuration
| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (required) |
| `AUTH_SECRET` | 32+ chars; also derives the key for secrets at rest (required) |
| `BASE_URL` | Public address |
| `DATA_DIR` | Where uploads are stored (default `./data`) |
| `VELOQ_EDITION` | `self-hosted` (default) or `cloud` |
| `WEBHOOK_ALLOW_PRIVATE` | `1` to allow webhooks to internal addresses |
| `RATE_LIMIT_PER_MINUTE` | Per user or IP (default 600, `0` disables) |
| `SMTP_URL`, `MAIL_FROM` | Enable the email digest |
