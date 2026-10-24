# KPI definitions (mobile and desktop apps)

Exact definitions of every number the apps show. Status: **approved** 2026-10-23 with
decisions D1–D7 (`docs/app-plan.md` §9); each definition becomes an entry in
`docs/assumptions.md` when its slice is built (#29–#34 for slice 5a-core). Each KPI is
computed by a `packages/core` function (§10 below, planned in `docs/app-plan.md` §3); the
apps only format and display the result. All amounts are EUR,
`Decimal` end to end. JS numbers appear only at the chart boundary (pixel positions).

These are **performance** figures. Realized gains are not tax figures (assumptions #1, #7).

## 0. Notation and shared rules

- **T** = today, the owner's local date in `Europe/Lisbon` (same rule as value-now, #28).
  **Y** = T − 1 day.
- **Ledger** = `transactions` rows with `deleted_at is null`, in `prepareLedger` order
  (trade date, then acquisitions / other / disposals, then `created_at`, `id`; #2).
  _L(d)_ = the rows dated on or before _d_.
- **Value** _V(d)_ = market value of the open positions at the end of day _d_, by the
  snapshot rules (#23–#27): units × split-adjusted close (latest on or before _d_) ×
  ECB rate (latest on or before _d_); certificados by factor (#14); no close at all → last
  trade price, flagged stale (#25). **Cash is never included** (`trackCash: false`, as in the
  daily jobs, #27). _V(T)_ additionally uses the intraday quotes (value-now rules, #28).
  _V(d)_ for a past day is read from `portfolio_snapshots.total_value_eur`; _V(Y)_ and
  _V(T)_ are computed in the app with core (see §2).
- **Flow** _F(d)_: net money that went **into the positions** on day _d_, the negative of
  the investor cash flows of `investmentCashFlows` (`cashflows.ts`), per row dated _d_:

  | Row type            | Contribution to _F(d)_                    |
  | ------------------- | ----------------------------------------- |
  | buy, subscription   | + (quantity × unit price + fees) × fx     |
  | sell, redemption    | − (quantity × unit price − fees) × fx     |
  | dividend, interest  | − (amount − withholding tax − fees) × fx  |
  | fee                 | + (amount + fees) × fx                    |
  | transfer            | + fees × fx (units stay in the portfolio) |
  | deposit, withdrawal | 0 (cash is not tracked, §0.1)             |

  So income counts as return, fee rows count as a cost, and trades are neutral. Rows
  entered in the app are EUR at fx 1; dividends and interest are the **net amount
  received**, with no withholding field and no fee (decision D6), so for them the flow is
  − amount. Deposits and withdrawals change no figure, their fees included (D5).

- **Net invested** _NI(d)_ (#24): Σ over _L(d)_ of acquisition cost (fees in) minus
  disposal proceeds (fees out). Stored as `portfolio_snapshots.net_contributions_eur`.
  Income, fee rows, deposits, withdrawals and transfers are not in it.
- **Lots**: FIFO **per account** (decision D2, assumption #1). A sale consumes the oldest
  open lots _of its own account_, and selling more than that account holds is an error; a
  transfer moves the sender's oldest lots, with their dates and cost, to the receiving
  account. (Lots were pooled across accounts before 2026-10-23; a comparison on the live
  ledger found no figure that changed.)
- **Stale**: a close more than 3 days old, or a trade-price stand-in (#25); a certificado
  factor more than 35 days old, aged from its month's 1st (#25).
- **Display**: amounts rounded half-up to cents, percentages to 2 decimals, both with
  `Decimal.toFixed` (never floats). A division by zero shows "—", never 0.

## 0.1 Without cash tracking: built from buys and sells

Ledgr does not track cash (#19, #27): there is no broker cash balance, and deposit and
withdrawal rows (kept in the schema, not offered in the app) change no figure. The
boundary of the portfolio is therefore **the positions themselves**, and money crosses it
only through the ledger's trades and income:

- a **buy** (or subscription) is money put in: its cost, fees included;
- a **sell** (or redemption) is money taken out: its proceeds, fees deducted. The
  proceeds leave the portfolio, as if withdrawn the same day;
- a **dividend or interest** is money paid out to you: return, not a contribution;
- a **fee row** is money put in that buys nothing: a cost.

From that:

- **Net contributions** (net invested) _NI_ = Σ buy costs − Σ sell proceeds, to date. It
  goes down on every sale, and is negative if sales have returned more than was ever put
  in. It ignores income, so the gap _V_ − _NI_ is exactly the capital gain _R_ + _U_.
- **XIRR**: the cash flows are −cost on each buy's date, +proceeds on each sell's date,
  +amount on each dividend/interest date, −amount on each fee row's date, and +_V(T)_ today
  (`investmentCashFlows`). No deposit is needed for it to be defined.
- **TWR**: each day's flow _F(d)_ is the same set of rows with the opposite sign (buys +,
  sells −, income −, fee rows +), and the day's return is (_V(d)_ − _F(d)_) ÷ _V(d−1)_ − 1.
  A buy or sell therefore never shows up as a gain or loss in itself; only price moves,
  income and fees do.

Example (2025, one asset, no fees):

| Date   | Row                  | Close | Units | _V_   | _F_    | _NI_  |
| ------ | -------------------- | ----- | ----- | ----- | ------ | ----- |
| 1 Jan  | buy 10 @ 100 = 1,000 | 100   | 10    | 1,000 | +1,000 | 1,000 |
| 1 Jul  | buy 10 @ 120 = 1,200 | 120   | 20    | 2,400 | +1,200 | 2,200 |
| 31 Dec | sell 5 @ 110 = 550   | 110   | 15    | 1,650 | −550   | 1,650 |

- Gains: _R_ = 550 − 500 (the oldest 5 units, bought at 100) = 50; open cost =
  5 × 100 + 10 × 120 = 1,700, _U_ = 1,650 − 1,700 = −50. _R_ + _U_ = 0 = _V_ − _NI_.
- TWR: 1 Jan starts from zero, so the start-of-day rule gives 1,000 ÷ 1,000 − 1 = 0;
  1 Jul: (2,400 − 1,200) ÷ 1,000 − 1 = +20%; 31 Dec: (1,650 + 550) ÷ 2,400 − 1 = −8.33%.
  TWR = 1.2 × 11/12 − 1 = **+10%** (the asset's price went 100 → 110).
- XIRR: −1,000 on 1 Jan, −1,200 on 1 Jul, +550 and +1,650 on 31 Dec. They sum to zero, so
  XIRR = **0%**: more money was in the asset during the fall from 120 to 110 than during
  the rise from 100 to 120.
- Without the sale (_V_ = 2,200 on 31 Dec), _NI_ = 2,200 and both returns are the same:
  selling moves money out, it does not create a return.

## 0.2 Asset scope: with or without certificados (slice 5d, built 2026-10-24, #40)

The app has one setting, "Include certificados de aforro" (default on;
`docs/app-plan.md` §10). When it is off, **every** figure in this document is computed for
the portfolio _without_ certificados, by the same definitions applied to scoped inputs:

- **Ledger in scope** _L'_: the rows whose asset is not a certificado. Rows without an asset
  (cash interest, fee rows, deposits, withdrawals) stay in.
- **Holdings, _V(T)_, _V(Y)_**: FIFO and valuation over _L'_ (valuation is per asset, so
  this is the in-scope assets' value).
- **_V(d)_ of a past day**: the sum of that day's snapshot columns of the in-scope types,
  `stock_value_eur + etf_value_eur + crypto_value_eur` (a sum of what is in scope, never
  `total − certificados`). Days before the first row of _L'_ have no point (the portfolio
  in scope did not exist yet).
- **_F(d)_, _NI(d)_, _R_, _U_, _I_, _C_, _G_**: from _L'_. _NI(d)_ is computed from _L'_ (the
  snapshot stores net invested only as a total).
- **XIRR, TWR, monthly and yearly returns**: §3 and §5 with the scoped _V_ and _F_;
  "Since start" begins the day before the first row of _L'_. They are recomputed, never
  derived from the full figures (a rate cannot be split by subtraction).
- **Allocation weights** divide by the scoped _V(T)_, so they sum to 100%.
- **Brokers**: §8's rule on _L'_; a broker with nothing in scope (the certificados broker)
  is not listed, and the brokers still add up to the scoped totals.
- **Freshness**: no certificado factor indicator while certificados are out.
- Not affected: the Certificados screen, the factor update and New transaction (and its
  checks, which always use the whole ledger).

With the setting on, every figure is exactly what it was before the setting existed.

## 1. Totals

| KPI                     | Definition                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| **Total value**         | _V(T)_.                                                                                    |
| **Cost basis**          | Σ open lots' remaining cost (fees in, EUR at each acquisition's fx).                       |
| **Unrealized gain** _U_ | _V(T)_ − cost basis. % = _U_ ÷ cost basis.                                                 |
| **Realized gain** _R_   | Σ over all disposals in _L(T)_ of (proceeds net of fees − FIFO cost of the lots consumed). |
| **Net income** _I_      | Σ dividends and interest in _L(T)_: amount − withholding tax − fees.                       |
| **Other costs** _C_     | Σ fee rows (amount + fees) plus fees on transfers (deposits and withdrawals: none, D5).    |
| **Total gain** _G_      | _R_ + _U_ + _I_ − _C_ (core `gainsSummary().totalReturnEur`).                              |
| **Net contributions**   | _NI(T)_ (net invested). Labeled "Net invested" in the UI.                                  |

Identities (checked in core tests and at run time, §8):

- _V(T)_ − _NI(T)_ = _R_ + _U_ exactly (the gap in the value vs contributions chart is the
  capital gain).
- _G_ = _V(T)_ − Σ _F(d)_ over all days.
- Per account: Σ over accounts of _R_, _U_, cost basis and value equals the portfolio
  figure exactly; per-account _I_ and _C_ are the rows booked in that account.

Total gain = realized + unrealized + net income − costs (decision D1), so it agrees with
XIRR and TWR, which count dividends as return. The dashboard shows _G_ and, on separate
lines that add up to it, _R_, _U_ (€ and %), _I_ and −*C*.

## 2. Day change

- _V(Y)_ = the portfolio valued at the end of yesterday: ledger _L(Y)_, prices on or before
  _Y_, with the same intraday-quote rule as _V(T)_ (a quote for yesterday's trading day
  counts until its official close is stored, #28), so both ends use the same price source.
  Computed in the app, not read from the snapshot (yesterday's snapshot does not exist
  until 05:40 UTC).
- **Day change €** _D_ = _V(T)_ − _V(Y)_ − _F(T)_.
- **Day change %** = _D_ ÷ _V(Y)_; "—" when _V(Y)_ = 0.

**How today's contributions are excluded:** today's rows enter only through _F(T)_. A buy
today adds its cost to _F(T)_ and its units (at the current price) to _V(T)_, so only the
difference between the current price and the price paid counts as today's change; a sale
removes the units from _V(T)_ and its proceeds from _F(T)_. Flows are taken at the end of
the day, so they are not in the denominator (same convention as TWR, #17). A dividend
recorded today counts as part of today's change (it is return, not contribution).

Example: _V(Y)_ = 10,000. Today: buy 1,000 of X; X now worth 1,010; the rest up 50.
_V(T)_ = 11,060, _F(T)_ = 1,000, _D_ = 60, % = 0.60%.

Per asset _a_: _D_a_ = _V_a(T)_ − _V_a(Y)_ − _F_a(T)_, with _F_a_ the flows of rows with
`asset_id` = _a_; % = _D_a_ ÷ _V_a(Y)_, "new" when the position was opened today.

On a Monday _V(Y)_ is Sunday's value (Friday's stock closes, Sunday's BTC). Before the US
open a US stock's day change is 0.

## 3. Returns: XIRR and TWR

Periods, all ending at _T_:

| Period          | Start date _S_                                   |
| --------------- | ------------------------------------------------ |
| **Since start** | the day before the first ledger row (_V(S)_ = 0) |
| **YTD**         | 31 December of the previous year                 |
| **1Y**          | `addMonths(T, −12)` (29 Feb → 28 Feb)            |

If the portfolio did not exist yet on _S_, _V(S)_ = 0 and the period is effectively "since
start" (labeled so). _V(S)_ comes from the snapshot of day _S_; if that snapshot is missing
while positions were held, the KPI shows "—" with "snapshot missing".

**XIRR** (money-weighted, #16): the rate _r_ solving Σ _a_i_ / (1+_r_)^(_d_i_/365) = 0 over
the flows: −*V(S)* on _S_ (omitted when 0), −*F* of each row dated in (_S_, _T_] on its
date, and +_V(T)_ on _T_. Actual/365. Since start this is exactly
`xirr(investmentCashFlows(ledger, { asOf: T, terminalValueEur: V(T) }))`.
Display: periods of 365 days or more show the annualized rate; shorter ones (YTD for most
of the year) show the period rate (1+_r_)^(days/365) − 1, labeled "not annualized". A
failure (no sign change, too short) shows "—" with the reason.

**TWR** (time-weighted, #17): the points are (_S_, _V(S)_), then every snapshot day
_d_ in (_S_, _Y_] with (_V(d)_, _F(d)_), then (_T_, _V(T)_, _F(T)_). Flows of a day without a
snapshot are added to the next point. For each step
_r_i_ = (_V_i_ − _F_i_) ÷ _V\_{i−1}_ − 1, and TWR = Π(1 + _r_i_) − 1.

- A step that starts from zero value with a positive flow (the first buy, or re-entry
  after selling everything) uses _r_i_ = _V_i_ ÷ _F_i_ − 1 (that day's flow taken at the
  start of the day; #17, changed 2026-10-23: `twr()` used to throw there, and month-level
  imported buys on the 1st almost never equal the close of the 1st).
- A step from zero to zero is skipped.
- Shown as cumulative; annualized ((1+TWR)^(365/days) − 1) only for spans of 365 days or more.

## 4. Value vs contributions series

One point per snapshot day: (_d_, _V(d)_, _NI(d)_) from `portfolio_snapshots`, plus today's
point (_T_, _V(T)_, _NI(T)_). Ranges: **1M** from `addMonths(T, −1)`, **3M**
`addMonths(T, −3)`, **YTD** from 31 Dec, **1Y** `addMonths(T, −12)`, **All** from the first
snapshot. The chart reads the selected range's first and last points: value change and the
change in net invested. Long ranges are thinned for drawing only (`docs/app-plan.md` §5).

## 5. Monthly and yearly returns

For calendar month _m_ with end _E_m_ (its last day, or _T_ for the current month) and start
_E\_{m−1}_ (the previous month's last day; for the first month, the day before the first row):

| Column            | Definition                                                            |
| ----------------- | --------------------------------------------------------------------- |
| **Return**        | TWR over (_E\_{m−1}_, _E_m_] (§3 steps).                              |
| **Contributions** | _NI(E_m)_ − _NI(E\_{m−1}_).                                           |
| **Market gain**   | _V(E_m)_ − _V(E\_{m−1})_ − contributions (capital gain of the month). |
| **Income**        | net income dated in the month (§1).                                   |
| **Start / end**   | _V(E\_{m−1})_, _V(E_m)_.                                              |

Years: the same with calendar-year boundaries; the yearly return equals the product of its
monthly (1 + return) − 1. The current month and year are labeled MTD / YTD. **Best / worst
month**: highest / lowest monthly return among completed months (MTD excluded), with ties
going to the earlier month. A month containing rows with `trade_date_precision = 'month'`
(imported history) is marked "approx.": those rows are valued from the 1st (#22, #27).

## 6. Allocation

Weight of group _k_ = _V_k(T)_ ÷ _V(T)_ (positions only; there is no cash; with
certificados excluded, both are of the scoped portfolio, §0.2). Groups:

| Dimension            | Group key                       | Value of the group                                     |
| -------------------- | ------------------------------- | ------------------------------------------------------ |
| **Type**             | `assets.asset_type`             | Σ positions of that type                               |
| **Broker**           | `accounts.id` (shown by name)   | Σ units held in that account × unit value (CA: by lot) |
| **Listing currency** | `assets.trading_currency` (#26) | Σ positions listed in it (crypto, CA: EUR)             |
| **Asset**            | `assets.id`                     | Σ across accounts                                      |

Sorted by value, largest first; ties by key. **Top 5 / top 10 concentration** = Σ weights
of the 5 / 10 largest assets (core `concentration`).

**Top positions**: open positions by _V_a(T)_, largest first, with weight, unrealized gain
€ and %.

## 7. Top movers

Ranked by **€ impact** (decision D4: top movers are ranked by EUR impact, with the %
shown beside it):

- **Day**: open positions ranked by day change € _D_a_ (§2), 3 best (positive only) and
  3 worst (negative only). Positions with _D_a_ = 0 are left out. A position opened today
  ranks by its € change and shows "new" instead of a %.
- **Total**: open positions ranked by unrealized gain € _U_a_, 3 best (positive only) and
  3 worst (negative only), with % = _U_a_ ÷ cost basis.

Ties go to the larger position value, then the asset id. The €/% chip re-ranks the same
lists by % (day: _D_a_ ÷ _V_a(Y)_, positions opened today left out; total: _U_a_ ÷ cost
basis).

## 8. Positions, brokers, closed positions, certificados

**Position** (asset _a_, all accounts): units, cost basis (open lots), **average cost** =
cost basis ÷ units, value _V_a(T)_, weight, unrealized gain _U_a_ (€, %), realized gain _R_a_
(all disposals of _a_, all accounts, all time), income (dividends with `asset_id` = _a_),
day change. **Split by broker**: the same per account (units, cost, value, unrealized,
realized); the lines add up to the position. **Open lots**: per lot account, acquisition
date, units left, cost left, unit cost.

**Broker** (account _b_): value _V_b_, weight _V_b_ ÷ _V(T)_, cost basis, _U_b_, _R_b_
(disposals booked in _b_), _I_b_, _C_b_, gain = _R_b_ + _U_b_ + _I_b_ − _C_b_. Σ over brokers =
the portfolio figures.

**Closed position**: an asset with 0 units at _T_ and at least one disposal. Shows units
bought and sold, cost of the units sold (FIFO), proceeds (net of fees), realized gain and
% (gain ÷ cost of units sold), income received while held, first buy and last sale dates,
split by broker. Labeled "Performance, not tax". Realized gains of assets still held are
in their position detail. A position closed and re-opened shows under its open position.

**Certificado subscription**: units held _u_, latest factor _f_ (month _m_, on or before _T_),
value _u_ × _f_ (before the first factor: the subscription price, labeled so), cost = units ×
subscription price, gain = value − cost, factor age = _T_ − _m_ (days), **flag when the age
exceeds 35 days**. Factor update screen: change vs last month = new − previous factor (and
%); a decrease is warned about, not blocked. Labeled "from factor", never "estimated".

## 9. Freshness

- **As of**: the time the app last computed _V(T)_ (value-now's `computedAt`), and per asset
  the date of the price used (quote time for live quotes).
- **Stale price indicator**: count of held assets whose price is stale or a trade-price
  stand-in ("price pending" for an asset with no price yet).
- **Stale CA factor indicator**: the oldest factor among held subscriptions is more than 35
  days old.
- **Last price update / last snapshot**: newest `job_runs.finished_at` with job `prices` /
  `snapshots` and its status.

## 10. Where each KPI is computed

Built in slices 5a-core and 5b (2026-10-23); the apps call these and only format the
result.

| KPI                                         | `packages/core` function (file)                               |
| ------------------------------------------- | ------------------------------------------------------------- |
| Lots, per-account holdings (§0, §8)         | `runFifo` (`fifo.ts`), `computeHoldings` → `Holding.accounts` |
| Total value, cost, _R_, _U_, _I_, _C_, _G_  | `gainsSummary` (`gains.ts`); per broker `accountSummaries`    |
| Net invested                                | `netInvestedEur` (`gains.ts`)                                 |
| Flows _F(d)_                                | `flowEur`, `dailyFlows` (`cashflows.ts`)                      |
| Day change (§2)                             | `dayChange` (`daychange.ts`)                                  |
| XIRR, TWR: Since start, YTD, 1Y (§3)        | `periodReturns` (`returns.ts`)                                |
| Value vs contributions (§4)                 | `valueSeries` (`returns.ts`)                                  |
| Monthly, yearly, best / worst month (§5)    | `monthlyReturns`, `yearlyReturns`, `bestWorstMonth`           |
| Allocation, top 5 / 10 (§6)                 | `allocation`, `concentration` (`allocation.ts`)               |
| Top positions, top movers (§6, §7)          | `topPositions`, `topMovers` (`movers.ts`)                     |
| Closed positions (§8)                       | `closedPositions` (`closed.ts`)                               |
| Position, split by broker, open lots (§8)   | `positionDetail` (`positions.ts`)                             |
| Position price chart, asset transactions    | `priceSeries`, `assetTransactions` (`positions.ts`)           |
| Positions, Allocation, Performance screens  | `buildPositions`, `buildAllocation`, `buildPerformance`       |
| Units held, most that can be sold on a date | `unitsHeld`, `maxDisposable` (`validation.ts`)                |
| Certificado subscription, factor age (§8)   | `certificadoSubscriptions` (`certificados.ts`)                |
| Factor update: change vs last month (§8)    | `factorChange`, `factorUpdateLines` (`certificados.ts`)       |
| Asset scope (§0.2)                          | `scope.ts`; a `scope` option (`docs/app-plan.md` §10.3)       |
