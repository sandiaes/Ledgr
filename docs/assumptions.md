# Calculation assumptions

Assumptions made by `packages/core`, approved as **provisional** on 2026-10-21 (#1–#20). Each one
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
| 14  | CA manual value             | unverified         |
| 15  | CA test parameters          | unverified         |
| 16  | XIRR convention             | unverified         |
| 17  | TWR convention              | unverified         |
| 18  | Yield on cost               | unverified         |
| 19  | Cash                        | unverified         |
| 20  | Price and FX lookup         | unverified         |
| 21  | Transfers between accounts  | unverified         |

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

- Status: unverified
- Implemented in: `ledger.ts` (`prepareLedger`, `phase`).

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

### 14. Manual value

`manual_value` is **what AforroNet shows, net** (after the withholding on every
capitalisation so far), in EUR, for the units still held on `manual_value_date`. It
includes every capitalisation on or before that date; later periods accrue from it by the
rules. Per-unit value = manual_value ÷ units held on that date. It is ignored when valuing
dates before it.

- Status: unverified
- Implemented in: `certificados.ts` (`CaSubscription`, `createRuleBasedCaValuer`),
  `holdings.ts` (`certificadoValuer`); column comment in
  `supabase/migrations/20261021000001_withholding_tax_and_optional_cash.sql`.

### 15. Test parameters

The series parameters in the tests (Euribor + 1%, cap 3.5%, premiums 0.5% / 1%, 28%) are
illustrative, shaped like a Série E, not official values. Real values belong in
`ca_series` rows.

- Status: unverified
- Implemented in: `certificados.test.ts`, `snapshot.test.ts`.

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

Prices and FX rates use the latest value on or before the date, with no age limit.

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
