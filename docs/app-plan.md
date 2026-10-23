# Android app plan (Step 5)

Status: **plan approved with decisions D1–D7 on 2026-10-23** (§9). **Slice 5a-core built
2026-10-23** (`packages/core` and docs only, §8); the rest starts only when asked. KPI definitions are in `docs/kpis.md`; calculation
assumptions in `docs/assumptions.md`.

`apps/mobile`: Expo + React Native + TypeScript, Android only, run with Expo Go during
development and installable as an APK built with EAS. All numbers come from
`packages/core`; the app fetches, calls core, formats and renders.

## 1. Navigation and screens

```
Root (auth gate, §6)
├─ Startup error      (bad config: missing URL/key, secret key configured)
├─ Sign in            (email + password)
├─ MFA challenge      (6-digit TOTP)          ← every aal1 session lands here
├─ No authenticator   ("enroll in the desktop app", sign out)
├─ Lock screen        (biometric / device PIN) ← overlays everything below
└─ Main: bottom tabs
   ├─ Dashboard   ─┬─ Allocation
   │               └─ Performance
   ├─ Positions   ─┬─ Position detail ── Transactions for the asset
   │               └─ Broker detail ──── Position detail
   ├─ New (+)     ─── Form ── Add asset (modal) ── Confirm ── Saved
   ├─ Activity    ─── Transaction detail ── Edit (form ── confirm) / Delete (dialog)
   └─ More        ─┬─ Certificados ── Factor update
                   ├─ Allocation, Performance, Closed positions (same screens)
                   └─ Settings
```

Every screen with figures has a header line "as of 14:05 · prices 22 Oct" and an eye
button (hide values). Pull to refresh everywhere. Errors are shown in place (never as an
empty list); amounts never appear in error text.

### Dashboard

- **Header card**: total value (large), day change € and % (green/red), "as of" time.
  Indicators under it when they apply: "2 prices stale", "1 price pending", "CA factor
  41 days old" (tap → list of the assets concerned with their price dates).
- **Gain card**: total gain (€) on top, and its components as separate lines that add up
  to it (`docs/kpis.md` §1): realized, unrealized (€ and %), net income, other costs (shown
  as a negative). Below: net invested.
- **Returns card**: XIRR and TWR side by side, segmented Since start / YTD / 1Y; "not
  annualized" note where it applies. Tap → Performance.
- **Chart**: value line and net-invested line, range chips 1M / 3M / YTD / 1Y / All; touch
  to scrub (date, value, net invested). Under it: value change and net-invested change for
  the range.
- **Allocation donut** by type with legend (type, %, €). Tap → Allocation.
- **Top movers**: two tabs Day / Total, 3 up and 3 down, ranked by € impact with the %
  beside it: ticker, name, €, %. A small €/% chip switches the ranking to % (the same core
  function with another sort key, so it is cheap). Tap → Position detail.

### Positions

- Segmented control **All / By broker / By type / Closed**.
- Search box (ticker, name, ISIN). Filter sheet: type, broker, listing currency,
  stale only. Sort menu: value, weight, gain, day change (asc/desc).
- **All**: rows with ticker + name, units, value, weight, unrealized € and %, day %; stale
  and "price pending" badges.
- **By broker**: one card per broker (value, weight, gain); tap → Broker detail (the same
  row list filtered to that account's units, plus realized, income and costs in that
  account).
- **By type**: section per type with subtotal and weight.
- **Closed**: realized results per asset (§kpis 8), banner "Performance, not tax".
- **Position detail**: header (value, day change); figures (units, average cost, cost
  basis, unrealized, realized, income); price chart (1M / 3M / YTD / 1Y / All, split
  adjusted, with buy/sell markers); **split by broker** table; **open lots** table (account,
  date, units, unit cost, cost); "Transactions" → the asset's ledger rows (newest first).
  For a certificado: link to Certificados instead of a price chart.

### Allocation

Segmented **Type / Broker / Currency / Asset**: donut plus table (group, €, %), and a
**Top 5 / Top 10** card (combined weight, the positions in it).

### Performance

- **Monthly** table: one row per month, newest first: return %, contributions, market
  gain, income; "approx." badge on imported month-level months; MTD row on top.
- **Yearly** table: the same per year (YTD on top).
- **Contributions vs market gains**: bar chart per month (or per year when zoomed out).
- **Best / worst month** card.

### New transaction

