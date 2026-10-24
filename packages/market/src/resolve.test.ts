import { addDays, dec, type IsoDate, type Transaction } from '@ledgr/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AssetRecord } from './db';
import type { JobContext } from './jobs/common';
import { runPrices } from './jobs/prices';
import { resolutionCandidates } from './jobs/resolve';
import type { DailyBar, PriceProvider, SymbolCheck } from './providers';
import { fakeFetch, jsonResponse, MemoryDb, noSleep } from './test/memory-db';

let seq = 0;
const buy = (date: IsoDate, assetId: string): Transaction => ({
  id: `t${++seq}`,
  accountId: 'acc',
  assetId,
  type: 'buy',
  tradeDate: date,
  quantity: dec('1'),
  unitPrice: dec('10'),
  amount: null,
  fees: dec('0'),
  currency: 'EUR',
  fxRateToEur: dec('1'),
});

const asset = (id: string, over: Partial<AssetRecord> = {}): AssetRecord => ({
  id,
  name: id,
  ticker: id,
  isin: null,
  exchange: 'XNAS',
  assetType: 'stock',
  tradingCurrency: 'USD',
  priceSource: 'tiingo',
  priceSourceId: id,
  ...over,
});

/** Added in the app: Apple on Nasdaq, no symbol yet ("price pending"). */
const PENDING = asset('NEW', {
  ticker: 'AAPL',
  isin: 'US0378331005',
  priceSource: 'manual',
  priceSourceId: null,
});

/** Tiingo stand-in: a close of 10 every weekday; `known` symbols pass checkSymbol. */
function fakeTiingo(known: string[] = ['AAPL']) {
  const calls: { symbol: string; from: IsoDate; to: IsoDate }[] = [];
  const checks: string[] = [];
  const provider: PriceProvider = {
    id: 'tiingo',
    minIntervalMs: 0,
    async fetchDaily(symbol, from, to) {
      calls.push({ symbol, from, to });
      const bars: DailyBar[] = [];
      for (let day = from; day <= to; day = addDays(day, 1)) {
        const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
        if (weekday !== 0 && weekday !== 6)
          bars.push({ date: day, close: '10', currency: null, splitFactor: null });
      }
      return bars;
    },
    async checkSymbol(symbol): Promise<SymbolCheck> {
      checks.push(symbol);
      return { found: known.includes(symbol), exchange: 'NASDAQ', currency: null };
    },
    liveTtlMs: 0,
    async fetchLatest() {
      return [];
    },
  };
  return { provider, calls, checks };
}

const figiAnswers = (tickers: string[]) => () =>
  jsonResponse([{ data: tickers.map((ticker) => ({ ticker, name: 'APPLE INC' })) }]);

const TODAY = '2024-04-10';

function context(db: MemoryDb, provider: PriceProvider, fetch = fakeFetch([]).fetch): JobContext {
  return {
    db,
    http: { fetch, sleep: noSleep },
    providers: new Map([[provider.id, provider]]),
    today: TODAY,
    trigger: 'cron',
    staleAfterDays: 3,
    caMaxAgeDays: 35,
    now: () => new Date(`${TODAY}T05:25:00Z`),
  };
}

