# Calculation assumptions

Assumptions made by `packages/core`, approved as **provisional** on 2026-10-21 (#1–#20) and
2026-10-22 (#23–#27, prices and snapshots). Each one
stays `unverified` until it has been checked against an official source (or the owner's
own records), and is then updated here with the source.

Tax reporting is not a goal of this ledger. Tax reports will come from importing broker
report exports. In particular, **realized gains from FIFO are a performance metric, not a
tax figure.**

Paths are relative to `packages/core/src/` unless stated.

| #   | Topic                       | Status             |
| --- | --------------------------- | ------------------ |
| 1   | FIFO lot pooling            | out of scope (tax) |
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

"Out of scope (tax)" means: **out of scope: tax reports will come from importing broker
report exports, not from this ledger.** These items describe how the performance numbers
are computed; nothing here should be used for a tax return.

## Lots and gains

### 1. FIFO lot pooling

FIFO lot matching is per asset, **pooled across all accounts and brokers**: a sale in any
account consumes the oldest open lot of that asset, wherever it was bought. Selling more
than the total held across all accounts is an error. The resulting realized gain is a
performance metric, not a tax figure.

Because cost basis is pooled, it exists per asset only. Each holding also lists the units
per account (that account's acquisitions minus its disposals, plus transfers in minus
transfers out; see #21) and the market value pro rata to those units; allocation by
account uses this split. An account that sells units it never received (an unrecorded
transfer) shows a negative quantity.

- Status: out of scope: tax reports will come from importing broker report exports, not
  from this ledger.
- Implemented in: `fifo.ts` (`runFifo`), `holdings.ts` (`computeHoldings`,
  `accountQuantities`), `allocation.ts` (`allocation`, account dimension).

### 2. Same-day ordering

The schema has no time of day. Within one date, acquisitions are processed before other
rows, and disposals last, so a same-day buy and sell works whatever order the rows arrive
in. Otherwise input order is kept.

Month-level dates (imported rows, all on the 1st) rely on input order: the caller must pass
rows of one date in their original order (for imports, file order, kept through an
explicitly increasing `created_at`). Moving acquisitions first does not change which lots
a disposal consumes, as long as no disposal in that order exceeds the units held.

- Status: unverified
- Implemented in: `ledger.ts` (`prepareLedger`, `phase`); test `fifo.test.ts` ("within one
  date, lots are consumed in input (file) order").

### 3. Fees in cost and proceeds

Fees on buys/subscriptions are added to the cost; fees on sells/redemptions are deducted
from the proceeds. Standalone `fee` rows (custody etc.) and fees on deposits/withdrawals
are never added to a cost basis; they are counted as other costs in total return.

- Status: out of scope: tax reports will come from importing broker report exports, not
  from this ledger.
- Implemented in: `ledger.ts` (`acquisitionCostEur`, `disposalProceedsEur`), `gains.ts`
  (`gainsSummary`, `otherCostsEur`), `fees.ts` (`feeSummary`).

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
  anchor), `lookups.ts` (`createCaFactorLookup`), `holdings.ts` (`certificadoValuer`);
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

- Status: unverified
- Implemented in: `twr.ts` (`twr`).

### 18. Yield on cost

Per calendar year: gross income ÷ the time-weighted average of the end-of-day open cost
basis over the year (1 January to 31 December, or to the as-of date for the current year).
Portfolio-level figures include cash interest.

- Status: unverified
- Implemented in: `income.ts` (`incomeByYear`).

### 19. Cash

Cash is tracked only when the ledger records at least one deposit (overridable with
`trackCash`). When it is not tracked, `cash_eur` is null and `total_value_eur` is the
positions alone. When tracked, cash is in EUR at each row's trade-time rate; foreign cash
is not revalued.

- Status: unverified
- Implemented in: `ledger.ts` (`hasDeposits`, `cashBalanceEur`, `cashEffectEur`),
  `snapshot.ts` (`buildSnapshot`); nullable column in
  `supabase/migrations/20261021000001_withholding_tax_and_optional_cash.sql`.

### 20. Price and FX lookup

Prices and FX rates use the latest value on or before the date, with no age limit. Changed
2026-10-22: the value is still used however old it is, but snapshots flag it (#25).

- Status: unverified
- Implemented in: `lookups.ts` (`createPriceLookup`, `createFxLookup`).

### 21. Transfers between accounts

Added 2026-10-21. A `transfer` row moves `quantity` units of an asset from `account_id` to
`transfer_to_account_id`. It is not a sale: no proceeds, no gain, and lots and cost basis
are unchanged (lots are pooled, #1). It only changes the per-account split. A transfer may
not move more units than the sending account holds at that point (sales are still checked
against the pooled total only). Within a day, transfers come after acquisitions and before
disposals (#2).

`fees` on a transfer is a cash fee in `currency`: it reduces cash, counts as an other cost
in total return and as an outflow in investment cash flows, and is reported as its own fee
category. It is never added to the cost basis. Fees paid in units of the asset (e.g. a
crypto network fee) are not modelled: if you record the units received, the lost units
stay counted in the sending account and in the pooled total. Only asset transfers exist;
cash moved between brokers is not a transfer row.

- Status: unverified
- Implemented in: `types.ts` (`Transaction.transferToAccountId`), `ledger.ts`
  (`validateTransaction`, `phase`, `cashEffectEur`), `holdings.ts` (`accountQuantities`),
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
  (earlier months, then file order). This is validation only; FIFO stays pooled (#1).
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
  `ValuationFlag`).

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
