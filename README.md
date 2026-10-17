<p align="center">
  <img src="apps/web/public/icon.svg" width="72" height="72" alt="">
</p>

<h1 align="center">Kadrix</h1>

<p align="center">
  Open-source project management for software teams.<br>
  Arabic and English as equals. Runs on your own server.
</p>

<p align="center">
  <a href="README.ar.md">العربية</a> ·
  <a href="docs/en/install.md">Install</a> ·
  <a href="docs/en/configuration.md">Configure</a> ·
  <a href="docs/en/agents.md">AI agents</a> ·
  <a href="docs/en/api.md">API</a>
</p>

<p align="center">
  <img src="docs/screenshots/board-ar.png" alt="A project board in Arabic, right to left">
</p>

> **Status:** first public version (0.1.0). Everything below works and is
> tested; expect changes until 1.0.

## Why Kadrix

**Two languages, one product.** Every screen works right to left in Arabic and
left to right in English, with neither treated as a translation. Mixed
Arabic and English text keeps its own direction, Arabic search ignores
spelling variants (إدارة finds ادارة, مشروع finds المشروع), time can be
typed as `١س ٣٠د`, and the working week follows your region.

**Yours to host.** One app container and PostgreSQL. No search cluster, no
queue, no separate realtime service. Small teams run it on a 1 GB server.

**Built for software work.** Issues with keys like `WEB-12`, boards, cycles
with burndown, milestones, roadmaps with dependencies, releases with
changelogs, and GitHub or GitLab linking that moves issues as pull requests
open and merge.

**Open to AI agents, closed to surprises.** A built-in MCP server lets Claude
Code, Cursor and others work on issues under their own name and permissions.
AI features are off until you choose a provider, including a local model.

## Features

| | |
|---|---|
| **Work** | Issues, sub-issues, relations, labels, priorities, estimates, custom fields, templates, recurring issues, bulk edit, saved views, list and board with WIP limits |
| **Planning** | Cycles with rollover and velocity, burndown, milestones, initiatives with health updates, timeline with critical path, calendar |
| **Docs** | Pages per project with live co-editing, presence, per-paragraph direction, and issue keys that link both ways |
| **Developers** | GitHub and GitLab linking with Arabic and English closing words, API tokens, OpenAPI, signed webhooks (JSON, Slack, Discord), releases |
| **Insight** | Lead and cycle time, throughput, cumulative flow, workload, time tracking |
| **Automation** | Rules on six triggers with conditions and seven actions, safely bounded |
| **Moving in** | Import from Jira, Linear, GitHub Issues or any CSV, safe to run again |
| **People** | Owners, admins, members, guests limited to chosen projects, AI agents, inbox, mentions, daily email digest |
| **Security** | Two-step sign-in, NIST-style password rules, rate limits, append-only audit log, SSRF-safe webhooks, encrypted secrets |
| **Anywhere** | Installable app with offline shell, works on phones, keyboard shortcuts and command menu |

<p align="center">
  <img src="docs/screenshots/reports-en.png" width="49%" alt="Reports">
  <img src="docs/screenshots/docs-ar.png" width="49%" alt="A shared document in Arabic">
</p>
<p align="center">
  <img src="docs/screenshots/list-en.png" width="49%" alt="Issue list in English">
  <img src="docs/screenshots/issue-ar.png" width="49%" alt="An issue in Arabic">
</p>

## Quick start

```bash
git clone https://github.com/alqadi1423-sketch/kadrix.git
cd kadrix
cp .env.example .env    # set AUTH_SECRET and POSTGRES_PASSWORD
docker compose up -d
```

Open http://localhost:3000 and create an account. For a real server, HTTPS,
or installing without Docker, see the [install guide](docs/en/install.md).

## Develop

Requirements: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
export DATABASE_URL=postgres://kadrix:kadrix@localhost:5432/kadrix
export AUTH_SECRET=$(openssl rand -base64 48)
pnpm --filter @kadrix/server dev     # API on :3000, runs migrations
pnpm --filter @kadrix/web dev        # web app on :5173
```

Checks, the same ones CI runs:

```bash
export TEST_DATABASE_URL=postgres://kadrix:kadrix@localhost:5432/kadrix_test
pnpm check                          # RTL layout check, types, tests
export E2E_DATABASE_URL=postgres://kadrix:kadrix@localhost:5432/kadrix_e2e
pnpm build && pnpm e2e              # browser tests on an empty database
```

| Path | What it is |
|---|---|
| `apps/server` | HTTP API (Hono), auth (Better Auth), realtime, MCP server, workers |
| `apps/web` | Web app (React, TanStack, Tailwind, Tiptap) |
| `apps/e2e` | Browser tests (Playwright) |
| `packages/core` | Permissions, validation, planning and report math |
| `packages/db` | Schema and migrations (Drizzle, PostgreSQL) |
| `packages/i18n` | Arabic and English messages, kept equal by a test |
| `packages/client` | Typed API client for scripts and a future mobile app |

How it fits together: [ARCHITECTURE.md](docs/ARCHITECTURE.md). Rules every
change follows, for people and coding agents: [AGENTS.md](AGENTS.md).

## Contributing

Contributions in Arabic or English are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
You will be asked once to agree to the [CLA](CLA.md).
Security issues: please follow [SECURITY.md](SECURITY.md).

## License

[GNU AGPL v3.0 or later](LICENSE). You can use, change and host Kadrix freely;
if you offer a changed version to others over a network, share your changes
under the same license. The name and logo are covered by the
[trademark policy](TRADEMARKS.md).
