import { addDays, dec, type IsoDate, type Transaction } from '@ledgr/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AssetRecord } from './db';
import { HttpError, ProviderError } from './http';
import { runRecorded, type JobContext } from './jobs/common';
import { runFx } from './jobs/fx';
import { mergeRanges, runPrices } from './jobs/prices';
import { defaultSnapshotFrom, runSnapshots } from './jobs/snapshots';
import type { DailyBar, PriceProvider } from './providers';
import { fakeFetch, MemoryDb, noSleep } from './test/memory-db';

const d = dec;
let seq = 0;
const trade = (
  type: 'buy' | 'sell' | 'subscription',
  date: IsoDate,
  assetId: string,
  qty: string,
  price: string,
  id?: string,
): Transaction => ({
  id: id ?? `t${++seq}`,
  accountId: 'acc',
  assetId,
  type,
  tradeDate: date,
  quantity: d(qty),
  unitPrice: d(price),
  amount: null,
  fees: d('0'),
  currency: 'EUR',
  fxRateToEur: d('1'),
});

const asset = (id: string, over: Partial<AssetRecord> = {}): AssetRecord => ({
  id,
  name: id,
  ticker: id,
  isin: null,
  exchange: 'XNAS',
  assetType: 'stock',
  tradingCurrency: 'USD',
  priceSource: 'fake',
  priceSourceId: id,
  ...over,
});

/** A provider with a close of `price(symbol, date)` on every weekday. */
function fakeProvider(price: (symbol: string, date: IsoDate) => string | null = () => '10') {
  const calls: { symbol: string; from: IsoDate; to: IsoDate }[] = [];
  let failWith: Error | null = null;
  let splits: Record<string, string> = {};
  let currency: string | null = null;
  const provider: PriceProvider = {
    id: 'fake',
    minIntervalMs: 0,
    async fetchDaily(symbol, from, to) {
      calls.push({ symbol, from, to });
      if (failWith) throw failWith;
      const bars: DailyBar[] = [];
      for (let day = from; day <= to; day = addDays(day, 1)) {
        const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
        const close = price(symbol, day);
        if (weekday === 0 || weekday === 6 || close === null) continue;
        bars.push({ date: day, close, currency, splitFactor: splits[`${symbol}|${day}`] ?? null });
      }
      return bars;
    },
    async checkSymbol() {
      return { found: true, exchange: null, currency: null };
    },
  };
  return {
    provider,
    calls,
    fail: (e: Error | null) => (failWith = e),
    setSplits: (s: Record<string, string>) => (splits = s),
    setCurrency: (c: string | null) => (currency = c),
  };
}

function context(
  db: MemoryDb,
  provider: PriceProvider,
  today: IsoDate,
  fetch = fakeFetch([]).fetch,
): JobContext {
  return {
    db,
    http: { fetch, sleep: noSleep },
    providers: new Map([[provider.id, provider]]),
    today,
    trigger: 'script',
    staleAfterDays: 3,
    caMaxAgeDays: 35,
    now: () => new Date(`${today}T05:00:00Z`),
  };
}

describe('runFx', () => {
  const csv = (rows: [string, string][]) =>
    ['KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE']
      .concat(rows.map(([date, v]) => `EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,${date},${v}`))
      .join('\n');

  it('backfills from 14 days before 2021-01-01, stores EUR per USD, and is idempotent', async () => {
    const db = new MemoryDb();
    db.assets = [asset('AAPL'), asset('VWCE', { tradingCurrency: 'EUR', exchange: 'XETR' })];
    db.transactions = [trade('buy', '2021-01-01', 'AAPL', '1', '100')];
    const { fetch, calls } = fakeFetch([
      [
        /D\.USD\.EUR/,
        () =>
          new Response(
            csv([
              ['2020-12-31', '1.2271'],
              ['2021-01-04', '1.25'],
            ]),
          ),
      ],
    ]);
    const ctx = context(db, fakeProvider().provider, '2021-01-05', fetch);
    const first = await runFx(ctx);
    expect(first).toMatchObject({ status: 'ok', counts: { currencies: 1, rows: 2, failed: 0 } });
    expect(calls[0]?.url).toContain('startPeriod=2020-12-18&endPeriod=2021-01-05');
    expect(db.fx.get('USD|2021-01-04')?.rateToEur.toString()).toBe('0.8');
    expect(db.fx.get('USD|2021-01-04')?.source).toBe('ecb');
    // daily: re-reads the last 7 days from the newest stored rate
    const again = await runFx({ ...ctx, today: '2021-01-06' });
    expect(again.status).toBe('ok');
    expect(calls[1]?.url).toContain('startPeriod=2020-12-28&endPeriod=2021-01-06');
    expect(db.fx.size).toBe(2);
  });

  it('reports a failed currency as an issue with the status only', async () => {
    const db = new MemoryDb();
    db.assets = [asset('AAPL')];
    const { fetch } = fakeFetch([[/ecb/, () => new Response('', { status: 400 })]]);
    const out = await runFx(context(db, fakeProvider().provider, '2024-01-05', fetch));
    expect(out).toMatchObject({
      status: 'failed',
      issues: [{ code: 'http_error', provider: 'ecb', status: 400 }],
    });
  });
});

