# Instructions for coding agents

Read this before changing code. These rules exist because agents skip
production concerns unless they are written down and tested.

## Non-negotiables

1. **Tenancy.** Every table holding workspace data has a `workspace_id`
   column, and every query on it filters by the caller's workspace.
2. **Authorization.** All permission decisions go through `can()` /
   `canManageRole()` in `packages/core/src/permissions.ts`. Never compare
   roles inline. New actions must be added to the matrix test.
3. **Non-members get 404**, not 403, for anything inside a workspace.
4. **Audit.** Membership and permission changes write to `audit_log` inside
   the same transaction. The table is append-only (database trigger).
5. **Two languages.** No user-facing text in components or API responses.
   Add keys to both `packages/i18n/src/en.ts` and `ar.ts`; the parity test
   fails otherwise. The API returns error codes, the web app translates them.
6. **RTL.** Only logical layout: `ms-/me-/ps-/pe-/start-/end-/text-start/border-s`.
   `pnpm lint` rejects `ml-/mr-/pl-/pr-/left-/right-/text-left` and CSS
   `left`/`right`. Mark rare intended exceptions with `rtl-allow`.
7. **Migrations.** Schema changes go through `pnpm db:generate`; never edit
   applied migrations, never create tables at runtime. Hand-written SQL goes
   in a `drizzle-kit generate --custom` migration.
8. **Edition.** Cloud-only behaviour is gated by the edition flag in
   `packages/core/src/edition.ts`. Self-hosted must work with only the app
   container and PostgreSQL.
9. **Dates.** Gregorian calendar. Store timestamps with time zone; format
   with `Intl` in the viewer's locale.

## Before you finish

```bash
pnpm check   # RTL check, typecheck, tests (needs TEST_DATABASE_URL)
pnpm build
```

Add tests for every new endpoint, including the permission cases.
