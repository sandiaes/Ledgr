# Calculation assumptions

Assumptions made by `packages/core`, approved as **provisional** on 2026-10-21 (#1–#20),
2026-10-22 (#23–#28, prices, snapshots and value now) and 2026-10-23 (#29–#34, the app's
KPIs, decisions D1–D7 in `docs/app-plan.md` §9; #1, #3, #5, #17, #19, #21 and #22 changed
the same day; #37–#39 written with slice 5c, 2026-10-24; #40 with slice 5d, the same day). Each one
stays `unverified` until it has been checked against an official source (or the owner's
own records), and is then updated here with the source.

Tax reporting is not a goal of this ledger. Tax reports will come from importing broker
report exports. In particular, **realized gains from FIFO are a performance metric, not a
tax figure.**

Paths are relative to `packages/core/src/` unless stated.

| #   | Topic                       | Status             |
| --- | --------------------------- | ------------------ |
| 1   | FIFO lots per account       | out of scope (tax) |
| 2   | Same-day ordering           | unverified         |
| 3   | Fees in cost and proceeds   | out of scope (tax) |
| 4   | FX conversion of gains      | out of scope (tax) |
| 5   | Dividend / interest amounts | unverified         |
| 6   | Certificado redemption gain | out of scope (tax) |
| 7   | No tax calculation          | out of scope (tax) |
| 8   | CA capitalisation periods   | unverified         |
| 9   | CA reference rate           | unverified         |
| 10  | CA rate formula             | unverified         |
| 11  | CA withholding              | unverified         |
| 12  | CA rounding                 | unverified         |
| 13  | CA term and minimum holding | unverified         |
| 14  | CA factors (default value)  | unverified         |
| 15  | CA test parameters          | unverified         |
| 16  | XIRR convention             | unverified         |
| 17  | TWR convention              | unverified         |
| 18  | Yield on cost               | unverified         |
| 19  | Cash                        | unverified         |
| 20  | Price and FX lookup         | unverified         |
| 21  | Transfers between accounts  | unverified         |
| 22  | Spreadsheet import          | unverified         |
| 23  | Splits: post-split units    | unverified         |
| 24  | Net invested                | unverified         |
| 25  | Staleness, missing prices   | unverified         |
| 26  | Listing currency and FX     | unverified         |
| 27  | Daily snapshot conventions  | unverified         |
| 28  | Value now (intraday)        | unverified         |
| 29  | Day change                  | unverified         |
| 30  | Period returns (XIRR, TWR)  | unverified         |
| 31  | Monthly and yearly returns  | unverified         |
| 32  | Top positions and movers    | unverified         |
| 33  | Closed positions            | unverified         |
| 34  | Units that can be sold      | unverified         |
| 35  | Positions and brokers       | unverified         |
| 36  | Position price chart        | unverified         |
| 37  | App-entered rows            | unverified         |
| 38  | Default broker              | unverified         |
| 39  | Certificado factor entry    | unverified         |
| 40  | Asset scope (certificados)  | unverified         |

"Out of scope (tax)" means: **out of scope: tax reports will come from importing broker
report exports, not from this ledger.** These items describe how the performance numbers
are computed; nothing here should be used for a tax return.

## Lots and gains

### 1. FIFO lots per account

Changed 2026-10-23 (decision D2; until then lots were pooled across accounts). FIFO lot
matching is per **(account, asset)**: a sale consumes the oldest open lots of that asset
**in its own account** (broker), and selling more than that account holds is an error
(`InsufficientHoldingsError` with the account id), even when another account holds enough.
A transfer moves lots between accounts (#21). The resulting realized gain is a performance
metric, not a tax figure.

Each holding is one row per asset with an exact split by account: each account's units,
lots, cost basis, value (its units at the holding's unit value; certificados by lot) and
unrealized gain. The accounts add up exactly to the holding (the last account takes the
remainder of the value), so portfolio realized and unrealized gains equal the sum over
accounts by construction. Allocation by account uses these values.

Before the switch, a one-off comparison of the two rules on the live ledger (2026-10-23:
137 rows, 13 disposals) found no change: the same realized gain for every disposal and the
same open cost for every asset, so no stored snapshot needed recomputing. Pooled matching
and the comparison command were then removed.

- Status: out of scope: tax reports will come from importing broker report exports, not
  from this ledger.
- Implemented in: `fifo.ts` (`runFifo`), `holdings.ts` (`computeHoldings`,
  `HoldingAccount`), `allocation.ts` (`allocation`, account dimension), `accounts.ts`
  (`accountSummaries`).

### 2. Same-day ordering

The schema has no time of day. Within one date, acquisitions are processed before other
rows, and disposals last, so a same-day buy and sell works whatever order the rows arrive
in. Otherwise input order is kept.

Month-level dates (imported rows, all on the 1st) rely on input order: the caller must pass
rows of one date in their original order (for imports, file order, kept through an
explicitly increasing `created_at`). Moving acquisitions first does not change which lots
a disposal consumes, as long as no disposal in that order exceeds the units held.

Lots are per account (#1), so file order matters only among the rows of one account; rows
of other brokers in the same month do not affect which lots a sale consumes.

- Status: unverified
- Implemented in: `ledger.ts` (`prepareLedger`, `phase`); tests `fifo.test.ts` ("within one
  date, lots are consumed in input (file) order", "same-month rows of two brokers").

### 3. Fees in cost and proceeds

Fees on buys/subscriptions are added to the cost; fees on sells/redemptions are deducted
from the proceeds. Standalone `fee` rows (custody etc.) and transfer fees are never added
to a cost basis; they are counted as other costs in total gain. Changed 2026-10-23: fees on
deposits and withdrawals are no longer other costs (those rows change no figure, #19).

- Status: out of scope: tax reports will come from importing broker report exports, not
  from this ledger.
- Implemented in: `ledger.ts` (`acquisitionCostEur`, `disposalProceedsEur`), `gains.ts`
  (`gainsSummary`, `rowOtherCostEur`), `fees.ts` (`feeSummary`, a fee report that still
  lists deposit and withdrawal fees).

### 4. FX conversion of gains

Cost is converted to EUR at the acquisition's own rate (`fx_rate_to_eur` on the row) and
proceeds at the disposal's own rate, so currency movements are part of the gain. Market
value uses the latest rate on or before the valuation date.

- Status: out of scope: tax reports will come from importing broker report exports, not
  from this ledger.
- Implemented in: `ledger.ts` (`toEur`), `fifo.ts` (`runFifo`), `holdings.ts`
  (`computeHoldings`).

### 5. Dividend and interest amounts

On dividend and interest rows, `amount` is gross. The optional `withholding_tax` is the tax
withheld at source as shown on the statement (recorded, never computed), and `fees` are
charges. Cash received = amount − withholding_tax − fees. Withholding is not counted as a
fee (it is excluded from fee totals and fee drag). Yield on cost uses gross income.

Added 2026-10-23 (decision D6): rows entered in the app record **the net amount received**
as `amount`, with no withholding and no fee, in EUR at fx 1 (every app row is EUR at fx 1,
D7). For them gross = net. The withholding column stays for rows that have it.

- Status: unverified
- Implemented in: `types.ts` (`Transaction.withholdingTax`), `ledger.ts`
  (`validateTransaction`, `withholdingTaxEur`, `cashEffectEur`), `income.ts`
  (`incomeTotals`), `gains.ts` (`gainsSummary`), `cashflows.ts` (`investmentCashFlows`);
  column in `supabase/migrations/20261021000001_withholding_tax_and_optional_cash.sql`.

### 6. Certificado redemption gain

Redeeming certificados produces a realized gain (proceeds − subscription cost) like a
sale, marked with `type: 'redemption'` on the disposal. Economically that gain is accrued
interest, already taxed at source.

- Status: out of scope: tax reports will come from importing broker report exports, not
  from this ledger.
- Implemented in: `fifo.ts` (`Disposal.type`), `gains.ts` (`realizedEur`).

### 7. No tax calculation

No tax is calculated: no capital-gains rate, no aggregation (englobamento), no crypto
holding-period exemption, no loss carry-forward. None will be added.

- Status: out of scope: tax reports will come from importing broker report exports, not
  from this ledger.
- Implemented in: n/a.

## Certificados de aforro

By default a certificado is valued by official factors (#14). #8–#13 describe the
**optional** rule-based accrual model, used only when a caller opts in (`CaContext.accrual`).

### 8. Capitalisation periods

Interest is credited every `capitalisation_months` (3), with periods counted from the
subscription date and the day clamped to month end (30 Nov → 29 Feb → 30 May). Nothing
accrues for a period that has not completed.

- Status: unverified
- Implemented in: `certificados.ts` (`createRuleBasedCaValuer`), `dates.ts` (`addMonths`).

### 9. Reference rate

Each period's rate is fixed at the start of the period from the reference rate supplied by
the caller (`ReferenceRateLookup`). The core does not compute the Euribor average itself.

- Status: unverified
- Implemented in: `certificados.ts` (`ReferenceRateLookup`, `createRuleBasedCaValuer`).

### 10. Rate formula

Gross annual rate = clamp(reference + base_spread, rate_floor, rate_cap) + loyalty
premium. The premium is added on top of the cap. Overlapping premium ranges add up.
Holding years are 12-month blocks from the subscription (year 1 = months 1–12). The rule
is replaceable (`rateRule` option).

- Status: unverified
- Implemented in: `certificados.ts` (`defaultCaRateRule`, `CaRateRule`).

### 11. Withholding at capitalisation

At each capitalisation, gross interest = value × rate × months/12; `withholding_tax_rate`
(default 28%) is deducted then, and only the net is added to the value.

- Status: unverified
- Implemented in: `certificados.ts` (`createRuleBasedCaValuer`).

### 12. Rounding

No rounding between periods (full decimal precision). Official unit values are probably
rounded to a fixed number of decimals at each capitalisation.

- Status: unverified
- Implemented in: `certificados.ts` (`createRuleBasedCaValuer`).

### 13. Term and minimum holding

Accrual stops after `term_months`. `min_holding_months` does not affect the value.

- Status: unverified
- Implemented in: `certificados.ts` (`createRuleBasedCaValuer`).

### 14. Factors (default valuation)

Changed 2026-10-21: replaces the manual value. A factor (`ca_factors`) is the official
value of **one unit** of a subscription, in EUR, net (as AforroNet shows it), in force from
its `month` (stored as the 1st) on. Value of a subscription on a date = units still held ×
its latest factor whose month is on or before that date. Every monthly factor is its own
row, one per (subscription, month), never updated.

Before a subscription's first factor, a unit is worth what was paid for it at subscription
(unit price × fx, normally 1). A factor may be dated earlier in the subscription's own
month (month-level dates), never before that month.

With the optional accrual model on, the latest factor is the starting point: it includes
every capitalisation on or before its month, and later periods accrue from it by the rules
(#8–#13). A series without rules (`term_months` null) is still valued by factors.

- Status: unverified
- Implemented in: `certificados.ts` (`CaFactor`, `CaContext`, `createRuleBasedCaValuer`
  anchor, `certificadoSubscriptions`), `lookups.ts` (`createCaFactorLookup`), `holdings.ts`
  (`certificadoValuer`);
  `supabase/migrations/20261021000004_ca_factors.sql`.

### 15. Test parameters

The series parameters in the tests (Euribor + 1%, cap 3.5%, premiums 0.5% / 1%, 28%) are
illustrative, shaped like a Série E, not official values. Real values belong in
`ca_series` rows.

- Status: unverified
- Implemented in: `certificados.test.ts`.

## Returns and reporting conventions

### 16. XIRR

Actual/365 day count, as Excel's XIRR. Any span of at least 1 day is accepted (`minDays`
raises the minimum). Returns a reason instead of a rate when none exists.

- Status: unverified
- Implemented in: `xirr.ts` (`xirr`), `cashflows.ts`.

### 17. TWR

External flows happen at the end of their day (they earn nothing that day). Annualised only
when the series spans at least 365 days.

Changed 2026-10-23: a step that starts from zero value with a positive flow (the first buy,
or re-entry after selling everything) takes that day's flow at the start of the day:
r = V ÷ F − 1 (until then it threw unless the value equalled the flow, which month-level
imported buys almost never do). A step from zero that ends at zero is skipped. With cash not
tracked (#19), the flows are the ledger's buys, sells, income and fee rows (`dailyFlows`).

- Status: unverified
- Implemented in: `twr.ts` (`twr`), `cashflows.ts` (`flowEur`, `dailyFlows`).

### 18. Yield on cost

Per calendar year: gross income ÷ the time-weighted average of the end-of-day open cost
basis over the year (1 January to 31 December, or to the as-of date for the current year).
Portfolio-level figures include cash interest.

- Status: unverified
- Implemented in: `income.ts` (`incomeByYear`).

### 19. Cash

Changed 2026-10-23 (decision D5): **cash is not tracked.** Deposit and withdrawal rows stay
in the schema but are not offered in the app, and they change no figure, their fees
included: not total gain, net invested, day change, XIRR, TWR or snapshots. Net
contributions, XIRR and TWR are built from buys and sells (`docs/kpis.md` §0.1).
`buildSnapshot` includes cash only when a caller passes `trackCash: true` (default false;
until then the default was "whenever a deposit is recorded"); the daily jobs pass false.
When it is on, `cash_eur` is in EUR at each row's trade-time rate and foreign cash is not
revalued.

- Status: unverified
- Implemented in: `gains.ts` (`gainsSummary`, `rowOtherCostEur`), `cashflows.ts`
  (`investmentCashFlows`, `flowEur`), `snapshot.ts` (`buildSnapshot`), `ledger.ts`
  (`cashBalanceEur`, `cashEffectEur`); nullable column in
  `supabase/migrations/20261021000001_withholding_tax_and_optional_cash.sql`.

### 20. Price and FX lookup

Prices and FX rates use the latest value on or before the date, with no age limit. Changed
2026-10-22: the value is still used however old it is, but snapshots flag it (#25).

- Status: unverified
- Implemented in: `lookups.ts` (`createPriceLookup`, `createFxLookup`).

### 21. Transfers between accounts

Added 2026-10-21. A `transfer` row moves `quantity` units of an asset from `account_id` to
`transfer_to_account_id`. It is not a sale: no proceeds, no gain, and the total cost basis
is unchanged. Changed 2026-10-23 (lots per account, #1): it moves the sender's **oldest
lots**, with their acquisition date and remaining cost, to the receiving account, where
they queue by acquisition date (after lots of the same date already there). A partly moved
lot is split: the moved part takes the cost pro rata and gets the id
`<lot id>:<transfer id>`, the part left keeps the rest (by subtraction, so the parts sum
exactly); both keep `originTransactionId`, which CA redemptions match on. A transfer may not
move more units than the sending account holds at that point. Within a day, transfers come
after acquisitions and before disposals (#2).

`fees` on a transfer is a cash fee in `currency`: it reduces cash, counts as an other cost
in total return and as an outflow in investment cash flows, and is reported as its own fee
category. It is never added to the cost basis. Fees paid in units of the asset (e.g. a
crypto network fee) are not modelled: if you record the units received, the lost units
stay counted in the sending account's lots. Only asset transfers exist;
cash moved between brokers is not a transfer row.

- Status: unverified
- Implemented in: `types.ts` (`Transaction.transferToAccountId`), `ledger.ts`
  (`validateTransaction`, `phase`, `cashEffectEur`), `fifo.ts` (`runFifo`, `moveLots`),
  `fees.ts` (`feeSummary`, `transferEur`), `gains.ts` (`otherCostsEur`), `cashflows.ts`
  (`investmentCashFlows`); `supabase/migrations/20261021000002_transfer_type.sql` and
  `20261021000003_transfer_columns.sql`.

## Import

### 22. Spreadsheet import

Added 2026-10-21. How `scripts/import` turns the Excel tables into ledger rows (steps in
`docs/import.md`):

- **Dates** are month-level: stored as the 1st with `trade_date_precision = 'month'`; a cell
  with another day is mapped to the 1st (with a warning). Within a date, rows keep the
  file's order through an explicitly increasing `created_at` (#2).
- **Listing currency** (changed 2026-10-22): the mapping's `currency` is the asset's listing
  currency (`assets.trading_currency`): USD for XNAS/XNYS/XASE, EUR for XETR, crypto and
  certificados; a value that does not match the exchange is rejected. Orders stay EUR at
  fx 1 (#26).
- **Amounts**: `quantity` = |Units| (sells are negative in the Excel, the sign must match
  Transact Type), `unit_price` = Order Price, currency EUR at `fx_rate_to_eur` 1, fees 0.
  Order Value is a check only: |Order Value − Units × Order Price| may not exceed half a
  unit of Order Value's last written decimal plus |Units| × half a unit of Order Price's
  (Units are taken as exact).
- **Holdings check**: a sell may not exceed what its broker's account holds at that point
  (earlier months, then file order). Since 2026-10-23 this is the same rule FIFO applies
  (lots per account, #1).
- **Precision**: imported rows have `trade_date_precision = 'month'`; core reads it as
  `Transaction.tradeDatePrecision` to mark months as approximate (#31).
- **Accounts**: one per broker (Degiro, IBKR, Kraken, Aforro), reused by name.
- **Certificados**: CA rows are grouped by (series, month) into one subscription at 1 EUR
  per unit; the CA table's Units must equal the group total, and its Ratio is stored as the
  subscription's factor for `--ratio-month` (#14). CA sells are not imported yet.
- **Idempotency**: `import_row_hash` = sha256 of month, transact type, ticker, units,
  price, value and broker (numbers canonical, text case-normalized; the Type column is
  left out because the mapping file resolves it) plus the occurrence among identical rows.
  A CA subscription's hash is its (series, month). Identical rows are rejected unless
  their key is listed in `allowed-duplicates.txt`. Empty rows are skipped.

- Status: unverified
- Implemented in: `scripts/import/src/plan.ts` (`planImport`), `hash.ts`, `inputs.ts`,
  `numbers.ts`, `dates.ts`; `supabase/migrations/20261021000005_import_bookkeeping.sql` and
  `20261021000006_import_functions.sql`.

## Prices and snapshots

Added 2026-10-22 with the daily price, FX and snapshot jobs (`packages/market`,
`scripts/prices`, `supabase/functions`; runbook in `docs/prices.md`).

### 23. Splits: the ledger records post-split units

Stock splits are not ledger rows. The ledger's units and unit prices are expressed in
today's share count (the spreadsheet restated pre-split purchases). `prices.close` is the
raw close as quoted that day, and `prices.split_factor` holds the provider's ratio on a
split's effective date (20 for 20:1, 0.01 for 1:100). Before valuing, each close is divided
by the product of the asset's split factors dated after it, so every close is in today's
share count; the split day's own close is already post-split. Closes are never adjusted for
dividends (dividends belong in the ledger). A split that happens after the import needs the
asset's earlier rows restated (or a future split row type); the daily run reports it.

- Status: unverified
- Implemented in: `prices.ts` (`splitAdjustPrices`); `market/src/providers/tiingo.ts`
  (split factors); `supabase/migrations/20261022000002_prices_snapshot_flags_job_runs.sql`.

### 24. Net invested

A snapshot's `net_contributions_eur` is **net invested**: what buys and subscriptions cost
(fees in) minus what sells and redemptions returned (fees out), in EUR at each row's
trade-time rate, up to and including the date. Deposits, withdrawals, income, fee rows and
transfers are not counted; deposits are not tracked. `netContributions` (deposits −
withdrawals) is unchanged and still used by the cash and total-return formulas.

- Status: unverified
- Implemented in: `gains.ts` (`netInvestedEur`), `snapshot.ts` (`buildSnapshot`).

### 25. Staleness and missing prices

A close is **stale** when it is more than 3 calendar days older than the valuation date
(configurable, `LEDGR_STALE_AFTER_DAYS`); a Friday close on Monday (3 days) is not stale.
A stale close is still used. When an asset has no close at all on or before the date (no
symbol, or history starting after the first buy), it is valued at its latest trade's unit
price × that row's fx rate (in ledger order within a day) and always flagged stale, source
`trade`. A missing FX rate is not filled in: that day's snapshot is skipped and reported.

Certificados: value from the latest factor (#14), aged from the factor's month (its 1st);
before the first factor, from the subscription price, aged from the subscription date. The
CA value is flagged when that age exceeds 35 days (`LEDGR_CA_MAX_AGE_DAYS`). With several
subscriptions, the oldest date counts, and the source is `factor`, `subscription` or
`mixed`.

- Status: unverified
- Implemented in: `prices.ts` (`ageInDays`, `isStale`, `createTradePriceLookup`,
  `DEFAULT_STALE_AFTER_DAYS`, `DEFAULT_CA_MAX_AGE_DAYS`), `snapshot.ts` (`buildSnapshot`,
  `ValuationFlag`), `certificados.ts` (`certificadoSubscriptions`: per subscription, the
  same age and 35-day flag).

### 26. Listing currency and FX

`assets.trading_currency` is the listing currency, by exchange: USD for XNAS, XNYS and XASE,
EUR for XETR; crypto quoted in EUR (BTCEUR) is EUR. A provider's close is stored in that
currency (a close the provider states in another currency is refused). FX rates are the ECB
euro reference rates, stored as EUR per unit = 1 ÷ the ECB quote, rounded half-even to 18
decimals. On weekends and TARGET holidays the last published rate applies (#20). Rates are
fetched from 14 days before 2021-01-01 (or the first trade, if earlier).

- Status: unverified
- Implemented in: `prices.ts` (`listingCurrencyForMic`, `rateToEurFromEcbQuote`);
  `market/src/ecb.ts`, `market/src/jobs/fx.ts`;
  `supabase/migrations/20261022000001_listing_currency.sql`.

### 27. Daily snapshot conventions

One snapshot per calendar day, weekends included, from the first trade date. A day's
snapshot uses the ledger up to and including that day and the latest close and rate on or
before it: US and Xetra closes of that trading day, and Coinbase's UTC daily candle (close
at 24:00 UTC). Month-level imported trades count from the 1st of their month. Cash is not
tracked (`trackCash: false`), so the total is the investments alone. Prices are fetched only
for the days an asset was held (from 14 days before each holding period, so a close exists
on day one, to the day it was sold). The daily run recomputes from the 1st of the previous
month to yesterday, so a factor entered late is picked up. Rows are written rounded
half-even to 18 decimals; identical inputs give identical rows.

- Status: unverified
- Implemented in: `snapshot.ts` (`buildSnapshot`), `prices.ts` (`holdingPeriods`,
  `priceFetchRange`, `PRICE_LOOKBACK_DAYS`); `market/src/jobs/snapshots.ts`,
  `market/src/jobs/prices.ts`, `market/src/db.ts` (`snapshotRow`).

### 28. Value now (intraday)

The dashboard's current value uses the same rules as a daily snapshot (#23–#27) on the
owner's local date (`Europe/Lisbon` by default), with the latest intraday quote of each
held asset added to its daily closes: a quote counts for a trading day that has no daily
close yet (the official close wins once fetched), and is used when it is the newest price;
the trading day is the exchange's (New York for
US listings, UTC for Coinbase, the provider's stated day for Xetra). A quote in a currency
other than the listing currency is refused. FX is the latest ECB reference rate (no
intraday FX). Quotes are cached per asset and refreshed at most every 5 minutes (Coinbase),
15 minutes (Tiingo) or 3 hours (Alpha Vantage), only during regular trading hours plus 30
minutes (holidays count as trading days), and once after the close to get the final price.
Value now is never written to `portfolio_snapshots`.

- Status: unverified
- Implemented in: `prices.ts` (`withLiveQuotes`); `market/src/live.ts` (`needsRefresh`,
  `runValueNow`), `market/src/value-now.ts`, providers' `fetchLatest`;
  `supabase/migrations/20261022000003_live_quotes.sql`.

## App KPIs

Added 2026-10-23 with slice 5a-core (definitions in `docs/kpis.md`). T is the owner's local
date, Y = T − 1 day. All figures are EUR, Decimal; none involves cash (#19).

### 29. Day change

D = V(T) − V(Y) − F(T): both ends valued with the same price lookup (closes plus intraday
quotes, #28), today's rows only in F(T), flows at the end of the day. A buy today counts
only for the difference between today's price and the price paid; a dividend today counts
as change; % = D ÷ V(Y), none when V(Y) = 0. Per asset the same with that asset's rows; a
position held today and not yesterday is "opened today" and has no %. Rows without an
asset (interest, fee rows) count in the portfolio's F(T) only. A holding without a value on
either day is an error, never a zero.

- Status: unverified
- Implemented in: `daychange.ts` (`dayChange`), `cashflows.ts` (`flowEur`).

### 30. Period returns (XIRR and TWR)

Since start, YTD and 1Y, all ending on T. S = the day before the first row, 31 December of
the previous year, `addMonths(T, −12)`. V(S) is the snapshot of day S (0 when S is before
the first row, `fromStart`); a missing snapshot gives the reason `snapshot-missing`
instead of a rate. XIRR: −V(S) on S, −F on each day in (S, T], +V(T) on T. TWR: (S, V(S)),
every snapshot day in (S, T) with the flows since the previous point, and (T, V(T)). Both
are annualized only for 365 days or more, counted from the first flow (or S when V(S) > 0);
XIRR then shows its period rate (1 + r)^(days/365) − 1. Since start, XIRR equals
`xirr(investmentCashFlows(...))` exactly.

- Status: unverified
- Implemented in: `returns.ts` (`periodReturns`, `periodStart`, `valueSeries`).

### 31. Monthly and yearly returns

Each calendar month (year) runs over (end of the previous one, its last day], the current
one to T. Return = TWR over it (#30's points); contributions = NI(end) − NI(start); market
gain = V(end) − V(start) − contributions; income = net income dated in it. A missing
boundary snapshot leaves the return and market gain empty with `snapshot-missing`. Because
both use the same daily points, a year's return is the product of its months'. A period
with month-level rows (#22) is `approximate`. Best / worst month: completed months only,
ties to the earlier month.

- Status: unverified
- Implemented in: `returns.ts` (`monthlyReturns`, `yearlyReturns`, `bestWorstMonth`).

### 32. Top positions and movers

Top positions: open positions by value, largest first, ties by asset id. Top movers
(decision D4): ranked by € impact (day change D_a, or unrealized gain U_a for "total"),
with the % beside it; 3 positive and 3 negative, zero left out; ties to the larger
position, then the asset id. Ranking by % is the same function with another key and leaves
out positions without a % (opened today, or with no cost).

- Status: unverified
- Implemented in: `movers.ts` (`topPositions`, `topMovers`).

### 33. Closed positions

An asset with no open lots on the date and at least one disposal. Figures: units bought and
sold, FIFO cost of the units sold, proceeds net of fees, realized gain and its % of the
cost, net dividends booked on the asset, first buy, last sale, and per account the units
sold, cost, proceeds and gain. An asset sold out and bought again is not listed: its
realized gains stay with the open position. Performance, not tax.

- Status: unverified
- Implemented in: `closed.ts` (`closedPositions`).

### 34. Units that can be sold

`unitsHeld` = the account's units at the end of the date. `maxDisposable` = the most a new
sale in that account dated D may sell: it is processed after D's other rows, so the limit is
the smallest balance of that account from the end of D to the end of the ledger (holding 10
on 1 March and selling 6 on 1 May, a sale on 1 April may sell at most 4). It counts units
only: a CA redemption linked to a subscription also needs that subscription's lot, so the
final check is `runFifo` over the ledger with the new row.

- Status: unverified
- Implemented in: `validation.ts` (`unitsHeld`, `maxDisposable`).

### 35. Positions and brokers

A position is one asset over all accounts: units, cost basis (open lots), average cost =
cost ÷ units, value, weight = value ÷ V(T), unrealized € and %, realized (every disposal of
the asset, all accounts), income (dividends booked on it) and day change D_a (#29). Its
split by broker has one line per account holding units or with a disposal of it; units,
cost, value, unrealized and realized add up exactly to the position. A broker's rows are
its own units of each position (no day change: it is per asset). A broker's figures are
#1's per-account sums, and the brokers add up exactly, field by field, to the portfolio's
value, cost, R, U, I, C and G; the app shows the brokers' total next to the cards and a
warning if it ever differs. A certificado row shows its units, value and factor (the same
for every held subscription, else per subscription in the detail) with the oldest factor
month. Stale and "price pending" badges come from the snapshot valuation flags (#25).

- Status: unverified
- Implemented in: `positions.ts` (`positionDetail`, `assetTransactions`), `views.ts`
  (`buildPositions`).

### 36. Position price chart

One asset's closes from its whole stored history, split-adjusted (#23), in its listing
currency (rows in another currency are left out), with today's quote when today has no
close (#28). A range starts at the latest close on or before its first day (1M, 3M, YTD,
1Y as in #30's chart ranges; All at the first close), and the change shown is last close −
first close and its %. Long ranges are thinned for drawing only.

- Status: unverified
- Implemented in: `positions.ts` (`priceSeries`), `returns.ts` (`rangeStart`), `series.ts`
  (`thinSeries`).

### 37. App-entered rows

The New transaction form (slice 5c) writes buy, sell, dividend and interest rows only (D5,
D7), in EUR at fx 1 with day precision, under a client-generated UUID (a retried save
finds its own row instead of adding a second). Buy / sell: quantity and **total value**,
the EUR amount the broker charged or paid for the units **before the fee**; the fee
(optional, ≥ 0) is a separate field, added to the cost or deducted from the proceeds (#3).
The stored unit price is total ÷ quantity rounded half-even to 18 decimals, so quantity ×
unit price can differ from the typed total in the 18th decimal (never at cents). Dividend /
interest: the net amount received, no withholding and no fee (D6); interest has no asset.
Typed numbers take one `,` or `.` as the decimal point; thousands separators, exponents,
more than 18 decimals and more than 20 integer digits are refused. Refused: a type the
form does not offer, a missing, unknown or deleted asset or broker, a certificado, an
invalid or future date (Europe/Lisbon), a quantity, total or amount that is not above 0
(or so small that the unit price rounds to 0), a negative fee, a fee on income, and a sale
above `maxDisposable` (#34) in its broker. The final check is `runFifo` over the whole
ledger with the row, which also refuses an edit or a delete that would leave a later sale
or transfer without units, naming that row. Only rows the form can show exactly are
editable (form types in EUR at fx 1, no withholding, income without a fee); the type of a
saved row never changes; saving an unchanged trade keeps its stored unit price; an
imported month-level date stays month-level unless the date is changed. Deletes are soft
(`deleted_at`).

- Status: unverified
- Implemented in: `input.ts` (`parseDecimalInput`, `unitPriceFromTotal`), `validation.ts`
  (`validateNewTransaction`, `validateLedgerChange`, `editableInApp`, `formFromTransaction`,
  `previewTransaction`), `assetInput.ts` (`validateNewAsset`: ISIN check digit, the
  supported exchanges and their listing currency, #26).

### 38. Default broker

For a sale: the broker with the most units of the asset on the date (`sellableAccounts`,
which lists only brokers holding units then, with what each can sell). Otherwise: the
broker of the most rows of that type dated in the 12 months to today (after
`addMonths(today, −12)`), all time when there are none, all types when there are none of
that type; ties go to the most recent row in ledger order. Deleted brokers are never
proposed. Changing it in the form is always possible.

- Status: unverified
- Implemented in: `validation.ts` (`mostUsedAccount`, `sellableAccounts`).

### 39. Certificado factor entry

The factor update screen lists the subscriptions held today. For the chosen month (the
current month by default, earlier months allowed, never a later one) each gets one input,
shown with the latest factor of an earlier month; the change is next − previous per unit,
units × that in EUR, and next ÷ previous − 1 in %. A decrease is a warning, not a block.
A month already recorded is read-only (#14: rows are never changed); a retried save that
finds the same factor stored counts as saved. Values are labeled "from factor".

- Status: unverified
- Implemented in: `certificados.ts` (`factorChange`, `factorUpdateLines`).

### 40. Asset scope: with or without certificados

The app's "Include certificados de aforro" setting (on by default, kept on the device)
applies to every figure, chart and list except the Certificados screen, the factor update
and New transaction. When it is off, figures are those of the portfolio **without**
certificados, recomputed from its own inputs, never by subtracting certificados from a
total:

- A ledger row is left out when its asset is a certificado; rows without an asset (cash
  interest, fee rows, deposits, withdrawals) and rows of an unknown asset stay. FIFO,
  holdings, V(T), V(Y), flows, net invested, realized, income, costs, XIRR, TWR, monthly
  and yearly returns, allocation, top movers, brokers, closed positions and the Activity
  list all run on the rows that stay.
- V(d) of a past day is the sum of the snapshot's per-type values of the types in scope
  (valuation is per asset, so that is exactly the value of the assets in scope); net
  invested NI(d) comes from the rows in scope (the snapshot stores it as a total only).
  Days before the first row in scope are left out. Each stored column is rounded to 18
  decimals on its own, so a sum can differ from a recomputed total in the 18th decimal.
- Allocation weights are shares of the value in scope (they sum to 100%). A broker is
  listed when it has open lots, or any realized gain, income or cost, among the rows in
  scope, so the brokers still add up to the totals; a broker holding only certificados is
  not listed. The certificado factor indicator is not shown.
- value-now returns whole-portfolio totals, so the app compares its figures with them only
  when everything is included; the identities V − NI = R + U and Σ brokers = totals are
  checked in both modes.
- With the setting on, every figure is the same as before the setting existed: the stored
  totals are used unchanged.

- Status: unverified
- Implemented in: `scope.ts` (`assetScope`, `scopeTransactions`, `scopeHoldings`,
  `scopeSnapshots`), the `scope` option of `computeHoldings`, `buildSnapshot`,
  `gainsSummary`, `netInvestedEur`, `dailyFlows`, `investmentCashFlows`, `dayChange`,
  `periodReturns`, `twrSteps`, `monthlyReturns`, `yearlyReturns`, `valueSeries`,
  `accountSummaries`, `allocation`, `concentration`, `topPositions`, `topMovers`,
  `closedPositions`, `transactionRows`, `assetTransactions`, `reconcile`, and
  `PortfolioInput.excludeTypes` in `views.ts`; `client/src/rows.ts` (`SNAPSHOT_COLUMNS`).