describe('runPrices', () => {
  let db: MemoryDb;
  beforeEach(() => {
    db = new MemoryDb();
    db.assets = [
      asset('A'),
      asset('B'),
      asset('E', {
        assetType: 'certificado_aforro',
        priceSource: 'ca_factors',
        priceSourceId: null,
      }),
      asset('M', { priceSource: 'manual', priceSourceId: null }),
    ];
    db.transactions = [
      trade('buy', '2024-01-01', 'A', '10', '100'),
      trade('buy', '2024-02-01', 'B', '5', '50'),
      trade('sell', '2024-03-01', 'B', '5', '60'),
      trade('subscription', '2024-01-01', 'E', '1000', '1'),
      trade('buy', '2024-01-01', 'M', '1', '1'),
    ];
  });

  it('backfills only the days each asset was held, from 14 days before', async () => {
    const fake = fakeProvider();
    const out = await runPrices(context(db, fake.provider, '2024-04-02'), { mode: 'backfill' });
    expect(fake.calls).toEqual([
      { symbol: 'A', from: '2023-12-18', to: '2024-04-01' },
      { symbol: 'B', from: '2024-01-18', to: '2024-03-01' },
    ]);
    expect(out.status).toBe('ok');
    expect(out.counts).toMatchObject({ assets: 2, requests: 2, unpriced: 1, stale: 0, failed: 0 });
    expect(out.issues).toEqual([{ code: 'no_price_source', assetId: 'M', provider: 'manual' }]);
    expect([...db.prices.values()].every((p) => p.currency === 'USD' && p.source === 'fake')).toBe(
      true,
    );

    // re-run: ranges already stored are skipped, nothing is fetched twice
    const again = await runPrices(context(db, fake.provider, '2024-04-02'), { mode: 'backfill' });
    expect(fake.calls).toHaveLength(2);
    expect(again.counts.skipped).toBe(2);
    await runPrices(context(db, fake.provider, '2024-04-02'), { mode: 'backfill', refetch: true });
    expect(fake.calls).toHaveLength(4);
  });

  it('daily: only assets held lately, from the day after the newest close (last 5 days re-read)', async () => {
    const fake = fakeProvider();
    await runPrices(context(db, fake.provider, '2024-04-02'), { mode: 'backfill' });
    fake.calls.length = 0;
    const out = await runPrices(context(db, fake.provider, '2024-04-10'), { mode: 'daily' });
    expect(fake.calls).toEqual([{ symbol: 'A', from: '2024-04-02', to: '2024-04-09' }]);
    expect(out.counts.stale).toBe(0);
    fake.calls.length = 0;
    await runPrices(context(db, fake.provider, '2024-04-11'), { mode: 'daily' });
    expect(fake.calls).toEqual([{ symbol: 'A', from: '2024-04-05', to: '2024-04-10' }]);
  });

  it('a missing price flags the asset stale instead of failing (after 3 days)', async () => {
    const fake = fakeProvider((_s, day) => (day <= '2024-03-27' ? '10' : null));
    const out = await runPrices(context(db, fake.provider, '2024-04-02'), { mode: 'backfill' });
    expect(out.status).toBe('ok');
    expect(out.counts.stale).toBe(1);
    expect(out.issues).toContainEqual({ code: 'stale', assetId: 'A', date: '2024-03-27' });
  });

  it('records splits, refuses a currency mismatch, and stops a provider after a rate limit', async () => {
    const fake = fakeProvider();
    fake.setSplits({ 'A|2024-02-05': '20' });
    const out = await runPrices(context(db, fake.provider, '2024-04-02'), { mode: 'backfill' });
    expect(out.issues).toContainEqual({ code: 'split', assetId: 'A', date: '2024-02-05' });
    expect(db.prices.get('A|2024-02-05')?.splitFactor?.toString()).toBe('20');

    const db2 = new MemoryDb();
    db2.assets = db.assets;
    db2.transactions = db.transactions;
    fake.setCurrency('EUR');
    const mismatch = await runPrices(context(db2, fake.provider, '2024-04-02'), {
      mode: 'backfill',
    });
    expect(mismatch.issues).toContainEqual({
      code: 'currency_mismatch',
      assetId: 'A',
      provider: 'fake',
    });
    expect(db2.prices.size).toBe(0);

    fake.setCurrency(null);
    fake.fail(new ProviderError('fake', 'rate_limited'));
    fake.calls.length = 0;
    const limited = await runPrices(context(db2, fake.provider, '2024-04-02'), {
      mode: 'backfill',
    });
    expect(fake.calls).toHaveLength(1); // B is not attempted after A's rate limit
    expect(limited.status).toBe('partial');
    expect(limited.issues).toContainEqual({ code: 'rate_limited', assetId: 'A', provider: 'fake' });
    expect(limited.issues).toContainEqual({ code: 'rate_limited', assetId: 'B', provider: 'fake' });
  });

  it('turns HTTP errors into issues with status only', async () => {
    const fake = fakeProvider();
    fake.fail(new HttpError('fake', 500));
    const out = await runPrices(context(db, fake.provider, '2024-04-02'), { mode: 'backfill' });
    expect(out.issues).toContainEqual({
      code: 'http_error',
      provider: 'fake',
      status: 500,
      assetId: 'A',
    });
  });

  it('merges overlapping ranges', () => {
    expect(
      mergeRanges([
        { from: '2024-01-10', to: '2024-02-01' },
        { from: '2024-01-01', to: '2024-01-05' },
        { from: '2024-01-06', to: '2024-01-08' },
      ]),
    ).toEqual([
      { from: '2024-01-01', to: '2024-01-08' },
      { from: '2024-01-10', to: '2024-02-01' },
    ]);
  });
});

