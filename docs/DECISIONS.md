# Decisions

Product decisions are made by the project owner. Technical choices follow
from them and from the research in [research.md](research.md) (summary).
To change a decision, edit this file in the same pull request as the code.

## Product decisions

| # | Decision |
|---|---|
| 1 | Name: **Kadrix**. The first name, Veloq, was dropped before release: it is already a software brand (Rohlik Group, veloq.com) and Velqo is a delivery platform in the same field. |
| 2 | License: **GNU AGPL v3 or later** |
| 3 | Contributions under a **CLA**, keeping the option of a paid edition |
| 4 | **Arabic and English as equals** from day one, full RTL. **Gregorian** calendar only |
| 5 | **TypeScript** for frontend and backend, **PostgreSQL** database |
| 6 | Full version built in internal phases **before the first public release** |
| 7 | **Self-hostable**, with a cloud edition the owner may run later. Cloud readiness is in the code; no service is offered now |
| 8 | Repository on the owner's GitHub account (`alqadi1423-sketch/kadrix`), public from day one |
| 9 | AI features and mobile app: **paths built in, nothing launched** |

## Technical choices

| Area | Choice | Why |
|---|---|---|
| Repo | pnpm workspaces + Turborepo | One language, shared types across packages |
| API | Hono on Node 22 | Small, typed, standard Request/Response |
| Validation | Zod 4 | Same schemas validate requests and generate OpenAPI |
| Database | PostgreSQL 16 + Drizzle ORM | One required service; migrations in SQL |
| Auth | Better Auth (email and password) | Maintained successor to Lucia/Auth.js |
| Realtime | WebSocket + PostgreSQL NOTIFY | Works across instances, no Redis |
| Jobs | PostgreSQL tables with `SKIP LOCKED` | No queue service to run |
| Search | PostgreSQL full text (`simple` config) + trigram | Works for Arabic and English, no search cluster |
| Docs | Tiptap + Yjs via Hocuspocus | CRDT co-editing on the same server |
| Web | React, Vite, TanStack Router and Query, Tailwind 4 | Typed routes, cache with optimistic updates |
| Font | Readex Pro (one family for Arabic and Latin) | One voice in both languages, self-hosted |

## Security rules that shape the code
- Every tenant row has `workspace_id`; non-members get 404.
- Guests see only projects listed in `project_access`.
- Secrets for webhooks and integrations are encrypted at rest.
- Outgoing HTTP checks addresses at connect time (SSRF and DNS rebinding).
- Uploaded files are always downloaded, never rendered on our origin.
