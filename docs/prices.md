# Prices, FX and daily snapshots (runbook)

How Ledgr gets market prices and exchange rates, values your portfolio every day, and what
to do when something breaks. All commands are for **Git Bash** on Windows, run from the
repository folder. Nothing here needs admin rights or Docker.

## What runs where

| Piece                          | Where                            | What it does                                                                      |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm prices resolve`          | your computer (`scripts/prices`) | finds each asset's provider symbol and fills `assets.price_source(_id)`           |
| `pnpm prices backfill`         | your computer                    | ECB rates, prices and daily snapshots from your first trade, then a sanity report |
| `fx-daily` Edge Function       | Supabase, 05:15 UTC daily        | ECB rates up to today (re-reads the last 7 days)                                  |
| `prices-daily` Edge Function   | Supabase, 05:25 UTC daily        | closes up to yesterday for what you hold (re-reads the last 5 days)               |
| `snapshot-daily` Edge Function | Supabase, 05:40 UTC daily        | snapshots from the 1st of last month to yesterday                                 |
| `value-now` Edge Function      | Supabase, when the app asks      | the portfolio valued with intraday quotes (see "Value now" below)                 |

| Data                       | Provider                                     | Key      | Free limits                                                                           |
| -------------------------- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| US stocks (XNAS/XNYS/XASE) | Tiingo (official API)                        | yes      | 50 requests/hour, 1,000/day                                                           |
| Xetra ETFs (XETR)          | Alpha Vantage (official API), `<TICKER>.DEX` | yes      | 25 requests/day, 5/minute; only the latest 100 trading days (full history is premium) |
| BTC in EUR                 | Coinbase Exchange public candles (official)  | no       | generous; 300 days per request                                                        |
| EUR reference rates        | ECB data API (official)                      | no       | none in practice                                                                      |
| ISIN → ticker              | OpenFIGI (official, Bloomberg)               | optional | 25 requests/minute without a key                                                      |

Certificados de aforro are never fetched: they are valued from `ca_factors` (see
`docs/assumptions.md` #14 and #25).

**Why the backfill is a local script:** an Edge Function may use 2 seconds of CPU per call
(150 s wall clock on the free plan). Valuing about 2,100 days with exact decimals and FIFO
takes a few seconds of CPU, and Tiingo allows 50 calls an hour. The script resumes where it
stopped and writes its reports on your computer. The daily functions only do a few weeks
at a time (about 0.1 s).

---

## 0. Behind the company TLS inspection

Certificate errors (`unable to get local issuer certificate`, `SELF_SIGNED_CERT_IN_CHAIN`)
mean a program does not trust your company's root certificate. Never turn verification off.

- **Node (pnpm prices, pnpm importer):** with Node 22.15 or newer, use the Windows store:
  ```bash
  export NODE_OPTIONS=--use-system-ca
  ```
  Otherwise export the root certificate once (Windows: `certmgr.msc` → Trusted Root
  Certification Authorities → Certificates → your company's root → All Tasks → Export →
  Base-64 X.509, save as `~/corp-root.cer`) and:
  ```bash
  export NODE_EXTRA_CA_CERTS=~/corp-root.cer
  ```
  Put the line in `~/.bashrc` to keep it.
- **Supabase CLI (`npx supabase`):** a Go program; it uses the Windows certificate store,
  where IT installs the company root, so it normally works as is.
- **curl:** use Windows' own `curl.exe` (`/c/Windows/System32/curl.exe`), which uses the
  Windows store. If it complains about revocation, add `--ssl-no-revoke`.

## 1. Get the API keys

- **Tiingo:** sign up at tiingo.com → Account → API → copy the token.
- **Alpha Vantage:** alphavantage.co → Get your free API key.
- **OpenFIGI (optional):** openfigi.com → sign up → API key. Only raises limits.

Keep them in a password manager. They go in two places only: `scripts/prices/.env` (your
computer, git-ignored) and Supabase secrets (step 6).

## 2. Apply the database migrations

Dashboard → SQL Editor, each file as its own query, in this order:

1. `supabase/migrations/20261022000001_listing_currency.sql` — sets
   `assets.trading_currency` to **USD** for listings on XNAS/XNYS/XASE (it was EUR for every
   asset after the import). Xetra and BTCEUR stay EUR. Your transactions and cost basis do
   not change.
2. `supabase/migrations/20261022000002_prices_snapshot_flags_job_runs.sql` — split factor on
   prices, staleness flags on snapshots, and the `job_runs` table.
3. `supabase/migrations/20261022000003_live_quotes.sql` — the `live_quotes` cache used by
   value-now.

Then run `supabase/tests/prices_jobs.sql` and the three earlier test files
(`rls_isolation.sql`, `rls_aal2.sql`, `import_functions.sql`); each must end with
`ALL CHECKS PASSED` and rolls back what it creates.

For future imports, the mapping file's `currency` column is now the **listing currency**:
USD for XNAS/XNYS/XASE, EUR for XETR, crypto and certificados (see `docs/import.md`).

## 3. Install and create the script's .env

After pulling this branch, install once more: it adds two workspace packages
(`packages/market`, `scripts/prices`), and without this step `pnpm prices` stops with
`Cannot find package '@ledgr/market'`.

```bash
pnpm install
cp scripts/prices/.env.example scripts/prices/.env
notepad scripts/prices/.env
```

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `LEDGR_USER_ID` exactly as for the importer
(`docs/import.md` step 5), plus `TIINGO_API_KEY`, `ALPHAVANTAGE_API_KEY` and optionally
`OPENFIGI_API_KEY`. The file is git-ignored. Every row the script writes carries your user id.

## 4. Resolve symbols

```bash
pnpm prices resolve
```

For every asset it asks OpenFIGI which ticker your ISIN has on your exchange, checks
it equals the mapping's ticker (US listings are looked up across the US exchanges together,
because OpenFIGI files Nasdaq stocks under Nasdaq's segment codes rather than XNAS; Xetra by
its MIC), and asks the provider to confirm the symbol (Tiingo:
the ticker; Alpha Vantage: `<TICKER>.DEX`, which must be the exact match and quoted in EUR;
BTCEUR: Coinbase `BTC-EUR`). Nothing is guessed. The console shows counts; the list is in
`prices-data/reports/<time>-resolve/symbols.csv`:

- **resolved** — will be written with `--commit`.
- **unchanged** — already set to the same symbol.
- **unresolved** — the `reason` column says why (ISIN/MIC missing, OpenFIGI lists no or a
  different ticker, provider does not know it, no API key). Fix the asset (Dashboard →
  Table Editor → `assets`: `isin`, `exchange`) and run again.
- **skipped** — certificados.

When the list is right:

```bash
pnpm prices resolve --commit      # type the project reference to confirm
```

Resolving uses about one Tiingo call per US stock. If you have many, wait an hour before the
backfill, or just run the backfill: it stops at Tiingo's limit and a later run resumes.

## 5. Backfill and review

```bash
pnpm prices backfill              # type the project reference to confirm
```

It fetches ECB rates from 14 days before 2021-01-01 (or your first trade), each asset's
closes from 14 days before each period you held it to the day you sold it (or yesterday),
and writes one snapshot per day from your first trade to yesterday. Re-running is safe:
everything is an upsert, and price ranges already stored are skipped.

The console shows counts and the portfolio totals only. Review the report folder
`prices-data/reports/<time>-backfill/`:

- `sanity.csv` — per open position: units, the split-adjusted close used, its currency and
  date, the FX rate, EUR value, cost basis, **value ÷ cost** and a `flag`:
  - `CHECK: value above 5x cost` or `below 0.2x cost`: possibly a split that your
    spreadsheet units do not reflect (a ratio near 20x or 1/20 for a 20:1 split), or a
    currency problem (a USD price read as EUR is off by the exchange rate, about 1.1x, so
    it is not flagged; compare the `price_currency` column with the listing).
  - `CHECK: no price`: the asset has no close yet (unresolved symbol, or bought before its
    listing). Snapshots value it at its last trade price, flagged.
  - `provider_splits` lists the splits the provider reported.
- `issues.csv` — what could not be done (codes below).

The command exits with an error code when something needs review (expected the first time).

`pnpm prices report` writes the sanity report again without changing anything.

## 6. Deploy the functions (only after you approve)

```bash
pnpm functions:build              # bundles packages/market + core into supabase/functions/_shared
npx supabase login                # opens the browser; or export SUPABASE_ACCESS_TOKEN=<token>
                                  # (Dashboard → Account → Access Tokens)
