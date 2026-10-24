import type { CaContext } from './certificados';
import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { LedgerError } from './errors';
import { runFifo, type Lot } from './fifo';
import { scopeTransactions, type AssetScope } from './scope';
import type { Asset, AssetType, FxLookup, PriceLookup, PriceQuote, Transaction } from './types';

export interface HoldingsInput {
  transactions: readonly Transaction[];
  assets: readonly Asset[];
  asOf: IsoDate;
  prices: PriceLookup;
  fx: FxLookup;
  /** Needed to value certificados by factor; without it they fall back to `prices`. */
  ca?: CaContext;
  /** Only the assets in scope (docs/kpis.md §0.2); default all. */
  scope?: AssetScope;
}

export type HoldingValuation =
  | { kind: 'price'; price: PriceQuote; fxRateToEur: Decimal }
  | { kind: 'certificado'; lots: CertificadoLotValuation[] }
  | { kind: 'missing'; reason: 'price' | 'fx' };

/**
 * How one certificado lot was valued:
 *   factor        its latest official factor on or before asOf (the default)
 *   subscription  no factor yet: the EUR paid per unit at subscription
 *   accrual       the optional rule-based model, from `factorMonth` when set
 */
export interface CertificadoLotValuation {
  lotId: string;
  unitValue: Decimal;
  source: 'factor' | 'subscription' | 'accrual';
  /** Month of the factor used (as value or as accrual anchor), or null. */
  factorMonth: IsoDate | null;
}

/** The part of a holding sitting in one account: its own lots (FIFO per account, #1). */
export interface HoldingAccount {
  accountId: string;
  /** Units of the account's open lots. */
  quantity: Decimal;
  /** Cost of the account's open lots. */
  costBasisEur: Decimal;
  /**
   * The account's units at the holding's unit value (certificados: its lots' values); null
   * if the holding is unvalued. The accounts' values add up exactly to the holding's.
   */
  marketValueEur: Decimal | null;
  unrealizedGainEur: Decimal | null;
  lots: Lot[];
}

/**
 * One open position per asset, over all accounts; `accounts` splits it exactly (units,
 * cost, value, unrealized) by the account holding each lot.
 */
export interface Holding {
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
  /** Accounts holding open lots of the asset, by account id. */
  accounts: HoldingAccount[];
}

/** Open positions per asset as of `asOf`. Closed positions are omitted. */
export function computeHoldings(input: HoldingsInput): Holding[] {
  const { asOf, ca } = input;
  const transactions = scopeTransactions(input.transactions, input.scope);
  const assets = new Map(input.assets.map((a) => [a.id, a]));
  const { openLots } = runFifo(transactions, { asOf, caSubscriptions: ca?.subscriptions });

  const groups = new Map<string, Lot[]>();
  for (const lot of openLots) groups.set(lot.assetId, [...(groups.get(lot.assetId) ?? []), lot]);

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
    /** Value of some of the holding's lots, given the valuation found. */
    let valueOf: ((lots: readonly Lot[]) => Decimal) | null = null;

    if (asset.assetType === 'certificado_aforro' && caValue) {
      const valued = caValue(lots);
      if (valued) {
        valuation = { kind: 'certificado', lots: valued.lots };
        marketValueEur = valued.total;
        const unit = new Map(valued.lots.map((l) => [l.lotId, l.unitValue]));
        valueOf = (some) =>
          some.reduce((s, l) => s.plus(l.quantity.times(unit.get(l.lotId) as Decimal)), ZERO);
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
        valueOf = (some) =>
          some
            .reduce((s, l) => s.plus(l.quantity), ZERO)
            .times(price.close)
            .times(rate);
      }
    }

    holdings.push({
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
      accounts: splitByAccount(lots, marketValueEur, valueOf),
    });
  }

  return holdings.sort((a, b) => a.assetId.localeCompare(b.assetId));
}

/**
 * The holding's lots grouped by account. Each account is valued on its own lots; the last
 * account takes the remainder, so the parts add up exactly to the holding's value.
 */
function splitByAccount(
  lots: readonly Lot[],
  total: Decimal | null,
  valueOf: ((lots: readonly Lot[]) => Decimal) | null,
): HoldingAccount[] {
  const byAccount = new Map<string, Lot[]>();
  for (const lot of lots)
    byAccount.set(lot.accountId, [...(byAccount.get(lot.accountId) ?? []), lot]);
  const ids = [...byAccount.keys()].sort((a, b) => a.localeCompare(b));
  let valueLeft = total;
  return ids.map((accountId, i) => {
    const own = byAccount.get(accountId) as Lot[];
    const costBasisEur = own.reduce((s, l) => s.plus(l.costEur), ZERO);
    let marketValueEur: Decimal | null = null;
    if (valueLeft && valueOf) {
      marketValueEur = i === ids.length - 1 ? valueLeft : valueOf(own);
      valueLeft = valueLeft.minus(marketValueEur);
    }
    return {
      accountId,
      quantity: own.reduce((s, l) => s.plus(l.quantity), ZERO),
      costBasisEur,
      marketValueEur,
      unrealizedGainEur: marketValueEur ? marketValueEur.minus(costBasisEur) : null,
      lots: own,
    };
  });
}

/**
 * Returns a function valuing certificado lots, or null for lots not all linked to a
 * ca_subscriptions row (a holding with such lots falls back to the price lookup).
 */
export function certificadoValuer(
  transactions: readonly Transaction[],
  asOf: IsoDate,
  ca: CaContext,
) {
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const subByTx = new Map(ca.subscriptions.map((s) => [s.transactionId, s]));
  const seriesById = new Map((ca.accrual?.series ?? []).map((s) => [s.id, s]));

  return (lots: readonly Lot[]) => {
    const valued: CertificadoLotValuation[] = [];
    let total = ZERO;
    for (const lot of lots) {
      const sub = subByTx.get(lot.originTransactionId);
      const tx = txById.get(lot.originTransactionId);
      if (!sub || !tx?.unitPrice) return null;

      const factor = ca.factors(sub.id, asOf);
      // A factor may be dated earlier in the subscription's own month, never before it.
      if (factor && factor.month < firstOfMonth(lot.acquiredOn)) {
        throw new LedgerError(
          `CA factor for ${factor.month} is before subscription ${sub.id} on ${lot.acquiredOn}`,
          tx.id,
        );
      }
      const subscriptionUnitValue = tx.unitPrice.times(tx.fxRateToEur);
      const series = ca.accrual && seriesById.get(sub.seriesId);

      let entry: CertificadoLotValuation;
      if (ca.accrual && series) {
        const result = ca.accrual.valuer.valueUnit({
          series,
          subscriptionDate: lot.acquiredOn,
          subscriptionUnitValue,
          asOf,
          anchor: factor
            ? {
                date: factor.month < lot.acquiredOn ? lot.acquiredOn : factor.month,
                unitValue: factor.factor,
              }
            : null,
        });
        entry = {
          lotId: lot.lotId,
          unitValue: result.unitValue,
          source: 'accrual',
          factorMonth: factor?.month ?? null,
        };
      } else if (factor) {
        entry = {
          lotId: lot.lotId,
          unitValue: factor.factor,
          source: 'factor',
          factorMonth: factor.month,
        };
      } else {
        entry = {
          lotId: lot.lotId,
          unitValue: subscriptionUnitValue,
          source: 'subscription',
          factorMonth: null,
        };
      }
      valued.push(entry);
      total = total.plus(lot.quantity.times(entry.unitValue));
    }
    return { lots: valued, total };
  };
}

function firstOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}
