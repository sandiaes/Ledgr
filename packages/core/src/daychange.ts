import type { CaContext } from './certificados';
import { flowEur } from './cashflows';
import { addDays, type IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { MissingValuationError } from './errors';
import { computeHoldings, type Holding } from './holdings';
import { prepareLedger } from './ledger';
import { scopeTransactions, type AssetScope } from './scope';
import type { Asset, FxLookup, PriceLookup, Transaction } from './types';

export interface DayChangeInput {
  transactions: readonly Transaction[];
  assets: readonly Asset[];
  /** The same lookup for both ends (closes plus intraday quotes, `withLiveQuotes`). */
  prices: PriceLookup;
  fx: FxLookup;
  ca?: CaContext;
  /** T, the owner's local date. Yesterday Y is T - 1 day. */
  today: IsoDate;
  /** Only the assets in scope (docs/kpis.md §0.2): V(T), V(Y) and F(T); default all. */
  scope?: AssetScope;
}

/** One asset's day change (docs/kpis.md §2, per asset). */
export interface AssetDayChange {
  assetId: string;
  /** V_a(T): 0 when no longer held. */
  valueTodayEur: Decimal;
  /** V_a(Y): 0 when not held yesterday. */
  valueYesterdayEur: Decimal;
  /** F_a(T): flows of today's rows of this asset. */
  flowTodayEur: Decimal;
  /** D_a = V_a(T) - V_a(Y) - F_a(T). */
  changeEur: Decimal;
  /** D_a / V_a(Y); null when V_a(Y) = 0. */
  changePct: Decimal | null;
  /** Held today. */
  held: boolean;
  /** Held today but not yesterday: the position was opened today ("new"). */
  openedToday: boolean;
}

export interface DayChange {
  today: IsoDate;
  yesterday: IsoDate;
  valueTodayEur: Decimal;
  valueYesterdayEur: Decimal;
  /** F(T): every row dated today, those without an asset included. */
  flowTodayEur: Decimal;
  /** D = V(T) - V(Y) - F(T). */
  changeEur: Decimal;
  /** D / V(Y); null when V(Y) = 0. */
  changePct: Decimal | null;
  /** Assets held today or yesterday, or with a flow today; by asset id. */
  assets: AssetDayChange[];
}

/**
 * Day change, with today's contributions excluded: today's rows enter only through F(T)
 * (flows at the end of the day, as in TWR). A buy today adds its cost to F(T) and its units
 * at the current price to V(T), so only the difference counts; a dividend today counts as
 * change. Throws MissingValuationError when a holding on either day has no value.
 */
export function dayChange(input: DayChangeInput): DayChange {
  const { today } = input;
  const transactions = scopeTransactions(input.transactions, input.scope);
  const yesterday = addDays(today, -1);
  const valued = (asOf: IsoDate) => {
    const holdings = computeHoldings({ ...input, transactions, asOf, scope: undefined });
    const unvalued = holdings.filter((h) => !h.marketValueEur).map((h) => h.assetId);
    if (unvalued.length > 0) throw new MissingValuationError(unvalued, asOf);
    return new Map(holdings.map((h): [string, Holding] => [h.assetId, h]));
  };
  const now = valued(today);
  const before = valued(yesterday);

  let flowTodayEur = ZERO;
  const assetFlows = new Map<string, Decimal>();
  for (const tx of prepareLedger(transactions, today)) {
    if (tx.tradeDate !== today) continue;
    const f = flowEur(tx);
    if (!f) continue;
    flowTodayEur = flowTodayEur.plus(f);
    if (tx.assetId) assetFlows.set(tx.assetId, (assetFlows.get(tx.assetId) ?? ZERO).plus(f));
  }

  const ids = [...new Set([...now.keys(), ...before.keys(), ...assetFlows.keys()])].sort();
  const assets = ids.map((assetId): AssetDayChange => {
    const valueTodayEur = now.get(assetId)?.marketValueEur ?? ZERO;
    const valueYesterdayEur = before.get(assetId)?.marketValueEur ?? ZERO;
    const flow = assetFlows.get(assetId) ?? ZERO;
    const changeEur = valueTodayEur.minus(valueYesterdayEur).minus(flow);
    return {
      assetId,
      valueTodayEur,
      valueYesterdayEur,
      flowTodayEur: flow,
      changeEur,
      changePct: valueYesterdayEur.isZero() ? null : changeEur.div(valueYesterdayEur),
      held: now.has(assetId),
      openedToday: now.has(assetId) && !before.has(assetId),
    };
  });

  const total = (m: Map<string, Holding>) =>
    [...m.values()].reduce((s, h) => s.plus(h.marketValueEur as Decimal), ZERO);
  const valueTodayEur = total(now);
  const valueYesterdayEur = total(before);
  const changeEur = valueTodayEur.minus(valueYesterdayEur).minus(flowTodayEur);
  return {
    today,
    yesterday,
    valueTodayEur,
    valueYesterdayEur,
    flowTodayEur,
    changeEur,
    changePct: valueYesterdayEur.isZero() ? null : changeEur.div(valueYesterdayEur),
    assets,
  };
}
