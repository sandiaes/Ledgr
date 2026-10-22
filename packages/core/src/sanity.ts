import { dec, ZERO, type Decimal, type DecimalInput } from './decimal';
import type { Holding } from './holdings';
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
