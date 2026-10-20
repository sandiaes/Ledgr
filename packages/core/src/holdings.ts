import type { CaContext, CaSubscription } from './certificados';
import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { LedgerError } from './errors';
import { runFifo, type Lot } from './fifo';
import type { Asset, AssetType, FxLookup, PriceLookup, PriceQuote, Transaction } from './types';

export interface HoldingsInput {
  transactions: readonly Transaction[];
  assets: readonly Asset[];
  asOf: IsoDate;
  prices: PriceLookup;
  fx: FxLookup;
  /** Needed to value certificados by accrual; without it they fall back to `prices`. */
  ca?: CaContext;
}

export type HoldingValuation =
  | { kind: 'price'; price: PriceQuote; fxRateToEur: Decimal }
  | {
      kind: 'certificado';
      lots: { lotId: string; unitValue: Decimal; source: 'rules' | 'manual' }[];
    }
  | { kind: 'missing'; reason: 'price' | 'fx' };

export interface Holding {
  accountId: string;
  assetId: string;
  assetType: AssetType;
  /** The asset's trading currency. */
  currency: string;
  quantity: Decimal;
  /** Open lots' cost incl. fees, EUR at each acquisition's fx rate. */
  costBasisEur: Decimal;
  averageCostEur: Decimal;
  /** Price x quantity x fx on asOf (latest on or before), or accrued value; null if unknown. */
  marketValueEur: Decimal | null;
  unrealizedGainEur: Decimal | null;
  valuation: HoldingValuation;
  lots: Lot[];
}

/** Open positions per (account, asset) as of `asOf`. Closed positions are omitted. */
export function computeHoldings(input: HoldingsInput): Holding[] {
  const { transactions, asOf, ca } = input;
  const assets = new Map(input.assets.map((a) => [a.id, a]));
  const { openLots } = runFifo(transactions, { asOf, caSubscriptions: ca?.subscriptions });

  const groups = new Map<string, Lot[]>();
  for (const lot of openLots) {
    const key = `${lot.accountId}\u0000${lot.assetId}`;
    groups.set(key, [...(groups.get(key) ?? []), lot]);
  }

  const caValue = ca ? certificadoValuer(transactions, asOf, ca) : null;
  const holdings: Holding[] = [];

  for (const lots of groups.values()) {
    const first = lots[0] as Lot;
    const asset = assets.get(first.assetId);
    if (!asset) throw new LedgerError(`Unknown asset ${first.assetId}`);

    const quantity = lots.reduce((s, l) => s.plus(l.quantity), ZERO);
    const costBasisEur = lots.reduce((s, l) => s.plus(l.costEur), ZERO);

    let valuation: HoldingValuation | null = null;
    let marketValueEur: Decimal | null = null;

    if (asset.assetType === 'certificado_aforro' && caValue) {
      const valued = caValue(lots);
      if (valued) {
        valuation = { kind: 'certificado', lots: valued.lots };
        marketValueEur = valued.total;
      }
    }
    if (!valuation) {
      const price = input.prices(asset.id, asOf);
      const rate = price ? input.fx(price.currency, asOf) : null;
      if (!price) valuation = { kind: 'missing', reason: 'price' };
      else if (!rate) valuation = { kind: 'missing', reason: 'fx' };
      else {
        valuation = { kind: 'price', price, fxRateToEur: rate };
        marketValueEur = quantity.times(price.close).times(rate);
      }
    }

    holdings.push({
      accountId: first.accountId,
      assetId: asset.id,
      assetType: asset.assetType,
      currency: asset.tradingCurrency,
      quantity,
      costBasisEur,
      averageCostEur: costBasisEur.div(quantity),
      marketValueEur,
      unrealizedGainEur: marketValueEur ? marketValueEur.minus(costBasisEur) : null,
      valuation,
      lots,
    });
  }

  return holdings.sort(
    (a, b) => a.accountId.localeCompare(b.accountId) || a.assetId.localeCompare(b.assetId),
  );
}

/**
 * Returns a function valuing a certificado holding's lots, or null for a holding whose lots
 * are not all linked to a ca_subscriptions row and series.
 */
function certificadoValuer(transactions: readonly Transaction[], asOf: IsoDate, ca: CaContext) {
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const seriesById = new Map(ca.series.map((s) => [s.id, s]));
  const subByTx = new Map(ca.subscriptions.map((s) => [s.transactionId, s]));
  const lotsOnDate = new Map<IsoDate, Lot[]>();

  const unitsOn = (sub: CaSubscription, date: IsoDate): Decimal => {
    let lots = lotsOnDate.get(date);
    if (!lots) {
      lots = runFifo(transactions, { asOf: date, caSubscriptions: ca.subscriptions }).openLots;
      lotsOnDate.set(date, lots);
    }
    return lots.find((l) => l.lotId === sub.transactionId)?.quantity ?? ZERO;
  };

  return (lots: Lot[]) => {
    const valued: { lotId: string; unitValue: Decimal; source: 'rules' | 'manual' }[] = [];
    let total = ZERO;
    for (const lot of lots) {
      const sub = subByTx.get(lot.lotId);
      const series = sub && seriesById.get(sub.seriesId);
      const tx = txById.get(lot.lotId);
      if (!sub || !series || !tx?.unitPrice) return null;

      let manual: { date: IsoDate; unitValue: Decimal } | null = null;
      if (sub.manualValue && sub.manualValueDate && sub.manualValueDate <= asOf) {
        const units = unitsOn(sub, sub.manualValueDate);
        if (units.isZero()) {
          throw new LedgerError(
            `Manual value for CA subscription ${sub.id} is dated ${sub.manualValueDate}, ` +
              'when it had no units outstanding',
          );
        }
        manual = { date: sub.manualValueDate, unitValue: sub.manualValue.div(units) };
      }

      const result = ca.valuer.valueUnit({
        series,
        subscriptionDate: lot.acquiredOn,
        subscriptionUnitValue: tx.unitPrice.times(tx.fxRateToEur),
        asOf,
        manual,
      });
      valued.push({ lotId: lot.lotId, unitValue: result.unitValue, source: result.source });
      total = total.plus(lot.quantity.times(result.unitValue));
    }
    return { lots: valued, total };
  };
}