npx supabase functions deploy fx-daily       --project-ref <ref> --use-api --no-verify-jwt
npx supabase functions deploy prices-daily   --project-ref <ref> --use-api --no-verify-jwt
npx supabase functions deploy snapshot-daily --project-ref <ref> --use-api --no-verify-jwt
npx supabase functions deploy value-now      --project-ref <ref> --use-api --no-verify-jwt
```

`--use-api` bundles on Supabase's servers, so Docker is not needed. `--no-verify-jwt` is
deliberate: the functions do not trust JWTs (the anon key is public); each one refuses any
call without the `x-ledgr-cron-secret` header before reading or writing anything.
`value-now` instead checks the caller's session with Supabase Auth itself (see "Value now").

If the CLI is blocked, use Dashboard → Edge Functions → Deploy a new function → Via editor,
name it `fx-daily`, and paste a single file made like this (then the same for the others
with `'prices'` and `'snapshots'`; for `value-now` the last line is
`Deno.serve((req) => handleValueNow(req, Deno.env.toObject()));`), and in the function's
settings turn JWT verification off:

```bash
{ cat supabase/functions/_shared/ledgr-jobs.js
  echo "Deno.serve((req) => handleJob('fx', req, Deno.env.toObject()));"; } > fx-daily.single.ts
