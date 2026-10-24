import { dec, ZERO, type Decimal, type DecimalInput } from './decimal';
import type { Holding } from './holdings';
import { isFullScope, scopeHoldings, type AssetScope } from './scope';
import type { AssetType, PriceQuote } from './types';

/** One open position in the post-backfill sanity report. */
export interface SanityRow {
  assetId: string;
  assetType: AssetType;
  quantity: Decimal;
  /** The close used (native currency), or null for certificados valued by factor. */
  price: PriceQuote | null;
  marketValueEur: Decimal | null;
  costBasisEur: Decimal;
  /** marketValue / costBasis; null when unvalued or the cost is zero. */
  ratio: Decimal | null;
  /** 'high' above the high limit, 'low' below the low limit: a possible split or currency problem. */
  outlier: 'high' | 'low' | null;
}

export interface SanityReport {
  rows: SanityRow[];
  totalValueEur: Decimal;
  totalCostBasisEur: Decimal;
  outliers: number;
  unvalued: number;
}

/**
 * Value-to-cost ratio per holding, flagging ratios above `high` (default 5) or below `low`
 * (default 0.2). A split recorded one way in the ledger and the other way in the prices
 * shows up as a ratio near the split ratio (20x, 1/20); a USD close read as EUR as ~1.1x.
 */
export function sanityReport(
  holdings: readonly Holding[],
  limits: { high?: DecimalInput; low?: DecimalInput } = {},
): SanityReport {
  const high = dec(limits.high ?? '5');
  const low = dec(limits.low ?? '0.2');
  let totalValueEur = ZERO;
  let totalCostBasisEur = ZERO;
  const rows = holdings.map((h): SanityRow => {
    const ratio =
      h.marketValueEur && !h.costBasisEur.isZero() ? h.marketValueEur.div(h.costBasisEur) : null;
    totalValueEur = totalValueEur.plus(h.marketValueEur ?? ZERO);
    totalCostBasisEur = totalCostBasisEur.plus(h.costBasisEur);
    return {
      assetId: h.assetId,
      assetType: h.assetType,
      quantity: h.quantity,
      price: h.valuation.kind === 'price' ? h.valuation.price : null,
      marketValueEur: h.marketValueEur,
      costBasisEur: h.costBasisEur,
      ratio,
      outlier: ratio === null ? null : ratio.gt(high) ? 'high' : ratio.lt(low) ? 'low' : null,
    };
  });
  return {
    rows,
    totalValueEur,
    totalCostBasisEur,
    outliers: rows.filter((r) => r.outlier).length,
    unvalued: rows.filter((r) => !r.marketValueEur).length,
  };
}

/** The run-time identity checks (docs/app-plan.md §5). Names and asset ids only. */
export type ReconcileCheck =
  /** V - NI = R + U (the gap in the value vs net invested chart is the capital gain). */
  | 'capital-gain'
  /** A holding's accounts add up to it (units, cost, value, unrealized). */
  | 'accounts'
  /** The app's V(T) differs from value-now's: the deployed functions may run an older core. */
  | 'value-now-value'
  /** The app's cost basis differs from value-now's. */
  | 'value-now-cost';

export interface ReconcileIssue {
  check: ReconcileCheck;
  assetId?: string;
}

export interface ReconcileResult {
  ok: boolean;
  issues: ReconcileIssue[];
}

/**
 * Checks that the figures agree with each other: V - NI = R + U exactly, every holding's
 * accounts add up to it, and (when given) value-now's totals match at numeric(38,18)
 * precision. With a `scope` leaving assets out, the figures are those of the assets in
 * scope and value-now's whole-portfolio totals are not compared. A failure is shown,
 * never silently fixed. Holdings must all be valued.
 */
export function reconcile(input: {
  holdings: readonly Holding[];
  gains: { realizedEur: Decimal; unrealizedEur: Decimal };
  netInvestedEur: Decimal;
  reference?: { totalValueEur: Decimal; costBasisEur: Decimal } | null;
  scope?: AssetScope;
}): ReconcileResult {
  const { gains } = input;
  const holdings = scopeHoldings(input.holdings, input.scope);
  const reference = isFullScope(input.scope) ? input.reference : null;
  const issues: ReconcileIssue[] = [];
  const value = holdings.reduce((s, h) => s.plus(h.marketValueEur ?? ZERO), ZERO);
  const cost = holdings.reduce((s, h) => s.plus(h.costBasisEur), ZERO);

  if (!value.minus(input.netInvestedEur).eq(gains.realizedEur.plus(gains.unrealizedEur))) {
    issues.push({ check: 'capital-gain' });
  }
  for (const h of holdings) {
    const total = (pick: (a: Holding['accounts'][number]) => Decimal | null) =>
      h.accounts.reduce((s, a) => s.plus(pick(a) ?? ZERO), ZERO);
    const agrees =
      total((a) => a.quantity).eq(h.quantity) &&
      total((a) => a.costBasisEur).eq(h.costBasisEur) &&
      total((a) => a.marketValueEur).eq(h.marketValueEur ?? ZERO) &&
      total((a) => a.unrealizedGainEur).eq(h.unrealizedGainEur ?? ZERO);
    if (!agrees) issues.push({ check: 'accounts', assetId: h.assetId });
  }
  if (reference) {
    const same = (a: Decimal, b: Decimal) => a.toDecimalPlaces(18).eq(b.toDecimalPlaces(18));
    if (!same(value, reference.totalValueEur)) issues.push({ check: 'value-now-value' });
    if (!same(cost, reference.costBasisEur)) issues.push({ check: 'value-now-cost' });
  }
  return { ok: issues.length === 0, issues };
}
