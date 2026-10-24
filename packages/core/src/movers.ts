import type { DayChange } from './daychange';
import { ZERO, type Decimal } from './decimal';
import { MissingValuationError } from './errors';
import type { Holding } from './holdings';
import { scopeHoldings, type AssetScope } from './scope';

/** One open position for the Top positions card (docs/kpis.md §6). */
export interface TopPosition {
  assetId: string;
  valueEur: Decimal;
  /** valueEur / total value of all holdings; null when that total is 0. */
  weight: Decimal | null;
  unrealizedEur: Decimal;
  /** unrealized / cost basis; null when the cost basis is 0. */
  unrealizedPct: Decimal | null;
}

/**
 * Open positions by value, largest first (ties by asset id); `limit` keeps the first ones;
 * `scope` (default all) the assets in scope, weighted by their own total.
 * Throws MissingValuationError if any holding has no market value.
 */
export function topPositions(
  allHoldings: readonly Holding[],
  limit?: number,
  scope?: AssetScope,
): TopPosition[] {
  const holdings = scopeHoldings(allHoldings, scope);
  assertValued(holdings);
  const total = holdings.reduce((s, h) => s.plus(h.marketValueEur as Decimal), ZERO);
  const rows = holdings
    .map((h) => ({
      assetId: h.assetId,
      valueEur: h.marketValueEur as Decimal,
      weight: total.isZero() ? null : (h.marketValueEur as Decimal).div(total),
      unrealizedEur: h.unrealizedGainEur as Decimal,
      unrealizedPct: h.costBasisEur.isZero()
        ? null
        : (h.unrealizedGainEur as Decimal).div(h.costBasisEur),
    }))
    .sort((a, b) => b.valueEur.comparedTo(a.valueEur) || a.assetId.localeCompare(b.assetId));
  return limit === undefined ? rows : rows.slice(0, limit);
}

export interface Mover {
  assetId: string;
  /** The position's value today (for display and tie-breaks). */
  valueEur: Decimal;
  /** Day: D_a. Total: unrealized gain U_a. */
  changeEur: Decimal;
  /** Day: D_a / V_a(Y). Total: U_a / cost basis. Null when undefined ("new" for the day). */
  changePct: Decimal | null;
  /** Day only: the position was opened today. */
  openedToday: boolean;
}

export interface MoverLists {
  /** Positive changes only, largest first. */
  up: Mover[];
  /** Negative changes only, most negative first. */
  down: Mover[];
}

export interface TopMovers {
  day: MoverLists;
  total: MoverLists;
}

/**
 * Top movers (docs/kpis.md §7, decision D4): open positions ranked by € impact (`by: 'eur'`,
 * the default) or by % (`by: 'pct'`, which leaves out positions without a %: opened today,
 * or with no cost). Zero changes are left out. Ties go to the larger position value, then
 * the asset id. `limit` (default 3) applies to each list.
 */
export function topMovers(input: {
  day: DayChange;
  holdings: readonly Holding[];
  by?: 'eur' | 'pct';
  limit?: number;
  /** Only the assets in scope (default all); `day` should be computed for the same scope. */
  scope?: AssetScope;
}): TopMovers {
  const { day, by = 'eur', limit = 3, scope } = input;
  const holdings = scopeHoldings(input.holdings, scope);
  assertValued(holdings);
  const dayMovers: Mover[] = day.assets
    .filter((a) => a.held && (!scope || scope.includes(a.assetId)))
    .map((a) => ({
      assetId: a.assetId,
      valueEur: a.valueTodayEur,
      changeEur: a.changeEur,
      changePct: a.changePct,
      openedToday: a.openedToday,
    }));
  const totalMovers: Mover[] = holdings.map((h) => ({
    assetId: h.assetId,
    valueEur: h.marketValueEur as Decimal,
    changeEur: h.unrealizedGainEur as Decimal,
    changePct: h.costBasisEur.isZero()
      ? null
      : (h.unrealizedGainEur as Decimal).div(h.costBasisEur),
    openedToday: false,
  }));
  return { day: rank(dayMovers, by, limit), total: rank(totalMovers, by, limit) };
}

function rank(movers: readonly Mover[], by: 'eur' | 'pct', limit: number): MoverLists {
  const key = (m: Mover) => (by === 'eur' ? m.changeEur : m.changePct);
  const ranked = movers.filter((m) => key(m) !== null && !(key(m) as Decimal).isZero());
  const tie = (a: Mover, b: Mover) =>
    b.valueEur.comparedTo(a.valueEur) || a.assetId.localeCompare(b.assetId);
  const up = ranked
    .filter((m) => (key(m) as Decimal).gt(0))
    .sort((a, b) => (key(b) as Decimal).comparedTo(key(a) as Decimal) || tie(a, b));
  const down = ranked
    .filter((m) => (key(m) as Decimal).lt(0))
    .sort((a, b) => (key(a) as Decimal).comparedTo(key(b) as Decimal) || tie(a, b));
  return { up: up.slice(0, limit), down: down.slice(0, limit) };
}

function assertValued(holdings: readonly Holding[]): void {
  const unvalued = holdings.filter((h) => !h.marketValueEur).map((h) => h.assetId);
  if (unvalued.length > 0) throw new MissingValuationError([...new Set(unvalued)]);
}