1. **Type**: Buy, Sell, Dividend as large buttons; "More" reveals Interest. Deposits and
   withdrawals stay in the schema but are not in this form (they change no figure, D5);
   transfers, certificado subscriptions and redemptions are not in it either (D7).
2. **Form** (all amounts in EUR, as in the import):
   - Asset: searchable picker over existing assets (ticker, name, ISIN); "Add asset" at the
     bottom. Not shown for Interest (cash interest has no asset).
   - Buy / Sell: quantity and **total value** (€); the unit price is derived and shown
     read-only ("= 412.37 € per unit").
   - Dividend / Interest: **"Amount received"** (€, the net amount that arrived; no
     withholding field, D6).
   - Date: default today, date picker, no future dates.
   - Broker / account: default by the rule below, changeable.
     **Sell**: only brokers holding units of the asset on the date are offered, each with
     "holds 3.5 · can sell 3.5"; the field shows an error above that.
   - Fee (optional, default 0): Buy and Sell only. Dividend / Interest have none, since the
     amount received is already net.
   - Saved as currency EUR, `fx_rate_to_eur` 1 (foreign-currency rows are not in scope).
   - Validation messages inline; submit disabled until valid.
3. **Confirm**: summary of the row, and the **resulting position** in that account and
   overall (units before → after, average cost, cost basis; for a sell the realized gain of
   this sale). Buttons Back / Save. Save is disabled while saving (spinner), and the row's
   id is a client-generated UUID created when the form opens, so a retry after a timeout
   cannot create a second row (§5).
4. **Saved**: toast, back to the screen the flow started from; data refetched.

Default account: for a sell, the account with the most units of the asset on the date;
otherwise the account used by the most non-deleted rows of that type in the last 12 months
(all time when none), ties by the most recent row.

**Add asset** (modal): name, type, ticker, ISIN (check digit verified), exchange (XNAS,
XNYS, XASE, XETR, or none for crypto), listing currency (prefilled from the exchange and
must match it, #26). Saved with `price_source = 'manual'`; the asset shows **"price
pending"** (valued at its trade price, flagged) until the next `prices-daily` run resolves
its symbol and fetches its closes (§5 "Symbol resolution in prices-daily", D3). If
resolution fails, it stays "price pending" and the reason is in `job_runs`.

### Activity

List of ledger rows, newest first, grouped by month: date, type icon, asset, broker,
quantity, total. Filter chips: asset, broker, type, date range. Tap → detail with
**Edit** (the same form, prefilled, then confirm) and **Delete** (dialog naming the row;
sets `deleted_at`). Both are re-validated against the whole ledger: an edit or delete that
would make any later sale exceed its broker's holdings is refused, naming that sale.
Imported month-level rows show "month only" next to the date. Rows of types the form does
not offer (deposit, withdrawal, transfer, subscription, redemption) are listed and can be
deleted, but not edited in the app.

### Certificados

- List of subscriptions: series, subscription month, units held, latest factor and its
  month, value ("from factor"), gain, factor age; red badge when older than 35 days.
- **Factor update**: month preselected (the current month), one input per subscription,
  each showing last month's factor and the change (€ and %) as you type; warning (not a
  block) if a factor decreases. Save inserts one `ca_factors` row per subscription
  (insert only: rows are immutable, a month already recorded is shown read-only). Note
  under the button: "snapshots pick this up in tomorrow's daily run".

### More / Settings

Biometric lock (on/off, lock after 0 / 1 / 5 / 15 minutes in the background), hide values
(on/off), block screenshots (on/off), last price update and last snapshot (time and status
from `job_runs`), sign out, app version (and the Supabase project ref, so a wrong `.env`
is visible).

## 2. KPI definitions

See `docs/kpis.md`.

## 3. New `packages/core` functions

Pure TypeScript, Decimal only, no UI, no network. Each with unit tests built from
hand-checkable numbers (a few lots, round prices), plus property tests (fast-check, as in
`properties.test.ts`) for the invariants.

