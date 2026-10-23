# KPI definitions (mobile and desktop apps)

Exact definitions of every number the apps show. Status: **proposed** (Step 5, Phase A),
awaiting approval. Each KPI is computed by a `packages/core` function (named in
`docs/app-plan.md` §3); the apps only format and display the result. All amounts are EUR,
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
  | deposit, withdrawal | 0 (cash is not tracked)                   |

  So income counts as return, fee rows count as a cost, and trades are neutral.

- **Net invested** _NI(d)_ (#24): Σ over _L(d)_ of acquisition cost (fees in) minus
  disposal proceeds (fees out). Stored as `portfolio_snapshots.net_contributions_eur`.
  Income, fee rows, deposits, withdrawals and transfers are not in it.
- **Lots**: FIFO **per account** (the proposed change in `docs/app-plan.md` §4). A sale
  consumes the oldest open lots _of its own account_; a transfer moves the sender's oldest
  lots, with their dates and cost, to the receiving account.
- **Stale**: a close more than 3 days old, or a trade-price stand-in (#25); a certificado
  factor more than 35 days old, aged from its month's 1st (#25).
- **Display**: amounts rounded half-up to cents, percentages to 2 decimals, both with
  `Decimal.toFixed` (never floats). A division by zero shows "—", never 0.

## 1. Totals

| KPI                     | Definition                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| **Total value**         | _V(T)_.                                                                                    |
| **Cost basis**          | Σ open lots' remaining cost (fees in, EUR at each acquisition's fx).                       |
| **Unrealized gain** _U_ | _V(T)_ − cost basis. % = _U_ ÷ cost basis.                                                 |
| **Realized gain** _R_   | Σ over all disposals in _L(T)_ of (proceeds net of fees − FIFO cost of the lots consumed). |
| **Net income** _I_      | Σ dividends and interest in _L(T)_: amount − withholding tax − fees.                       |
| **Other costs** _C_     | Σ fee rows (amount + fees) plus fees on deposits, withdrawals and transfers.               |
| **Total gain** _G_      | _R_ + _U_ + _I_ − _C_ (core `gainsSummary().totalReturnEur`).                              |
| **Net contributions**   | _NI(T)_ (net invested). Labeled "Net invested" in the UI.                                  |

Identities (checked in core tests and at run time, §8):

- _V(T)_ − _NI(T)_ = _R_ + _U_ exactly (the gap in the value vs contributions chart is the
  capital gain).
- _G_ = _V(T)_ − Σ _F(d)_ over all days.
- Per account: Σ over accounts of _R_, _U_, cost basis and value equals the portfolio
  figure exactly; per-account _I_ and _C_ are the rows booked in that account.

The dashboard shows _G_ with its parts: realized, unrealized, and "income − costs".

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

- **New:** a step that starts from zero value with a positive flow (the first buy, or
  re-entry after selling everything) uses _r_i_ = _V_i_ ÷ _F_i_ − 1 (that day's flow taken at
  the start of the day). Today `twr()` throws in that case; month-level imported buys on the
  1st almost never equal the close of the 1st, so the first day would always throw.
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

Weight of group _k_ = _V_k(T)_ ÷ _V(T)_ (positions only; there is no cash). Groups:

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

- **Day**: open positions ranked by day change % (§2), 3 best (positive only) and 3 worst
  (negative only). Positions opened today ("new") and positions with _D_a_ = 0 are left
  out. Shown with € and %.
- **Total**: open positions ranked by unrealized gain % (_U_a_ ÷ cost basis), 3 best and
  3 worst. Shown with € and %.

Ranking is by percentage, so a small position can rank first; the € amount is always shown.

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
