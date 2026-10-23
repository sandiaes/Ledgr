# Ledgr

Personal investment tracker (single user, EUR). See [CLAUDE.md](./CLAUDE.md) for project rules.
Calculation assumptions and their verification status: [docs/assumptions.md](./docs/assumptions.md).

## Structure

- `apps/mobile` – React Native + Expo (SDK 58), Android ([docs/mobile-run.md](./docs/mobile-run.md))
- `apps/desktop` – React + Vite
- `packages/core` – pure TypeScript calculation library (decimal.js)
- `packages/client` – what both apps share: key check, MFA helpers, row mappers, pagination
- `packages/market` – price/FX providers, daily jobs and the Edge Function handler
- `supabase/` – migrations, edge functions, cron SQL
- `scripts/import` – one-off spreadsheet importer, local only ([docs/import.md](./docs/import.md))
- `scripts/prices` – symbol resolution, backfill and sanity report, local only
  ([docs/prices.md](./docs/prices.md))

## Setup

```sh
pnpm install
cp .env.example .env   # fill in URL + anon key only
```

## Scripts

| Command                | Purpose                       |
| ---------------------- | ----------------------------- |
| `pnpm lint`            | ESLint                        |
| `pnpm format`          | Prettier (write)              |
| `pnpm typecheck`       | tsc in every workspace        |
| `pnpm test`            | Vitest                        |
| `pnpm test:mobile`     | Jest (jest-expo), apps/mobile |
| `pnpm check`           | all of the above, as CI would |
| `pnpm test:coverage`   | Vitest + v8 coverage (core)   |
| `pnpm importer`        | spreadsheet import (see docs) |
| `pnpm prices`          | symbols, backfill, sanity     |
| `pnpm functions:build` | bundle the Edge Functions     |

## Desktop: sign in and TOTP enrollment

```sh
cp apps/desktop/.env.example apps/desktop/.env.local   # URL + anon key only
pnpm --filter @ledgr/desktop dev                         # http://localhost:5173
```

Sign in with email + password, enroll an authenticator app, verify a code. Sign out
and back in to confirm you are asked for a code and reach `aal2`.

## Mobile (Android)

```sh
cp apps/mobile/.env.example apps/mobile/.env   # URL + anon key only
cd apps/mobile && npx expo start                # scan the QR code with Expo Go
```

Company Wi-Fi, USB, and building an installable APK with EAS: [docs/mobile-run.md](./docs/mobile-run.md).