| Function (file)                                                    | Purpose                                                                                                                                               | Tests                                                                                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runFifo` option `matching: 'account' \| 'pooled'` (`fifo.ts`)     | per-account lots by default; transfers move the sender's oldest lots                                                                                  | §4 below                                                                                                                                                 |
| `Holding.accounts[]` extended (`holdings.ts`)                      | per account: units, lots, cost basis, value, unrealized                                                                                               | 2 brokers × 2 lots by hand; property: Σ accounts = holding for value, cost, unrealized                                                                   |
| `accountSummaries` (`accounts.ts`)                                 | per broker: value, weight, cost, _U_, _R_, _I_, _C_, gain                                                                                             | hand example; property: Σ brokers = `gainsSummary`                                                                                                       |
| `closedPositions` (`closed.ts`)                                    | realized results per fully closed asset, split by account                                                                                             | buy 10 @ 10, buy 10 @ 12, sell 20 @ 15 → gain 80; reopened asset is not listed                                                                           |
| `positionDetail` (`positions.ts`)                                  | one asset: figures, split by broker, open lots, realized, income                                                                                      | hand example; lots and broker lines add up                                                                                                               |
| `dayChange` (`daychange.ts`)                                       | _V(T)_, _V(Y)_, _F(T)_, _D_ and % for the portfolio and per asset                                                                                     | the §kpis 2 example (60, 0.60%); a sale today; position opened today ("new"); _V(Y)_ = 0                                                                 |
| `dailyFlows` (`cashflows.ts`)                                      | _F(d)_ per day from `investmentCashFlows`                                                                                                             | one row of each type; Σ _F_ = _V_ − _G_ identity                                                                                                         |
| `twr` change (`twr.ts`)                                            | start-of-day rule for a step starting from zero with a positive flow                                                                                  | buy 1,000, worth 1,010 that evening → 1%; full exit and re-entry                                                                                         |
| `periodReturns` (`returns.ts`)                                     | XIRR and TWR for Since start / YTD / 1Y from snapshots + ledger + _V(T)_, incl. the "not annualized" rule                                             | 1 year doubling → 100%; YTD half year 10% period ↔ 21% annualized; missing start snapshot → reason                                                       |
| `valueSeries` (`returns.ts`)                                       | value vs net invested points for a range, plus today's point                                                                                          | range boundaries (1M on 31 Mar → from 29/28 Feb)                                                                                                         |
| `monthlyReturns`, `yearlyReturns`, `bestWorstMonth` (`returns.ts`) | the §kpis 5 tables                                                                                                                                    | 3 months by hand; yearly = product of months; MTD excluded from best/worst; "approx." flag                                                               |
| `allocation` (exists)                                              | `account` dimension now uses exact per-account values                                                                                                 | existing tests + CA lots in two accounts                                                                                                                 |
| `topPositions`, `topMovers` (`movers.ts`)                          | §kpis 6–7 rankings; `topMovers` ranks by € (default) or % (`by: 'eur' \| 'pct'`)                                                                      | € and % rankings differ on a hand example; ties; "new" and zero-change exclusions                                                                        |
| `unitsHeld`, `maxDisposable` (`validation.ts`)                     | units per account on a date; the most that can be sold on that date without breaking a later sale                                                     | hold 10, later sell 6 → on an earlier date only 4 can be sold; property: `maxDisposable` = largest _q_ for which `runFifo` accepts the ledger + the sale |
| `validateNewTransaction`, `validateLedgerChange` (`validation.ts`) | typed errors: quantity/value ≤ 0, future date, unknown asset, sell above the broker's holdings (incl. later sales), edit/delete breaking a later sale | one test per error; boundary: selling exactly `maxDisposable` passes, + 1e-18 fails                                                                      |
| `previewTransaction` (`validation.ts`)                             | the confirm screen: units before/after per account and overall, average cost, cost basis, realized gain of the sale                                   | buy and sell examples by hand                                                                                                                            |
| `unitPriceFromTotal`, `parseDecimalInput` (`input.ts`)             | unit price = total ÷ quantity rounded half-even to 18 dp; user text → Decimal (`1,5` and `1.5`; thousands separators and exponents rejected)          | `100` / `3` → `33.333333333333333333`; `"1,5"`, `"1.5"`, `"1.234,5"` (rejected), `"-1"`, `"1e3"`                                                         |
| `mostUsedAccount` (`validation.ts`)                                | default broker rule                                                                                                                                   | ties, 12-month window                                                                                                                                    |
| `certificadoSubscriptions`, `factorChange` (`certificados.ts`)     | per-subscription view and the update screen's change                                                                                                  | value/gain by hand; age 35 vs 36 days                                                                                                                    |
| `localDate` (moved from `market/src/live.ts` to `dates.ts`)        | "today" in Europe/Lisbon                                                                                                                              | existing tests move with it; 23:30 UTC in summer → next day                                                                                              |
| `reconcile` (`sanity.ts`)                                          | run-time identity checks: _V_ − _NI_ = _R_ + _U_; Σ accounts = totals                                                                                 | a deliberately broken input is reported                                                                                                                  |

`buildDashboard` / `buildPositions` (`views.ts`) compose the above into one object per
screen, so the app has no arithmetic at all; they are tested on the fixture-shaped ledger.

## 4. FIFO per account (broker)

**Before slice 5a-core:** pooled. `runFifo` keyed its lot queues by asset only
(`fifo.ts`), a sale in any account consumed the oldest lot anywhere, and the oversell check
was against the total over all accounts; transfers only changed the per-account unit split.
Assumption #1 said "pooled" since it was written (commit 5afff85, Step 2 review); the code
was per (account, asset) _before_ that commit, which is where "#1 says per account" comes
from. The importer already checked every sell against its own broker's holdings (#22).

**Change (built in slice 5a-core, 2026-10-23):**

- Lot queues keyed by (account, asset). A sale consumes only its account's lots; selling
  more than that account holds throws `InsufficientHoldingsError` (with the account id).
- A transfer moves the sender's oldest lots (FIFO) to the receiver with their acquisition
  date and remaining cost; a partly moved lot is split (cost pro rata, remainder by
  subtraction so the parts sum exactly). The moved part gets the id
  `<lot id>:<transfer id>`; each lot keeps `originTransactionId`, which CA redemptions
  match on.
- Holdings: one row per asset as now, plus exact per-account lots, cost, value and
  unrealized (no more pro rata split). `accountQuantities` goes away (derived from lots).
- **Pooled mode only for a one-off comparison** (D2): `runFifo` keeps a
  `matching: 'pooled'` option (the old code path: the queue key, and "transfers do not
  move lots"), documented as "comparison only". Its only callers are the one-off
  `pnpm prices fifo-compare` command and the tests. The app, snapshots and
  value-now always use per-account FIFO; nothing in any UI offers pooled. Once you have
  run the comparison, the command and the option can be deleted in a later step.
- Totals: realized is Σ disposals and each disposal belongs to one account; open cost is
  Σ lots and each lot belongs to one account. So portfolio realized and unrealized equal
  the sum over accounts by construction; a property test checks it on random ledgers
  (2 accounts, 3 assets, buys/sells/transfers), and another that both modes give identical
  results whenever every asset is held in one account only.
- Tests: the pooled tests in `fifo.test.ts` become per-account ("a sale in IBKR does not
  touch the older Degiro lot", "oversell is per account", "transfer moves the oldest lots
  with their cost", "partial transfer splits a lot"), plus one pooled-mode test each.
- `docs/assumptions.md` #1 (renamed "FIFO lots per account"), #21 (transfers move lots)
  and #22 (the importer's check now matches FIFO) are rewritten; the change is dated.
- The Edge Function bundle must be rebuilt and redeployed (`docs/prices.md` step 6) so the
  daily snapshots and value-now use the same rule as the app. The app compares its own
  cost basis with value-now's (§5) and shows a warning if they differ.

**Do your existing realized gains change?** Gains differ between the two modes only when a
sale happened while the same asset had open lots in another account (or after a transfer).
I checked `fixtures/sample_transactions.csv`, which keeps your real row order, dates and
brokers: every one of the 13 sells is of an asset held only at Degiro, there are no
transfers, and SXR8, the only asset at two brokers (Degiro 2024-04 to 2024-09, IBKR from
2024-10), has **no sells**. So **no realized gain changes, before or after; nor does any
cost basis or snapshot.** Before: realized as now. After: identical figures. What this
cannot see is rows added to the database after the import; slice 5a-core therefore adds
the read-only one-off command `pnpm prices fifo-compare` (`docs/prices.md`), which runs both
modes on the live ledger of `LEDGR_USER_ID` (service-role key in the git-ignored
`scripts/prices/.env`, like the importer) and **prints only counts and totals**: ledger
rows, disposals, realized gain under each mode, the number of disposals whose gain changes,
open cost under each mode and the number of assets whose cost changes. No per-trade value
is printed or written. `pnpm prices fifo-compare --fixtures` runs the same on
`fixtures/sample_transactions.csv` (no `.env` needed); a test asserts it finds 0 changes
(13 disposals). I expect 0 on the live ledger too.

**Sell form** (slice 5c): units held per broker for the chosen asset on the chosen date
(`unitsHeld`), only brokers with units offered, and the limit is `maxDisposable`: the most
that can be sold on that date without breaking a later sale in the same account (holding
10 on 1 March and selling 6 on 1 May, a backdated sale on 1 April may sell at most 4). The
final check runs `validateNewTransaction`, i.e. FIFO over the whole ledger with the new row.

## 5. Data access

**Client**: `@supabase/supabase-js` with the anon key and the user's session. Every query
runs under RLS + aal2. A shared package **`packages/client`** (new; plain TypeScript, no
React) holds what mobile and desktop both need: `assertPublicKey` (moved from
`apps/desktop`), the MFA state helpers (moved from `apps/desktop/src/auth/mfa.ts`), the
row → core-type mappers (moved from `packages/market/src/rest-db.ts`, which then imports
them, so jobs and apps parse numerics identically), and `selectAll` (pagination).

**Numerics** are always selected as text (`quantity::text`) and parsed with `dec()`, as in
the jobs. Writes send strings.

**Queries** (the TanStack Query key in brackets):

| Data                  | Query                                                                                                                                                            | Rows today               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `['ledger']`          | `transactions` (not deleted, order `trade_date, created_at, id` — the order FIFO relies on), `assets`, `accounts`, `ca_subscriptions`, `ca_series`, `ca_factors` | ~150 + ~25 + 4 + 3 + ~30 |
| `['market', T]`       | `prices` of held assets dated ≥ _T_ − 14 days, plus the latest older close for an asset with none in that window; `fx_rates` ≥ _T_ − 14 days; `live_quotes`      | ~200                     |
| `['valueNow']`        | `supabase.functions.invoke('value-now')`: refreshes due quotes server-side (provider keys never reach the app), returns totals                                   | 1 call                   |
| `['snapshots']`       | `portfolio_snapshots`: `snapshot_date, total_value_eur::text, net_contributions_eur::text`, order by date                                                        | ~2,150 → 3 pages         |
| `['prices', assetId]` | one asset's full price history (`price_date, close::text, currency, split_factor::text`), only when its detail chart opens                                       | up to ~2,200 → 3 pages   |
| `['jobRuns']`         | `job_runs` newest `prices` and `snapshots` rows (`limit 1` each)                                                                                                 | 2                        |

**Pagination**: `selectAll(build)` requests `range(offset, offset + 999)` with a total order
on a unique key (`order(date).order(id)`) until a page returns fewer than 1,000 rows.
Applied to every table query except `limit 1` lookups, so a growing ledger never silently
truncates; a test feeds a fake client 2,500 rows and checks all arrive once, in order.

**Caching**: TanStack Query in memory only, **no persister**: nothing financial is written
to the device (AsyncStorage holds only the encrypted session and the settings toggles). The
cache is dropped on sign-out and when Android kills the process. Freshness: ledger and
snapshots `staleTime` 1 hour (snapshots change once a day), market data and value-now
5 minutes, refetch on app focus and pull to refresh. After a save, `['ledger']`,
`['market', T]` and `['valueNow']` are invalidated. Screens show `dataUpdatedAt` as the
"as of" time and the price dates from the valuation flags.

**Computation flow (Dashboard)**:

1. `['valueNow']` first (quotes refreshed), then `['ledger']`, `['market', T]` in parallel.
2. Core: `withLiveQuotes` (closes + quotes) → `computeHoldings` at _T_ and _Y_ →
   `dayChange`, `gainsSummary`, `allocation`, `topMovers`, valuation flags (stale, pending).
3. `['snapshots']` + ledger flows → `periodReturns`, `valueSeries` (today's point
   appended).
4. If value-now fails (provider down, offline), step 2 uses the closes and the cached
   `live_quotes` rows and the header says "live prices unavailable".

**Charts** take snapshot rows (value, net invested) for the range; the position chart takes
the asset's split-adjusted closes (`splitAdjustPrices`). Series longer than ~300 points are
thinned for drawing only (keep first, last, and the min and max of each bucket); figures
under the chart always come from the full series. `Decimal` is converted to `number` only
here, for pixel positions; labels are formatted from the Decimal.

**Writes**: insert `transactions` with a client UUID (`expo-crypto` `randomUUID`) generated
when the form opens; a duplicate-key error on retry (`23505` on the primary key) is treated
as "already saved" after re-reading that id. Edits are `update ... where id = ?`;
deletes set `deleted_at`. New rows: `trade_date_precision 'day'`, currency EUR, fx 1. CA
factors: insert only. Add asset: insert `assets`.

**Symbol resolution in prices-daily** (D3, slice 5c). A step at the start of the
`prices-daily` run, before prices are fetched:

- Candidates: assets not deleted, not certificados, with `price_source = 'manual'` and the
  ISIN and exchange the resolver needs (crypto: by its ticker rule). At most 5 per run, to
  stay within the Edge Function's limits and OpenFIGI's 25 requests per minute; the rest
  wait for the next day.
- Each candidate goes through the same `resolveSymbols` code as `pnpm prices resolve`
  (OpenFIGI ticker check, then the provider's symbol check; nothing is guessed). A
  resolved symbol is written to `assets.price_source(_id)` and that asset's closes are
  fetched in the same run (from 14 days before its first buy).
- **A failure never breaks the price run**: each asset is resolved inside its own
  try/catch with a time limit; an unresolved asset, a provider error or an OpenFIGI
  outage becomes a `job_runs.issues` entry (`unresolved` with the reason, or `http_error`)
  and the run continues with the other assets. Resolution problems alone make the run
  `partial` at worst, never `failed`. Tests: OpenFIGI down, provider unknown symbol and a
  throwing resolver each leave the other assets' prices fetched.
- The app shows "price pending" for such an asset (trade price stand-in, #25) and the
  issue's reason in its detail.
- Snapshots for a backdated first buy older than the daily window (the 1st of the
  previous month) still need `pnpm prices backfill --only prices,snapshots --from <date>`.
- `docs/prices.md` gains a "Redeploying after an update" section (written in 5a for the
  FIFO change, extended in 5c): `pnpm functions:build`, then the CLI deploy, **or**, if the
  CLI is blocked on the company network, the Dashboard route (Edge Functions → the function
  → edit, paste the single-file bundle, JWT verification off), then a hand-run with
  `curl.exe` and the `job_runs` row to check.

**Sanity checks** — where they live:

- In core (pure, tested): `reconcile` (_V_ − _NI_ = _R_ + _U_; Σ accounts = totals),
  `validateNewTransaction` / `validateLedgerChange`, staleness flags, `sanityReport`
  (value ÷ cost outliers).
- In the app (displayed, never silently fixed): a yellow banner when `reconcile` fails;
  when the app's _V(T)_ or cost basis differs from value-now's (a sign the deployed
  functions run an older core, e.g. before the FIFO change); when an asset has no price
  ("price pending") or no FX rate (the dashboard shows "—" for the totals and names the
  currency, rather than a wrong total).
- In the jobs (as today): `sanity.csv` and `job_runs.issues`; the More screen shows the
  last run's status.

## 6. Security

**Configuration**: `apps/mobile/.env` (git-ignored) with `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY`. At start, before the Supabase client exists,
`assertPublicKey` refuses an `sb_secret_…` key or a JWT whose role is not `anon`, and the
app also refuses to start if `EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`,
`EXPO_PUBLIC_SUPABASE_SECRET_KEY` or any third-party key variable we know of is set. The
startup error screen says which variable is wrong, never its value. For EAS builds the two
values are EAS environment variables (the `.env` is not uploaded).

**Sign in and MFA**: email + password (`signInWithPassword`), then the gate:

| Session state                                           | Screen               |
| ------------------------------------------------------- | -------------------- |
| none                                                    | Sign in              |
| `currentLevel` aal1, `nextLevel` aal2 (verified factor) | MFA challenge        |
| aal1, no verified TOTP factor                           | No authenticator     |
| aal2                                                    | Lock (if due) → Main |

`getAuthenticatorAssuranceLevel()` reads the level from the access token locally; it is
re-evaluated on every `onAuthStateChange` event (sign in, token refresh, MFA verified,
sign out) and when the app returns to the foreground. **aal1 never reaches a data screen**:
queries are only enabled in the aal2 state, and the query wrapper checks the token's `aal`
claim before each request and throws `MfaRequiredError` instead of running it (a
PostgREST call under aal1 would return empty arrays, which is exactly the "no data" lie to
avoid); value-now's `403 mfa_required` maps to the same error. That error switches the gate
to the MFA challenge. Empty states ("No transactions yet") render only after an aal2 query
succeeded. Enrollment stays in the desktop app (`docs/recovery.md`).

**Session storage**: SecureStore values are limited (about 2 KB), and a Supabase session
with an MFA-upgraded token is larger. So the session is stored by a small storage adapter:
a random 256-bit key in `expo-secure-store` (Android Keystore), the session JSON encrypted
with AES-256-GCM (`@noble/ciphers`, random 96-bit nonce per write, from `expo-crypto`) and
the ciphertext in AsyncStorage. A wrong or missing key or a failed authentication tag means
"no session" (sign in again), never a crash. Refresh tokens rotate as usual;
`autoRefreshToken` is started and stopped with the app state (Supabase's React Native
pattern). Sign-out clears both the ciphertext and the key.

**Biometric / PIN lock** (`expo-local-authentication`): on cold start and when the app
returns from the background after the timeout (default 1 minute; 0 / 1 / 5 / 15 in
Settings), the lock screen covers the app and prompts at once; device PIN/pattern is the
fallback. Failure or cancel keeps it locked (retry, or sign out). Default on at first
sign-in when the device has biometrics or a screen lock; if it has neither, the setting is
off and explains why. The lock is local: it does not touch the Supabase session.

**Hide values**: a toggle (eye icon in headers, and in Settings), remembered. All amounts
and units render as "••••" through one `<Money>` / `<Units>` component; percentages stay;
chart axes and scrub labels hide amounts.

**Screenshot blocking**: `expo-screen-capture` (`preventScreenCaptureAsync`) sets
Android's `FLAG_SECURE`: no screenshots, no screen recording, and a blank thumbnail in the
recent-apps view. Default on, can be turned off in Settings.

**Logging**: no `console` (ESLint), no crash or analytics SDK. Errors shown to the user
carry a code (`PGRST…`, HTTP status), never row values.

## 7. Libraries

Expo SDK: the current `apps/mobile` pins SDK 52, which today's Expo Go no longer opens.
SDK 58 was released on 15 Oct 2026; the Play Store Expo Go moves to it in the coming weeks
and will then open only SDK 58 projects. Slice 5a upgrades to **SDK 58** (React Native
0.88, New Architecture); until the store app updates, Expo CLI installs the matching Expo
Go on a USB-connected phone (`docs/mobile-run.md`). Every library below works inside Expo
Go (no custom native code).

| Need            | Choice                                                                                                               | Why                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation      | React Navigation 7 (bottom tabs + native stack)                                                                      | The auth gate is "render a different tree per state", which is plain React with React Navigation; no file-based routing or deep links needed; easy to test with React Native Testing Library |
| Charts          | `react-native-gifted-charts` (+ `react-native-svg`, `expo-linear-gradient`)                                          | Line (two series, scrubbing), area, bar and donut in one library; pure JS over SVG, which Expo Go includes; enough for ≤300 points after thinning                                            |
| Data fetching   | TanStack Query 5, in memory, no persister                                                                            | Caching, refetch on focus, `enabled` gating by AAL, invalidation after writes, `dataUpdatedAt` for "as of"                                                                                   |
| Forms           | `react-hook-form`; rules from core `validateNewTransaction`                                                          | Uncontrolled inputs, cheap re-renders; validation lives in core (tested, shared with desktop) instead of a schema library                                                                    |
| Supabase        | `@supabase/supabase-js` 2                                                                                            | Auth, MFA, PostgREST, `functions.invoke`                                                                                                                                                     |
| Session storage | `expo-secure-store` (key) + `@react-native-async-storage/async-storage` + `@noble/ciphers` (AES-GCM) + `expo-crypto` | Works around SecureStore's size limit; audited pure-JS cipher; all in Expo Go (MMKV's encryption would need a development build)                                                             |
| Lock, privacy   | `expo-local-authentication`, `expo-screen-capture`                                                                   | Official Expo modules, Android biometrics + device credential, `FLAG_SECURE`                                                                                                                 |
| Ids, dates      | `expo-crypto` `randomUUID`; `@react-native-community/datetimepicker`                                                 | UUID without polyfills; native date picker                                                                                                                                                   |
| Decimals        | `decimal.js` via `@ledgr/core`                                                                                       | Already used; pure JS, runs on Hermes                                                                                                                                                        |
| Tests           | `jest-expo` + `@testing-library/react-native`                                                                        | Vitest cannot run React Native components reliably; `pnpm check` gains `pnpm --filter @ledgr/mobile test`, and Vitest keeps everything else                                                  |

## 8. Slices

Each slice: short plan, implement, tests, `pnpm check`, commit and push, summary.

**5a-core — built 2026-10-23** (`packages/core` and docs only): FIFO per account (§4) and
`pnpm prices fifo-compare`; `accountSummaries`, `flowEur` / `dailyFlows`, the `twr` from-zero
rule, `dayChange`, `periodReturns`, `valueSeries`, `monthlyReturns`, `yearlyReturns`,
`bestWorstMonth`, `topPositions`, `topMovers`, `closedPositions`, `unitsHeld`,
`maxDisposable`, `certificadoSubscriptions` (pulled forward from 5b/5c as asked). Still to
do from 5a step 2: `reconcile`, `localDate`, `buildDashboard`; from 5b/5c: `positionDetail`,
`buildPositions`, the validation and input functions, `factorChange`, `mostUsedAccount`.
After it: rebuild and redeploy the functions (`docs/prices.md`, "After a core change").

**5a — Foundation, login, lock, Dashboard**

1. Core: FIFO per account (§4), assumptions #1/#21/#22, tests; the one-off
   `pnpm prices fifo-compare`; the "Redeploying after an update" section in
   `docs/prices.md`. You rebuild and redeploy the functions.
2. Core: `dailyFlows`, `twr` from-zero rule, `dayChange`, `periodReturns`, `valueSeries`,
   `topMovers`, `topPositions`, `reconcile`, `localDate`, `buildDashboard`; tests.
3. `packages/client`: key check, MFA helpers, row mappers (market and desktop switched to
   them), `selectAll`; tests.
4. `apps/mobile`: SDK 58, dependencies, env check, Supabase client with the encrypted
   session store, auth gate (sign in, MFA challenge, no authenticator), lock screen,
   screenshot blocking, hide values, tabs with Dashboard and a minimal More (sign out,
   version); jest-expo in `pnpm check`.
5. Component tests: aal1 session shows the MFA challenge and runs no query; an aal1 error
   during use switches to the challenge; the empty state appears only at aal2; startup
   refuses a secret key.
6. `docs/mobile-run.md`: Windows steps for Expo Go (LAN, tunnel, USB with `adb reverse`),
   the company-network workarounds, and the EAS APK build with the TLS-certificate
   workaround.

**5b — Positions, brokers, allocation, performance, closed positions**

Core: `accountSummaries`, `positionDetail`, `closedPositions`, `monthlyReturns`,
`yearlyReturns`, `bestWorstMonth`, `buildPositions`. App: Positions (four segments, search,
filters, sort), Position detail (price chart from paginated history), Broker detail,
Allocation, Performance, Closed positions.

**5c — New transaction, Activity, certificados, settings**

Core: `unitsHeld`, `maxDisposable`, `validateNewTransaction`, `validateLedgerChange`,
`previewTransaction`, `parseDecimalInput`, `unitPriceFromTotal`, `mostUsedAccount`,
`certificadoSubscriptions`, `factorChange`. App: New transaction (+ add asset, confirm),
Activity (filters, edit, soft delete), Certificados and factor update, full Settings.
Component tests: sell above the broker's holdings is blocked; future date, zero and
negative values are blocked; Save is disabled while saving and a double tap inserts one
row; a retried insert with the same id does not duplicate. Plus symbol resolution in
`prices-daily` (§5, D3) with its tests and the `docs/prices.md` redeploy steps.

## 9. Decisions (approved 2026-10-23)

- **D1 Total gain** = realized + unrealized + net income − other costs
  (_R_ + _U_ + _I_ − _C_), and the dashboard shows each component on its own line.
- **D2 FIFO per account (broker)**: a sale consumes only lots of the account selected for
  it; this is the default in `packages/core` (`runFifo`). **Pooled FIFO** exists only as a
  one-off comparison (`pnpm prices fifo-compare` and tests); never in any UI, snapshot or
  value-now (§4).
- **D3 Symbol resolution** is added to `prices-daily` (§5); a resolution failure never
  breaks the price run, and the app shows "price pending". `docs/prices.md` gets redeploy
  steps with a Dashboard route for when the CLI fails on the company network.
- **D4 Top movers** ranked by € impact with % beside it, plus a €/% ranking chip (cheap:
  one sort key in `topMovers`).
- **D5 Cash is not tracked.** Net contributions, XIRR and TWR are built from buys and
  sells (`docs/kpis.md` §0.1). Deposits and withdrawals stay in the schema but are not in
  the app (not in the New transaction form) and **change no figure**, their fees included.
- **D6 Dividends and interest**: the net amount received, labeled "Amount received", no
  withholding field (so `withholding_tax` stays empty on app-entered rows) and no fee.
  **All app rows are EUR at fx 1.**
- **D7 Not in the form**: transfers, certificado subscriptions and redemptions, and
  foreign-currency rows. Totals are entered in EUR (fx 1), as in the import.
