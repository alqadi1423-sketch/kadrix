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
| 5 | Reports, automation, import | ⏳ |
| 6 | Future paths: agents, AI, mobile, cloud | ⏳ |
| 7 | Launch readiness | ⏳ |

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

## 5. Reports, automation, import ⏳
Dashboards (velocity, cycle and lead time, cumulative flow, workload),
time tracking, custom fields, issue templates, automation rules,
recurring issues, importers (Jira, Linear, GitHub Issues, CSV), Arabic
search quality check.

## 6. Future paths ⏳
Built in, not launched: agent user type and MCP server for AI coding
agents, AI provider interface with no provider switched on, shared
packages ready for a mobile app, installable PWA, edition flags for the
cloud.

## 7. Launch readiness ⏳
Security review, two-step sign-in (TOTP), upgrade path and versioned releases, images on GHCR,
bilingual docs including installing without Docker, README as a landing
page with screenshots, CLA check on pull requests, trademark policy.