```

**Secrets** — Dashboard → Edge Functions → Secrets → add:

| Name                     | Value                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `LEDGR_USER_ID`          | your user's UID (Authentication → Users)                                                                              |
| `LEDGR_CRON_SECRET`      | a new random value, at least 32 characters (see below)                                                                |
| `TIINGO_API_KEY`         | your Tiingo token                                                                                                     |
| `ALPHAVANTAGE_API_KEY`   | your Alpha Vantage key                                                                                                |
| `LEDGR_STALE_AFTER_DAYS` | optional, default 3                                                                                                   |
| `LEDGR_CA_MAX_AGE_DAYS`  | optional, default 35                                                                                                  |
| `LEDGR_SERVICE_KEY`      | only if your project has the legacy keys disabled: an `sb_secret_…` key                                               |
| `LEDGR_ALLOWED_ORIGINS`  | value-now: browser origins of the desktop app, comma-separated (e.g. `http://localhost:5173`); not needed for Android |
| `LEDGR_ANON_KEY`         | value-now, only if the legacy keys are disabled: your `sb_publishable_…` key                                          |
| `LEDGR_TIME_ZONE`        | value-now, optional, default `Europe/Lisbon` (decides "today")                                                        |

`SUPABASE_URL` and the service-role key are provided to functions by Supabase. Generate the
cron secret on your computer and paste it straight into the Dashboard (and, in step 7, into
Vault); do not save it in a file:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Test once by hand** (replace the values; the response holds counts only):

```bash
curl.exe -sS -X POST "https://<ref>.supabase.co/functions/v1/fx-daily" \
  -H "x-ledgr-cron-secret: <secret>" -H "Content-Length: 0"
# {"job":"fx","status":"ok","counts":{...},"issues":0}
curl.exe -sS -X POST "https://<ref>.supabase.co/functions/v1/fx-daily" -H "Content-Length: 0"
# {"error":"unauthorized"}  (401)
```

Each run adds a row to `job_runs` (Table Editor), with counts and issue codes.

## 7. Schedule (only after you approve)

1. Dashboard → Database → Extensions: enable **pg_cron** and **pg_net** (Vault is on by
   default).
