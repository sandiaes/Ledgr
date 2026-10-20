# Ledgr

Personal investment tracker (single user, EUR). See [CLAUDE.md](./CLAUDE.md) for project rules.

## Structure

- `apps/mobile` – React Native + Expo, Android
- `apps/desktop` – React + Vite
- `packages/core` – pure TypeScript calculation library (decimal.js)
- `supabase/` – migrations and edge functions

## Setup

```sh
pnpm install
cp .env.example .env   # fill in URL + anon key only
```

## Scripts

| Command              | Purpose                       |
| -------------------- | ----------------------------- |
| `pnpm lint`          | ESLint                        |
| `pnpm format`        | Prettier (write)              |
| `pnpm typecheck`     | tsc in every workspace        |
| `pnpm test`          | Vitest                        |
| `pnpm test:coverage` | Vitest + v8 coverage (core)   |
| `pnpm check`         | all of the above, as CI would |

## Desktop: sign in and TOTP enrollment

```sh
cp apps/desktop/.env.example apps/desktop/.env.local   # URL + anon key only
pnpm --filter @ledgr/desktop dev                         # http://localhost:5173
```

Sign in with email + password, enroll an authenticator app, verify a code. Sign out
and back in to confirm you are asked for a code and reach `aal2`.
