# Contributing to Kadrix

Thank you for helping. Contributions in Arabic or English are both welcome.

## Before your first pull request

You must agree to the [Contributor License Agreement](CLA.md). A bot will ask
you to sign it on your first pull request; you only sign once.

## Workflow

1. Open an issue first for anything larger than a small fix.
2. Fork, create a branch, make your change with tests.
3. Run `pnpm check` and `pnpm build`.
4. Open a pull request describing what changed and why.

## Rules that reviews enforce

The rules in [AGENTS.md](AGENTS.md) apply to humans too: tenancy filters,
central permission checks, both languages for every string, logical (RTL-safe)
layout, and migrations for every schema change.

## Translations

Every message lives in `packages/i18n/src`. Improving Arabic or English
wording is a great first contribution.