describe('runSnapshots', () => {
  function seed() {
    const db = new MemoryDb();
    db.assets = [
      asset('A'),
      asset('V', { tradingCurrency: 'EUR', exchange: 'XETR', assetType: 'etf' }),
      asset('E', {
        assetType: 'certificado_aforro',
        tradingCurrency: 'EUR',
        priceSource: 'ca_factors',
        priceSourceId: null,
      }),
    ];
    db.transactions = [
      trade('buy', '2024-01-01', 'A', '10', '100'),
      trade('buy', '2024-01-01', 'V', '4', '50'),
      trade('subscription', '2024-01-01', 'E', '1000', '1', 'sub1'),
    ];
    db.subscriptions = [{ id: 'c1', seriesId: 'S', transactionId: 'sub1' }];
    db.factors = [{ subscriptionId: 'c1', month: '2024-02-01', factor: d('1.01') }];
    for (let day = '2023-12-20'; day <= '2024-03-31'; day = addDays(day, 1)) {
      db.prices.set(`A|${day}`, {
        assetId: 'A',
        date: day,
        close: d('125'),
        currency: 'USD',
        splitFactor: null,
        source: 'fake',
      });
      db.fx.set(`USD|${day}`, { currency: 'USD', date: day, rateToEur: d('0.8'), source: 'ecb' });
    }
    return db;
  }

  it('writes one row per day with values, net invested and flags', async () => {
    const db = seed();
    const out = await runSnapshots(context(db, fakeProvider().provider, '2024-03-02'), {
      from: '2024-01-01',
    });
    expect(out.counts).toMatchObject({ days: 61, written: 61, skipped: 0 });
    const row = db.snapshots.get('2024-03-01') as Record<string, unknown>;
    // A 10 * 125 USD * 0.8 = 1000; V has no price: last trade 4 * 50 = 200 (flagged); CA 1000 * 1.01
    expect(row.stock_value_eur).toBe('1000');
    expect(row.etf_value_eur).toBe('200');
    expect(row.certificado_aforro_value_eur).toBe('1010');
    expect(row.total_value_eur).toBe('2210');
    expect(row.net_contributions_eur).toBe('2200');
    expect(row.cash_eur).toBeNull();
    expect(row.stale).toBe(true);
    expect(row.ca_value_source).toBe('factor');
    expect(row.ca_value_age_days).toBe(29);
    expect(row.valuation_flags).toContainEqual({
      asset_id: 'V',
      source: 'trade',
      as_of: '2024-01-01',
      age_days: 60,
      stale: true,
    });
    expect((db.snapshots.get('2024-01-15') as Record<string, unknown>).ca_value_source).toBe(
      'subscription',
    );
  });

  it('is deterministic and idempotent', async () => {
    const db = seed();
    const ctx = context(db, fakeProvider().provider, '2024-03-02');
    await runSnapshots(ctx, { from: '2024-01-01' });
    const first = JSON.stringify([...db.snapshots.entries()]);
    await runSnapshots(ctx, { from: '2024-01-01' });
    expect(JSON.stringify([...db.snapshots.entries()])).toBe(first);
    expect(db.snapshots.size).toBe(61);
  });

  it('daily window: from the 1st of the previous month to yesterday', async () => {
    expect(defaultSnapshotFrom('2024-03-15')).toBe('2024-02-01');
    expect(defaultSnapshotFrom('2024-01-31')).toBe('2023-12-01');
    const db = seed();
    const out = await runSnapshots(context(db, fakeProvider().provider, '2024-03-16'));
    expect(out.counts.days).toBe(44); // 2024-02-01 .. 2024-03-15
    expect([...db.snapshots.keys()].sort()[0]).toBe('2024-02-01');
  });

  it('skips a day without an FX rate and reports it, never failing the run', async () => {
    const db = seed();
    for (const k of [...db.fx.keys()]) if (k < 'USD|2024-01-10') db.fx.delete(k);
    const out = await runSnapshots(context(db, fakeProvider().provider, '2024-01-12'), {
      from: '2024-01-01',
    });
    expect(out.status).toBe('partial');
    expect(out.counts).toMatchObject({ days: 11, written: 2, skipped: 9 });
    expect(out.issues[0]).toEqual({ code: 'missing_fx', date: '2024-01-01' });
  });

  it('uses split-adjusted closes for post-split ledger units', async () => {
    const db = seed();
    for (const k of [...db.prices.keys()]) {
      const p = db.prices.get(k)!;
      if (p.date < '2024-02-05') db.prices.set(k, { ...p, close: d('2500') });
    }
    db.prices.set('A|2024-02-05', { ...db.prices.get('A|2024-02-05')!, splitFactor: d('20') });
    await runSnapshots(context(db, fakeProvider().provider, '2024-02-07'), { from: '2024-02-01' });
    expect((db.snapshots.get('2024-02-02') as Record<string, unknown>).stock_value_eur).toBe(
      '1000',
    );
    expect((db.snapshots.get('2024-02-06') as Record<string, unknown>).stock_value_eur).toBe(
      '1000',
    );
  });
});

describe('runRecorded', () => {
  it('records the run; a thrown error becomes a failed run with its class only', async () => {
    const db = new MemoryDb();
    const ctx = context(db, fakeProvider().provider, '2024-01-02');
    const run = await runRecorded(ctx, 'fx', async () => {
      throw new Error('price 123.45 leaked');
    });
    expect(run).toMatchObject({
      job: 'fx',
      trigger: 'script',
      status: 'failed',
      issues: [{ code: 'Error' }],
    });
    expect(JSON.stringify(db.runs)).not.toContain('123.45');
    expect(db.runs).toHaveLength(1);
  });
});