describe('prices-daily: symbol resolution', () => {
  let db: MemoryDb;
  beforeEach(() => {
    db = new MemoryDb();
    db.assets = [asset('OLD'), { ...PENDING }];
    db.transactions = [buy('2024-01-02', 'OLD'), buy('2024-03-20', 'NEW')];
  });
  const fetchedSymbols = (calls: { symbol: string }[]) => calls.map((c) => c.symbol).sort();

  it('resolves an app-added asset, writes its symbol and fetches its closes in the same run', async () => {
    const tiingo = fakeTiingo();
    const { fetch, calls } = fakeFetch([[/openfigi/, figiAnswers(['AAPL'])]]);
    const out = await runPrices(context(db, tiingo.provider, fetch), {
      mode: 'daily',
      resolve: {},
    });

    expect(db.assets.find((a) => a.id === 'NEW')).toMatchObject({
      priceSource: 'tiingo',
      priceSourceId: 'AAPL',
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual([
      { idType: 'ID_ISIN', idValue: 'US0378331005', exchCode: 'US' },
    ]);
    expect(tiingo.checks).toEqual(['AAPL']);
    // from 14 days before its first buy
    expect(tiingo.calls.find((c) => c.symbol === 'AAPL')).toEqual({
      symbol: 'AAPL',
      from: '2024-03-06',
      to: '2024-04-09',
    });
    expect(fetchedSymbols(tiingo.calls)).toEqual(['AAPL', 'OLD']);
    expect(out.status).toBe('ok');
    expect(out.counts).toMatchObject({ resolve_candidates: 1, resolved: 1, unresolved: 0 });
    expect(out.issues).toContainEqual({
      code: 'symbol_resolved',
      assetId: 'NEW',
      provider: 'tiingo',
    });
    expect(out.issues.some((i) => i.code === 'no_price_source')).toBe(false);
  });

  it('OpenFIGI down: the asset stays pending, the others are fetched, the run is partial', async () => {
    const tiingo = fakeTiingo();
    const { fetch } = fakeFetch([[/openfigi/, () => new Response('down', { status: 503 })]]);
    const out = await runPrices(context(db, tiingo.provider, fetch), {
      mode: 'daily',
      resolve: {},
    });

    expect(db.assets.find((a) => a.id === 'NEW')?.priceSource).toBe('manual');
    expect(fetchedSymbols(tiingo.calls)).toEqual(['OLD']);
    expect(out.status).toBe('partial');
    expect(out.counts).toMatchObject({
      resolved: 0,
      unresolved: 1,
      failed: 0,
      rows: expect.any(Number),
    });
    expect(out.issues).toContainEqual({
      code: 'unresolved',
      assetId: 'NEW',
      reason: 'OpenFIGI failed (openfigi: HTTP 503)',
    });
    expect(out.issues).toContainEqual({
      code: 'no_price_source',
      assetId: 'NEW',
      provider: 'manual',
    });
  });

  it('the provider does not know the symbol: unresolved with the reason, nothing guessed', async () => {
    const tiingo = fakeTiingo([]);
    const { fetch } = fakeFetch([[/openfigi/, figiAnswers(['AAPL'])]]);
    const out = await runPrices(context(db, tiingo.provider, fetch), {
      mode: 'daily',
      resolve: {},
    });

    expect(db.assets.find((a) => a.id === 'NEW')?.priceSourceId).toBeNull();
    expect(fetchedSymbols(tiingo.calls)).toEqual(['OLD']);
    expect(out.status).toBe('partial');
    expect(out.issues).toContainEqual({
      code: 'unresolved',
      assetId: 'NEW',
      reason: 'tiingo does not know AAPL',
    });
  });

  it('a throwing resolver, a hanging one, or a failed write never stops the price run', async () => {
    for (const resolve of [
      {
        resolver: async () => {
          throw new TypeError('boom');
        },
      },
      { resolver: () => new Promise<never>(() => undefined), timeoutMs: 5 },
    ]) {
      const tiingo = fakeTiingo();
      const out = await runPrices(context(db, tiingo.provider), { mode: 'daily', resolve });
      expect(fetchedSymbols(tiingo.calls)).toEqual(['OLD']);
      expect(out.status).toBe('partial');
      expect(out.counts.unresolved).toBe(1);
      expect(out.issues[0]).toEqual(
        'timeoutMs' in resolve
          ? { code: 'resolve_timeout', assetId: 'NEW' }
          : { code: 'TypeError', assetId: 'NEW' },
      );
    }

    db.setPriceSymbol = async () => {
      throw new Error('db down');
    };
    const tiingo = fakeTiingo();
    const { fetch } = fakeFetch([[/openfigi/, figiAnswers(['AAPL'])]]);
    const out = await runPrices(context(db, tiingo.provider, fetch), {
      mode: 'daily',
      resolve: {},
    });
    expect(fetchedSymbols(tiingo.calls)).toEqual(['OLD']);
    expect(out.status).toBe('partial');
    expect(out.issues[0]).toEqual({ code: 'Error', assetId: 'NEW' });
  });

  it('only the daily run with `resolve` resolves (not the backfill, not without it)', async () => {
    const tiingo = fakeTiingo();
    const { fetch, calls } = fakeFetch([[/openfigi/, figiAnswers(['AAPL'])]]);
    await runPrices(context(db, tiingo.provider, fetch), { mode: 'backfill', resolve: {} });
    await runPrices(context(db, tiingo.provider, fetch), { mode: 'daily' });
    expect(calls).toHaveLength(0);
    expect(tiingo.checks).toEqual([]);
  });
});

describe('resolutionCandidates', () => {
  const pending = (id: string, over: Partial<AssetRecord> = {}) =>
    asset(id, { isin: 'US0378331005', priceSource: 'manual', priceSourceId: null, ...over });

  it('manual, held, not a certificado, with the ISIN and exchange the resolver needs', () => {
    const assets = [
      pending('a'),
      pending('sold'),
      pending('never-bought'),
      pending('no-isin', { isin: null }),
      pending('lse', { exchange: 'XLON' }),
      pending('btc', { assetType: 'crypto', ticker: 'BTCEUR', exchange: null, isin: null }),
      pending('ca', { assetType: 'certificado_aforro' }),
      asset('priced'),
    ];
    const txs = ['a', 'sold', 'no-isin', 'lse', 'btc', 'ca', 'priced'].map((id) =>
      buy('2024-01-02', id),
    );
    txs.push({ ...buy('2024-02-01', 'sold'), type: 'sell' });
    const { picked, waiting } = resolutionCandidates(assets, txs, TODAY);
    expect(picked.map((a) => a.id)).toEqual(['a', 'btc']);
    expect(waiting).toBe(0);
  });

  it('at most 5 per run, rotating by day so every asset gets its turn', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const assets = ids.map((id) => pending(id));
    const txs = ids.map((id) => buy('2024-01-02', id));
    const seen = new Set<string>();
    for (const day of [TODAY, addDays(TODAY, 1)]) {
      const { picked, waiting } = resolutionCandidates(assets, txs, day);
      expect(picked).toHaveLength(5);
      expect(waiting).toBe(2);
      picked.forEach((a) => seen.add(a.id));
    }
    expect([...seen].sort()).toEqual(ids);
  });
});