2. SQL Editor, once (the URL and the same secret as `LEDGR_CRON_SECRET`):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'ledgr_project_url');
   select vault.create_secret('<secret>', 'ledgr_cron_secret');
   ```
3. SQL Editor: run `supabase/cron/schedule.sql`.

The schedule, in UTC (Lisbon is UTC in winter, UTC+1 in summer), every day because bitcoin
trades at weekends:

| Time  | Job              | Why then                                                                                                                                                                        |
| ----- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 05:15 | `fx-daily`       | the ECB publishes around 16:00 CET; yesterday's rate is long out                                                                                                                |
| 05:25 | `prices-daily`   | the US close (20:00 UTC in summer, 21:00 in winter) and Xetra (16:30 UTC) are hours past, and providers have applied their overnight corrections; BTC's UTC day closed at 00:00 |
| 05:40 | `snapshot-daily` | after both; values every day up to yesterday                                                                                                                                    |

Check it: `select * from cron.job;`, then the next morning
`select * from cron.job_run_details order by start_time desc limit 5;` and
`select status_code, content from net._http_response order by created desc limit 5;`.
Stop it with `supabase/cron/unschedule.sql`.

---

## Value now (intraday)

The daily snapshots are the official history and use closing prices. For the dashboard,
`value-now` values the portfolio **now**: when the app opens the dashboard it calls the
function, which refreshes quotes that are due, values every holding in EUR with the same
rules as the snapshots (packages/core), and returns the totals. It never writes snapshots.

**Who can call it:** only you. The app sends your session (`supabase.functions.invoke`
does this); the function asks Supabase Auth to validate it, then requires MFA (`aal2`) and
your user id (`LEDGR_USER_ID`). It reads and writes with that same session, so RLS and the
aal2 policies apply; the service-role key is not used.

**When quotes are refreshed** (cached in `live_quotes`, so opening the app often costs
nothing):

| Asset      | Provider (endpoint)           | Refreshed at most every | Only while                                       |
| ---------- | ----------------------------- | ----------------------- | ------------------------------------------------ |
| BTC        | Coinbase ticker (no key)      | 5 minutes               | always (trades 24/7)                             |
| US stocks  | Tiingo IEX (one call for all) | 15 minutes              | 14:30–21:30 Lisbon (NY 9:30–16:30), weekdays     |
| Xetra ETFs | Alpha Vantage GLOBAL_QUOTE    | 3 hours                 | 08:00–17:00 Lisbon (Berlin 9:00–18:00), weekdays |

Outside those hours a quote is fetched once more if the cached one predates the close, so
you see the final closing price; then nothing until the next session. EUR conversion uses
the latest ECB rate (published once a day, about 16:00 CET). Certificados use the factor,
as always. Rough daily use: Alpha Vantage about 12 of its 25 calls (plus 3 for the daily
job), Tiingo about 30.

**Check intraday access after deploying.** I could not confirm whether Tiingo's free plan
includes the IEX endpoint. If it does not, US stocks simply show the last daily close and
the response lists an `http_error` (status 401/403) issue for them; the rest still works.
Likewise, Alpha Vantage's free GLOBAL_QUOTE for Xetra may return the last close rather than
an intraday price. The `assets` list in the response says which price each holding used.

**Response** (amounts are strings in EUR; your own data, never logged):

```json
{
  "computedAt": "2026-10-22T14:05:00.000Z",
  "valuationDate": "2026-10-22",
  "totalValueEur": "…",
  "stockValueEur": "…",
  "etfValueEur": "…",
  "cryptoValueEur": "…",
  "certificadoAforroValueEur": "…",
  "costBasisEur": "…",
  "netInvestedEur": "…",
  "stale": false,
  "caValueSource": "factor",
  "caValueAsOf": "2026-10-01",
  "caValueAgeDays": 21,
  "caValueStale": false,
  "assets": [
    {
      "assetId": "…",
      "source": "live",
      "asOf": "2026-10-22",
      "quotedAt": "2026-10-22T10:04:58-04:00",
      "ageDays": 0,
      "stale": false
    }
  ],
  "fxDates": { "USD": "2026-10-21" },
  "refreshed": 2,
  "issues": []
}
```

`source` is `live` (intraday quote), `close` (a daily close), `trade` (no price at all:
last trade price), or `factor` / `subscription` / `mixed` for certificados. Errors: 401 (no
or invalid session), 403 `mfa_required` or `forbidden`, 503 `missing_fx` (no ECB rate yet:
run the fx backfill), 500 `failed`.

In the app: `const { data, error } = await supabase.functions.invoke('value-now')`. For the
desktop app in a browser, add its origin to `LEDGR_ALLOWED_ORIGINS`.

---

## Re-running a backfill

Safe at any time (upserts; snapshots are deterministic, so the same inputs give the same
rows).

```bash
pnpm prices backfill --only snapshots --from 2025-03-01          # recompute snapshots
pnpm prices backfill --only prices --from 2024-01-01 --refetch   # fetch stored ranges again
pnpm prices backfill --only fx                                   # rates only
pnpm prices backfill --to 2025-12-31                             # stop at a date
```

- **A CA factor entered late:** the daily run recomputes from the 1st of the previous month.
  For an older month: `pnpm prices backfill --only snapshots --from <that month's 1st>`.
