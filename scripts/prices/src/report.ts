// Report files (git-ignored prices-data/reports/...). Per-asset detail lives here only,
// never on the console.
import {
  computeHoldings,
  createCaFactorLookup,
  createFxLookup,
  createPriceLookup,
  sanityReport,
  splitAdjustPrices,
  type IsoDate,
  type SanityReport,
} from '@ledgr/core';
import type { AssetRecord, JobRunRecord, JobsDb, SymbolResolution } from '@ledgr/market';

export interface ReportFile {
  name: string;
  content: string;
}

function cell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return '\uFEFF' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const byId = (assets: readonly AssetRecord[]) => new Map(assets.map((a) => [a.id, a]));

export function symbolsReport(
  assets: readonly AssetRecord[],
  res: readonly SymbolResolution[],
): ReportFile {
  const a = byId(assets);
  return {
    name: 'symbols.csv',
    content: csv(
      [
        'ticker',
        'name',
        'type',
        'isin',
        'exchange',
        'status',
        'price_symbol',
        'listing_currency',
        'provider_exchange',
        'reason',
        'warnings',
      ],
      res.map((r) => {
        const asset = a.get(r.assetId);
        return [
          r.ticker,
          asset?.name,
          asset?.assetType,
          asset?.isin,
          asset?.exchange,
          r.status,
          r.source ? `${r.source}:${r.symbol}` : '',
          r.listingCurrency,
          r.providerExchange,
          r.reason,
          r.warnings.join(' | '),
        ];
      }),
    ),
  };
}

export function issuesReport(
  assets: readonly AssetRecord[],
  runs: readonly JobRunRecord[],
): ReportFile {
  const a = byId(assets);
  return {
    name: 'issues.csv',
    content: csv(
      ['job', 'status', 'code', 'ticker', 'date', 'provider', 'http_status'],
      runs.flatMap((run) =>
        run.issues.map((i) => [
          run.job,
          run.status,
          i.code,
          i.assetId ? (a.get(i.assetId)?.ticker ?? i.assetId) : '',
          i.date,
          i.provider,
          i.status,
        ]),
      ),
    ),
  };
}

/** Value-to-cost per open position on `asOf`, from stored prices, rates and factors. */
export async function buildSanity(
  db: JobsDb,
  asOf: IsoDate,
): Promise<{ report: SanityReport; file: ReportFile }> {
  const [assets, transactions, ca, prices, fx] = await Promise.all([
    db.loadAssets(),
    db.loadTransactions(),
    db.loadCa(),
    db.loadPrices(),
    db.loadFx(),
  ]);
  const holdings = computeHoldings({
    transactions,
    assets: assets.map((x) => ({
      id: x.id,
      assetType: x.assetType,
      tradingCurrency: x.tradingCurrency,
    })),
    asOf,
    prices: createPriceLookup(splitAdjustPrices(prices.filter((p) => p.date <= asOf))),
    fx: createFxLookup(fx),
    ca: { subscriptions: ca.subscriptions, factors: createCaFactorLookup(ca.factors) },
  });
  const report = sanityReport(holdings);
  const a = byId(assets);
  const splits = new Map<string, string[]>();
  for (const p of prices) {
    if (p.splitFactor)
      splits.set(p.assetId, [
        ...(splits.get(p.assetId) ?? []),
        `${p.date} x${p.splitFactor.toString()}`,
      ]);
  }
  const fxRate = new Map(
    holdings.map((h) => [
      h.assetId,
      h.valuation.kind === 'price' ? h.valuation.fxRateToEur.toString() : '',
    ]),
  );
  const file: ReportFile = {
    name: 'sanity.csv',
    content: csv(
      [
        'ticker',
        'name',
        'type',
        'units',
        'price_date',
        'close_split_adjusted',
        'price_currency',
        'fx_rate_to_eur',
        'value_eur',
        'cost_basis_eur',
        'value_to_cost',
        'flag',
        'provider_splits',
        'price_source',
      ],
      report.rows.map((r) => {
        const asset = a.get(r.assetId);
        return [
          asset?.ticker,
          asset?.name,
          r.assetType,
          r.quantity.toString(),
          r.price?.date,
          r.price?.close.toDecimalPlaces(6).toString(),
          r.price?.currency,
          fxRate.get(r.assetId),
          r.marketValueEur?.toDecimalPlaces(2).toString() ?? '',
          r.costBasisEur.toDecimalPlaces(2).toString(),
          r.ratio?.toDecimalPlaces(4).toString() ?? '',
          r.outlier === 'high'
            ? 'CHECK: value above 5x cost (split or currency?)'
            : r.outlier === 'low'
              ? 'CHECK: value below 0.2x cost (split or currency?)'
              : r.marketValueEur
                ? ''
                : 'CHECK: no price',
          (splits.get(r.assetId) ?? []).join(' '),
          asset
            ? `${asset.priceSource}${asset.priceSourceId ? `:${asset.priceSourceId}` : ''}`
            : '',
        ];
      }),
    ),
  };
  return { report, file };
}
