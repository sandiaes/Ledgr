// Reconciliation after the import: what the ledger will hold, from every accepted row
// (rows inserted now plus rows already imported). CA values come from @ledgr/core, so they
// are exactly what the app computes.
import {
  computeHoldings,
  createCaFactorLookup,
  createFxLookup,
  createPriceLookup,
  Decimal,
  type AssetType,
  type IsoDate,
  type Transaction,
} from '@ledgr/core';
import type { HoldingRecord } from './inputs';
import type { ImportPlan } from './plan';

export interface PositionLine {
  account: string;
  ticker: string;
  assetType: AssetType;
  units: Decimal;
  /** Sum of Units x Order Price (sells negative): the cost the ledger records, no fees. */
  netInvestedEur: Decimal;
  /** Sum of the Excel's Order Value, for comparison. */
  excelOrderValueEur: Decimal;
}

export interface TypeLine {
  assetType: AssetType;
  netInvestedEur: Decimal;
  excelOrderValueEur: Decimal;
}

export interface CaLine {
  series: string;
  month: IsoDate;
  units: Decimal;
  factorMonth: IsoDate | null;
  factor: Decimal;
  valueEur: Decimal;
  source: string;
}

export interface HoldingsDiffLine {
  ticker: string;
  ledgerUnits: Decimal | null;
  sheetUnits: Decimal | null;
  difference: Decimal | null;
  status: 'match' | 'different' | 'missing in sheet' | 'missing in ledger';
}

export interface Reconciliation {
  positions: PositionLine[];
  byType: TypeLine[];
  ca: CaLine[];
  totals: { netInvestedEur: Decimal; excelOrderValueEur: Decimal; caValueEur: Decimal };
  holdingsDiff: HoldingsDiffLine[] | null;
}

const zero = () => new Decimal(0);

export function reconcile(
  plan: ImportPlan,
  ratioMonth: IsoDate | null,
  holdings: readonly HoldingRecord[] | null,
): Reconciliation {
  const positions = new Map<string, PositionLine>();
  for (const r of plan.rows) {
    const k = `${r.account}|${r.ticker}`;
    const p = positions.get(k) ?? {
      account: r.account,
      ticker: r.ticker,
      assetType: r.assetType,
      units: zero(),
      netInvestedEur: zero(),
      excelOrderValueEur: zero(),
    };
    p.units = p.units.plus(r.units);
    p.netInvestedEur = p.netInvestedEur.plus(r.units.times(r.price));
    p.excelOrderValueEur = p.excelOrderValueEur.plus(r.value);
    positions.set(k, p);
  }
  for (const c of plan.ca) {
    const k = `${c.account}|${c.series}`;
    const p = positions.get(k) ?? {
      account: c.account,
      ticker: c.series,
      assetType: 'certificado_aforro' as const,
      units: zero(),
      netInvestedEur: zero(),
      excelOrderValueEur: zero(),
    };
    p.units = p.units.plus(c.units);
    p.netInvestedEur = p.netInvestedEur.plus(c.units);
    p.excelOrderValueEur = p.excelOrderValueEur.plus(c.units);
    positions.set(k, p);
  }
  const positionList = [...positions.values()].sort(
    (a, b) => a.account.localeCompare(b.account) || a.ticker.localeCompare(b.ticker),
  );

  const byType = new Map<AssetType, TypeLine>();
  for (const p of positionList) {
    const t = byType.get(p.assetType) ?? {
      assetType: p.assetType,
      netInvestedEur: zero(),
      excelOrderValueEur: zero(),
    };
    t.netInvestedEur = t.netInvestedEur.plus(p.netInvestedEur);
    t.excelOrderValueEur = t.excelOrderValueEur.plus(p.excelOrderValueEur);
    byType.set(p.assetType, t);
  }

  const ca = caValues(plan, ratioMonth);
  const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.plus(x), zero());
  return {
    positions: positionList,
    byType: [...byType.values()].sort((a, b) => a.assetType.localeCompare(b.assetType)),
    ca,
    totals: {
      netInvestedEur: sum(positionList.map((p) => p.netInvestedEur)),
      excelOrderValueEur: sum(positionList.map((p) => p.excelOrderValueEur)),
      caValueEur: sum(ca.map((c) => c.valueEur)),
    },
    holdingsDiff: holdings ? diffHoldings(positionList, holdings) : null,
  };
}

