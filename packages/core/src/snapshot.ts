import type { CaContext } from './certificados';
import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { MissingValuationError } from './errors';
import { netContributions } from './gains';
import { computeHoldings } from './holdings';
import { cashBalanceEur, hasDeposits } from './ledger';
import type { Asset, AssetType, FxLookup, PriceLookup, Transaction } from './types';

export interface SnapshotInput {
  date: IsoDate;
  transactions: readonly Transaction[];
  assets: readonly Asset[];
  prices: PriceLookup;
  fx: FxLookup;
  ca?: CaContext;
  /**
   * Include cash in the snapshot. Defaults to whether the ledger records any deposit;
   * without deposits the cash balance would just be minus the amount invested.
   */
  trackCash?: boolean;
}

/** One public.portfolio_snapshots row (all EUR). */
export interface PortfolioSnapshot {
  snapshotDate: IsoDate;
  /** Positions at market value, plus cash when it is tracked. */
  totalValueEur: Decimal;
  totalCostBasisEur: Decimal;
  netContributionsEur: Decimal;
  /** Null when cash is not tracked. */
  cashEur: Decimal | null;
  stockValueEur: Decimal;
  etfValueEur: Decimal;
  cryptoValueEur: Decimal;
  certificadoAforroValueEur: Decimal;
}

/**
 * The day's totals from the ledger up to and including `date`, prices/fx on or before it.
 * Throws MissingValuationError rather than writing a snapshot with a hole in it.
 */
export function buildSnapshot(input: SnapshotInput): PortfolioSnapshot {
  const { date, transactions } = input;
  const holdings = computeHoldings({ ...input, asOf: date });
  const unvalued = holdings.filter((h) => !h.marketValueEur).map((h) => h.assetId);
  if (unvalued.length > 0) throw new MissingValuationError([...new Set(unvalued)], date);

  const byType: Record<AssetType, Decimal> = {
    stock: ZERO,
    etf: ZERO,
    crypto: ZERO,
    certificado_aforro: ZERO,
  };
  let costBasis = ZERO;
  for (const h of holdings) {
    byType[h.assetType] = byType[h.assetType].plus(h.marketValueEur as Decimal);
    costBasis = costBasis.plus(h.costBasisEur);
  }
  const trackCash = input.trackCash ?? hasDeposits(transactions);
  const cashEur = trackCash ? cashBalanceEur(transactions, date) : null;
  const positions = Object.values(byType).reduce((s, v) => s.plus(v), ZERO);

  return {
    snapshotDate: date,
    totalValueEur: cashEur ? positions.plus(cashEur) : positions,
    totalCostBasisEur: costBasis,
    netContributionsEur: netContributions(transactions, date).netEur,
    cashEur,
    stockValueEur: byType.stock,
    etfValueEur: byType.etf,
    cryptoValueEur: byType.crypto,
    certificadoAforroValueEur: byType.certificado_aforro,
  };
}
