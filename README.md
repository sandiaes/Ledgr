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

| Command          | Purpose                       |
| ---------------- | ----------------------------- |
| `pnpm lint`      | ESLint                        |
| `pnpm format`    | Prettier (write)              |
| `pnpm typecheck` | tsc in every workspace        |
| `pnpm test`      | Vitest                        |
| `pnpm check`     | all of the above, as CI would |
