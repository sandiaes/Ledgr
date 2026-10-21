import type { CaContext } from './certificados';
import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { InsufficientHoldingsError, LedgerError } from './errors';
import { runFifo, type Lot } from './fifo';
import { isAcquisition, isDisposal, prepareLedger } from './ledger';
import type { Asset, AssetType, FxLookup, PriceLookup, PriceQuote, Transaction } from './types';

export interface HoldingsInput {
  transactions: readonly Transaction[];
  assets: readonly Asset[];
  asOf: IsoDate;
  prices: PriceLookup;
  fx: FxLookup;
  /** Needed to value certificados by factor; without it they fall back to `prices`. */
  ca?: CaContext;
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

/** Units of a holding sitting in one account. */
export interface HoldingAccount {
  accountId: string;
  /** That account's acquisitions minus its disposals, plus transfers in minus transfers out. */
  quantity: Decimal;
  /** The holding's market value pro rata to `quantity`; null if the holding is unvalued. */
  marketValueEur: Decimal | null;
}

/**
 * One open position per asset. Cost basis comes from FIFO lots pooled across accounts, so
 * it is only defined per asset; `accounts` says where the units are.
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
  /** Accounts with a non-zero quantity, by account id. */
  accounts: HoldingAccount[];
}

/** Open positions per asset as of `asOf`. Closed positions are omitted. */
export function computeHoldings(input: HoldingsInput): Holding[] {
  const { transactions, asOf, ca } = input;
  const assets = new Map(input.assets.map((a) => [a.id, a]));
  const { openLots } = runFifo(transactions, { asOf, caSubscriptions: ca?.subscriptions });

  const groups = new Map<string, Lot[]>();
  for (const lot of openLots) groups.set(lot.assetId, [...(groups.get(lot.assetId) ?? []), lot]);
  const perAccount = accountQuantities(transactions, asOf);

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

    const accounts = [...(perAccount.get(asset.id) ?? new Map<string, Decimal>())]
      .filter(([, q]) => !q.isZero())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([accountId, q]) => ({
        accountId,
        quantity: q,
        marketValueEur: marketValueEur ? marketValueEur.times(q).div(quantity) : null,
      }));

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
      accounts,
    });
  }

  return holdings.sort((a, b) => a.assetId.localeCompare(b.assetId));
}

/**
 * assetId -> accountId -> units acquired, minus units disposed, plus/minus units
 * transferred in/out. A transfer may not move more than the sending account holds.
 */
function accountQuantities(transactions: readonly Transaction[], asOf: IsoDate) {
  const result = new Map<string, Map<string, Decimal>>();
  for (const tx of prepareLedger(transactions, asOf)) {
    if (!tx.assetId || !tx.quantity) continue;
    const byAccount = result.get(tx.assetId) ?? new Map<string, Decimal>();
    result.set(tx.assetId, byAccount);
    const add = (accountId: string, delta: Decimal) =>
      byAccount.set(accountId, (byAccount.get(accountId) ?? ZERO).plus(delta));

    if (isAcquisition(tx.type)) add(tx.accountId, tx.quantity);
    else if (isDisposal(tx.type)) add(tx.accountId, tx.quantity.neg());
    else if (tx.type === 'transfer') {
      const available = byAccount.get(tx.accountId) ?? ZERO;
      if (tx.quantity.gt(available)) {
        throw new InsufficientHoldingsError(
          tx.id,
          tx.assetId,
          tx.quantity,
          available,
          tx.accountId,
        );
      }
      add(tx.accountId, tx.quantity.neg());
      add(tx.transferToAccountId as string, tx.quantity);
    }
  }
  return result;
}

/**
 * Returns a function valuing a certificado holding's lots, or null for a holding whose lots
 * are not all linked to a ca_subscriptions row (those fall back to the price lookup).
 */
function certificadoValuer(transactions: readonly Transaction[], asOf: IsoDate, ca: CaContext) {
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const subByTx = new Map(ca.subscriptions.map((s) => [s.transactionId, s]));
  const seriesById = new Map((ca.accrual?.series ?? []).map((s) => [s.id, s]));

  return (lots: Lot[]) => {
    const valued: CertificadoLotValuation[] = [];
    let total = ZERO;
    for (const lot of lots) {
      const sub = subByTx.get(lot.lotId);
      const tx = txById.get(lot.lotId);
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
