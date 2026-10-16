# Roadmap

Veloq is built in internal phases. Nothing is announced publicly until all
phases are done (decision 6 in [DECISIONS.md](DECISIONS.md)).

Status: ✅ done · 🔨 in progress · ⏳ not started

| Phase | Goal | Status |
|---|---|---|
| 0 | Foundation that never gets rewritten | ✅ |
| 1 | Work model | ✅ |
| 2 | Methodology tracks | ✅ |
| 3 | Developer integration | ✅ |
| 4 | Docs and collaboration | ✅ |
| 4.5 | External review fixes | ✅ |
| 5 | Reports, automation, import | ✅ |
| 6 | Future paths: agents, AI, mobile, cloud | ✅ |
| 7 | Launch readiness | 🔨 |

## 0. Foundation ✅
Monorepo (pnpm, Turborepo), TypeScript, AGPLv3 and CLA, PostgreSQL with
migrations, workspaces with a tenant id on every row, central permission
matrix, append-only audit log, Arabic and English with a parity test,
RTL layout check, one-container Docker image, CI.

## 1. Work model ✅
Projects, workflow states in fixed categories, issues with per-project
keys, types, priorities, assignees, labels, parents, relations, estimates
and dates. State transitions stored for reporting. Activity history,
comments with mentions, attachments, subscriptions, inbox. Full-text
search in both languages. Saved views, bulk edit, list and board views,
live updates, command menu and keyboard shortcuts.

## 2. Methodology tracks ✅
Cycles with rollover and velocity, burndown, milestones, initiatives with
health updates, timeline with dependencies and critical path, calendar,
configurable working week.

## 3. Developer integration ✅
API tokens, OpenAPI document, signed webhooks with retries and SSRF
protection, GitHub and GitLab linking that moves issues through the
pull request lifecycle, releases and changelogs, rate limiting.

## 4. Docs and collaboration ✅
Pages per project or workspace in a tree, live co-editing (Yjs and
Tiptap) with presence cursors and per-paragraph Arabic or English
direction, search, issue keys in a page linking both ways. Guests limited
to the projects they are given, with a picker in settings. Slack and
Discord messages, daily email digest in each person's language,
preferences screen.

## 4.5 External review fixes ✅
Passwords per NIST SP 800-63B-4, credential rate limit, real client
address behind a trusted proxy, atomic bulk edits, browser tests (RTL,
live board, co-editing) in CI.

## 5. Reports, automation, import ✅
Reports page (lead and cycle time percentiles, weekly throughput,
cumulative flow, open work and logged time per person). Time tracking
that reads "1h 30m" or "١س ٣٠د". Custom fields in eight kinds. Issue
templates and recurring issues. Automation rules (six triggers,
conditions, seven actions, bounded chains). Importers for Jira and
Linear CSV, any CSV with column mapping, and GitHub Issues, safe to run
again. Arabic search folds letter variants and diacritics and matches
words with the attached article.

## 6. Future paths ✅
Built in, nothing launched. Agent members and an MCP server so AI coding
tools (Claude Code, Cursor and others) can work in Veloq under their own
name and permissions. AI provider interface (OpenAI-compatible or
Anthropic) that stays off until an operator sets it, with issue summaries
and "write it up for me" drafts hidden while off. `@veloq/client`, a typed
client for a future mobile app. Installable PWA with an offline shell.
Edition features (self-hosted or cloud) exposed by the health endpoint.

## 7. Launch readiness ⏳
Security review, two-step sign-in (TOTP), upgrade path and versioned releases, images on GHCR,
bilingual docs including installing without Docker, README as a landing
page with screenshots, CLA check on pull requests, trademark policy.