- **A new or corrected transaction in the past:** `--only prices,snapshots --from <its date>`
  (prices: only if it opened a new holding period).
- **One daily run by hand:** the curl command from step 6, optionally with
  `-H "Content-Type: application/json" -d '{"from":"YYYY-MM-DD"}'` (at most 62 days back)
  instead of `-H "Content-Length: 0"`.

## Rotating a key

Secrets are read on every call, so no redeploy is needed.

- **Tiingo / Alpha Vantage:** create the new key at the provider → Dashboard → Edge
  Functions → Secrets → edit the value → update `scripts/prices/.env` → revoke the old key
  at the provider.
- **Cron secret:** generate a new value, then change both places together:
  Edge Functions → Secrets → `LEDGR_CRON_SECRET`, and in the SQL Editor
  `select vault.update_secret((select id from vault.secrets where name = 'ledgr_cron_secret'), '<new>');`.
  A run between the two edits gets a 401 and does nothing; run it by hand afterwards.
- **Supabase service-role / secret key:** rotate in Dashboard → Project Settings → API Keys;
  update `scripts/prices/.env` (and `LEDGR_SERVICE_KEY` if you set it).

## When a provider breaks

Nothing fails hard: snapshots keep using the last known close and mark the asset **stale**
(after 3 days) in `stale`, `stale_asset_count` and `valuation_flags`. To find out why:

1. Table Editor → `job_runs`, newest `prices` row: `status` (`partial` = some assets failed)
   and `issues`:

   | Code                             | Meaning / action                                                                                                                                                 |
   | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `http_error` + `status` 401/403  | key wrong, revoked or plan changed: rotate the key                                                                                                               |
   | `http_error` 429, `rate_limited` | limit reached; the next day's run catches up (it resumes from the newest close)                                                                                  |
   | `http_error` 5xx / 0             | provider or network down; usually resolves itself                                                                                                                |
   | `unknown_symbol`                 | symbol delisted or renamed: run `pnpm prices resolve` again                                                                                                      |
   | `premium_only`, `bad_response`   | the provider changed its API or plan: see "switch provider" below (Alpha Vantage's full history is premium: the backfill then takes the latest 100 trading days) |
   | `currency_mismatch`              | provider quotes another currency than the listing; nothing stored; check the asset                                                                               |
   | `stale`                          | newest close older than the limit (holiday, or one of the above)                                                                                                 |
   | `split`                          | the provider reports a split: see "Splits" below                                                                                                                 |
   | `no_price_source`                | asset has no symbol (`manual`): resolve it                                                                                                                       |
   | `no_price_before_first_trade`    | history starts after your first buy (e.g. a SPAC); trade price used until then                                                                                   |
   | `missing_fx` (snapshots)         | no ECB rate yet for that day: run `pnpm prices backfill --only fx`                                                                                               |

2. **Switch provider** (if one disappears or turns paid): add an adapter in
   `packages/market/src/providers/` implementing `PriceProvider` (`fetchDaily`,
   `checkSymbol`), register it in `createProviders`, add its symbol rule in
   `packages/market/src/symbols.ts`, run `pnpm check`, then `pnpm prices resolve --commit`,
   `pnpm prices backfill --only prices,snapshots --refetch --from <first affected date>`,
   rebuild and redeploy the functions (step 6) and add its key to the secrets.

## Splits

Your ledger records **post-split units** (assumption #23): prices are stored raw with the
provider's split factor, and snapshots use split-adjusted closes. When a held stock splits
in the future, the daily run logs a `split` issue: restate that asset's earlier rows to
post-split units (quantity × ratio, unit price ÷ ratio) so units and prices agree, then
re-run `pnpm prices backfill --only snapshots --from <first trade of that asset>`. Until
then the sanity ratio for that asset is off by the split ratio. Alpha Vantage does not
report splits (rare for these ETFs); the sanity report would show one.
