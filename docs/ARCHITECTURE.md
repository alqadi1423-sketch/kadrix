# Architecture

```
apps/web      React app (Vite). Talks only to /api.
apps/server   Hono API, auth, realtime, collaboration, workers. Serves the web build in production.
packages/core Permissions, Zod schemas, pure logic (planning math, Git key parsing). No I/O.
packages/db   Drizzle schema and SQL migrations.
packages/i18n Arabic and English messages; the type system keeps them in sync.
```

## Request path
1. `app.ts` resolves the caller: `Authorization: Bearer kdx_…` token, or the session cookie.
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
| `KADRIX_EDITION` | `self-hosted` (default) or `cloud` |
| `WEBHOOK_ALLOW_PRIVATE` | `1` to allow webhooks to internal addresses |
| `RATE_LIMIT_PER_MINUTE` | Per user or IP (default 600, `0` disables) |
| `AUTH_ATTEMPTS_PER_5_MIN` | Sign-in, sign-up and password reset attempts per IP (default 20). `0` turns off auth rate limiting entirely |
| `AI_PROVIDER` | Off unless set: `openai-compatible` (any server with the OpenAI chat API, including local models) or `anthropic` |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Where and which model. `AI_BASE_URL` is required for `openai-compatible` (for example `http://localhost:11434/v1`) |
| `TRUST_PROXY` | Number of reverse proxies in front of Kadrix (default 0). Set to 1 behind one Nginx/Caddy/Cloudflare hop so the real client address is used; never set it higher than the real number, or clients can forge their address |
| `SMTP_URL`, `MAIL_FROM` | Enable the email digest |

## Security notes

- Passwords follow NIST SP 800-63B-4 for single-factor accounts: 15 to 128 characters, any language, no composition rules, and common or account-derived passwords are refused (`apps/server/src/password.ts`).
- Rate limits are kept in memory, which suits one instance. Running several instances needs a shared store first (planned with the cloud edition).
- Bulk issue edits run in one transaction and lock rows in id order.

## Agents and MCP

- Agents are workspace members of kind `agent`. They have no password and act only through their API token, so every rule that applies to tokens applies to them. Removing an agent revokes its tokens and membership but keeps the user row, so history still shows its name.
- `POST /api/mcp` is a Model Context Protocol server (Streamable HTTP, stateless JSON responses). Every tool calls the public REST API with the caller's token, so an agent can never do more than the same token could through the API. Read-only tokens only see read tools. Requests with a foreign `Origin` are refused.

## Mobile and other clients

- `packages/client` is a typed API client that needs only `fetch`, for the future mobile app, scripts and integrations.
- The web app is installable (manifest and service worker). The service worker caches the app shell only, never API responses.
