# Ledgr – project rules

## Scope

- Single user, personal use. Reporting currency: EUR.
- Assets: stocks, ETFs, crypto, Portuguese certificados de aforro.

## Data model

- The transaction ledger is the source of truth. Holdings, cost basis (FIFO), gains,
  XIRR, TWR, allocation and snapshots are always derived, never hand-entered.

## Money maths

- Never use JS floats for money or quantities. Use a decimal library (decimal.js) in
  code and `numeric(38,18)`-style types in Postgres.
- All financial logic lives in `packages/core` and has unit tests.
- `packages/core` is pure TypeScript: no UI, no network.

## Security

- Row Level Security on every table.
- The Supabase service-role key and any third-party API keys never appear in apps or
  in git. Only the anon key is used in clients.
- Never log financial data (`no-console` is enforced by ESLint).
- Use `.env` files; they are git-ignored (`.env.example` is the only committed one).

## Workflow

- Work in small steps. For each step: state a short plan, wait for approval if the
  user says so, then implement, run tests and linting (`pnpm check`), and summarize
  what changed.
- Do not add features that haven't been asked for.

## Layout

- `apps/mobile` – React Native + Expo (Android)
- `apps/desktop` – React + Vite (Tauri-wrappable later)
- `packages/core` – calculation library
- `supabase/` – migrations and edge functions