/** units x latest factor on or before the ratio month, per subscription, via core. */
function caValues(plan: ImportPlan, ratioMonth: IsoDate | null): CaLine[] {
  if (plan.ca.length === 0) return [];
  const id = (c: ImportPlan['ca'][number]) => `${c.series}|${c.month}`;
  const transactions: Transaction[] = plan.ca.map((c) => ({
    id: id(c),
    accountId: c.account,
    assetId: c.series,
    type: 'subscription',
    tradeDate: c.month,
    quantity: c.units,
    unitPrice: new Decimal(1),
    amount: null,
    fees: zero(),
    currency: 'EUR',
    fxRateToEur: new Decimal(1),
  }));
  const factors = plan.ca.flatMap((c) =>
    c.factor && ratioMonth ? [{ subscriptionId: id(c), month: ratioMonth, factor: c.factor }] : [],
  );
  const asOf = [ratioMonth, ...plan.ca.map((c) => c.month)]
    .filter((d): d is IsoDate => d !== null)
    .sort()
    .at(-1) as IsoDate;
  const holdings = computeHoldings({
    transactions,
    assets: [...new Set(plan.ca.map((c) => c.series))].map((s) => ({
      id: s,
      assetType: 'certificado_aforro',
      tradingCurrency: 'EUR',
    })),
    asOf,
    prices: createPriceLookup([]),
    fx: createFxLookup([]),
    ca: {
      subscriptions: plan.ca.map((c) => ({ id: id(c), seriesId: c.series, transactionId: id(c) })),
      factors: createCaFactorLookup(factors),
    },
  });
  const lots = new Map(
    holdings
      .flatMap((h) => (h.valuation.kind === 'certificado' ? h.valuation.lots : []))
      .map((l) => [l.lotId, l]),
  );
  return plan.ca.map((c) => {
    const lot = lots.get(id(c));
    const factor = lot?.unitValue ?? new Decimal(1);
    return {
      series: c.series,
      month: c.month,
      units: c.units,
      factorMonth: lot?.factorMonth ?? null,
      factor,
      valueEur: c.units.times(factor),
      source: lot?.source ?? 'subscription',
    };
  });
}

function diffHoldings(
  positions: readonly PositionLine[],
  sheet: readonly HoldingRecord[],
): HoldingsDiffLine[] {
  const ledger = new Map<string, Decimal>();
  for (const p of positions) ledger.set(p.ticker, (ledger.get(p.ticker) ?? zero()).plus(p.units));
  const theirs = new Map<string, Decimal>();
  for (const h of sheet) theirs.set(h.ticker, (theirs.get(h.ticker) ?? zero()).plus(h.units.value));
  const tickers = [...new Set([...ledger.keys(), ...theirs.keys()])].sort();
  return tickers.flatMap((ticker): HoldingsDiffLine[] => {
    const l = ledger.get(ticker) ?? null;
    const s = theirs.get(ticker) ?? null;
    if (l && s) {
      const difference = l.minus(s);
      return [
        {
          ticker,
          ledgerUnits: l,
          sheetUnits: s,
          difference,
          status: difference.isZero() ? 'match' : 'different',
        },
      ];
    }
    if (l)
      return l.isZero()
        ? []
        : [
            {
              ticker,
              ledgerUnits: l,
              sheetUnits: null,
              difference: null,
              status: 'missing in sheet',
            },
          ];
    return [
      {
        ticker,
        ledgerUnits: null,
        sheetUnits: s,
        difference: null,
        status: s?.isZero() ? 'match' : 'missing in ledger',
      },
    ];
  });
}
