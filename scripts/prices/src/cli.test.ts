import { addDays, dec, type Transaction } from '@ledgr/core';
import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonResponse, MemoryDb } from '../../../packages/market/src/test/memory-db';
import { parseArgs, run, type CliDeps } from './cli';

const REF = 'abcdefghijklmnopqrst';
const ENV = [
  `SUPABASE_URL=https://${REF}.supabase.co`,
  'SUPABASE_SERVICE_ROLE_KEY=sb_secret_0123456789abcdefghijklmnop',
  'LEDGR_USER_ID=11111111-2222-4333-8444-555555555555',
  'TIINGO_API_KEY=tk',
].join('\n');

const tx = (
  type: 'buy' | 'subscription',
  date: string,
  assetId: string,
  qty: string,
  price: string,
  id: string,
): Transaction => ({
  id,
  accountId: 'acc',
  assetId,
  type,
  tradeDate: date,
  quantity: dec(qty),
  unitPrice: dec(price),
  amount: null,
  fees: dec('0'),
  currency: 'EUR',
  fxRateToEur: dec('1'),
});

function seed() {
  const db = new MemoryDb();
  db.assets = [
    {
      id: 'btc',
      name: 'Bitcoin',
      ticker: 'BTCEUR',
      isin: null,
      exchange: null,
      assetType: 'crypto',
      tradingCurrency: 'EUR',
      priceSource: 'coinbase',
      priceSourceId: 'BTC-EUR',
    },
    {
      id: 'aapl',
      name: 'Apple',
      ticker: 'AAPL',
      isin: 'US0378331005',
      exchange: 'XNAS',
      assetType: 'stock',
      tradingCurrency: 'USD',
      priceSource: 'manual',
      priceSourceId: null,
    },
  ];
  db.transactions = [
    tx('buy', '2024-01-01', 'btc', '0.5', '40000', 't1'),
    tx('buy', '2024-01-01', 'aapl', '10', '150', 't2'),
  ];
  return db;
}

function harness(
  db: MemoryDb,
  answer = REF,
  envText: string | null = ENV,
  inputs = new Map<string, string>(),
) {
  const out: string[] = [];
  const files = new Map<string, string>();
  const day = (iso: string) =>
    Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
  const { fetch, calls } = fakeFetch([
    [
      /candles/,
      (url) => {
        const start = /start=(\d{4}-\d{2}-\d{2})/.exec(url)?.[1] as string;
        const end = /end=(\d{4}-\d{2}-\d{2})/.exec(url)?.[1] as string;
        const rows = [];
        for (let d = start; d <= end; d = addDays(d, 1)) rows.push(`[${day(d)},1,2,1,50000.5,1]`);
        return jsonResponse(`[${rows.join(',')}]`);
      },
    ],
    [
      /ecb/,
      () =>
        new Response(
          'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\nX,D,USD,EUR,SP00,A,2023-12-29,1.25\n',
        ),
    ],
    [/openfigi/, () => jsonResponse([{ data: [{ ticker: 'AAPL' }] }])],
    [/tiingo\/daily\/aapl$/, () => jsonResponse({ ticker: 'aapl', exchangeCode: 'NASDAQ' })],
    [
      /coinbase\.com\/products\/BTC-EUR$/,
      () => jsonResponse({ id: 'BTC-EUR', quote_currency: 'EUR' }),
    ],
  ]);
  const deps: CliDeps = {
    envPath: '/repo/scripts/prices/.env',
    reportsRoot: '/repo/prices-data/reports',
    resolveArg: (p) => p,
    readText: async (p) => (p.endsWith('.env') ? envText : (inputs.get(p) ?? null)),
    writeFile: async (p, c) => void files.set(p, c),
    mkdir: async () => {},
    openDb: () => db,
    checkUser: async () => {},
    fetch,
    sleep: async () => {},
    ask: async () => answer,
    print: (l) => out.push(l),
    now: () => new Date('2024-02-11T09:00:00Z'),
  };
  return { deps, out, files, calls };
}

describe('parseArgs', () => {
  it('needs a known command and valid options', () => {
    expect(parseArgs(['backfill', '--only', 'fx,prices', '--from=2024-01-01'])).toMatchObject({
      command: 'backfill',
      from: '2024-01-01',
      only: new Set(['fx', 'prices']),
    });
    expect(() => parseArgs([])).toThrow(/Give a command/);
    expect(() => parseArgs(['backfill', '--commit'])).toThrow(/resolve and import-history only/);
    expect(() => parseArgs(['backfill', '--only', 'cash'])).toThrow(/--only/);
    expect(() => parseArgs(['backfill', '--from', '2024-1-1'])).toThrow(/YYYY-MM-DD/);
  });
});

describe('run', () => {
  it('refuses to run without the .env file', async () => {
    const h = harness(seed(), REF, null);
    expect(await run(['report'], h.deps)).toBe(1);
    expect(h.out[0]).toMatch(/Copy scripts\/prices\/.env.example/);
  });

  it('backfill writes nothing unless the project reference is typed', async () => {
    const db = seed();
    const h = harness(db, 'nope');
    expect(await run(['backfill'], h.deps)).toBe(1);
    expect(h.out).toContain('Cancelled. Nothing was written.');
    expect(db.writes).toEqual({ prices: 0, fx: 0, snapshots: 0 });
    expect(h.calls).toHaveLength(0);
  });

  it('backfills FX, prices and snapshots, then writes the sanity report; console holds totals only', async () => {
    const db = seed();
    const h = harness(db);
    const code = await run(['backfill'], h.deps);
    expect(db.fx.size).toBe(1);
    expect(db.prices.get('btc|2024-02-10')?.close.toString()).toBe('50000.5');
    expect(db.prices.has('aapl|2024-02-10')).toBe(false); // no price source yet
    expect(db.snapshots.size).toBe(41); // 2024-01-01 .. 2024-02-10
    expect(db.runs.map((r) => [r.job, r.trigger])).toEqual([
      ['fx', 'script'],
      ['prices', 'script'],
      ['snapshots', 'script'],
    ]);
    // AAPL has no price: 1 position without a price -> exit code 1, for review
    expect(code).toBe(1);
    const console = h.out.join('\n');
    expect(console).toMatch(/Sanity on 2024-02-10: 2 positions/);
    expect(console).not.toMatch(/AAPL|BTCEUR|50000/);
    const sanity = [...h.files.entries()].find(([p]) => p.endsWith('sanity.csv'))?.[1] ?? '';
    expect(sanity).toContain('BTCEUR');
    expect(sanity).toContain('CHECK: no price');
    const issues = [...h.files.entries()].find(([p]) => p.endsWith('issues.csv'))?.[1] ?? '';
    expect(issues).toContain('no_price_source');
  });

  it('resolve is a dry run unless --commit, then writes only resolved symbols', async () => {
    const db = seed();
    const h = harness(db);
    await run(['resolve'], h.deps);
    expect(db.assets.find((a) => a.id === 'aapl')?.priceSource).toBe('manual');
    const symbols = [...h.files.entries()].find(([p]) => p.endsWith('symbols.csv'))?.[1] ?? '';
    expect(symbols).toContain('resolved,tiingo:AAPL,USD,NASDAQ');
    expect(h.out[0]).toBe(
      'Symbols: 1 resolved, 1 unchanged, 0 unresolved, 0 skipped (certificados).',
    );

    expect(await run(['resolve', '--commit'], h.deps)).toBe(0);
    expect(db.assets.find((a) => a.id === 'aapl')).toMatchObject({
      priceSource: 'tiingo',
      priceSourceId: 'AAPL',
    });
    expect(db.runs.at(-1)).toMatchObject({
      job: 'resolve',
      status: 'ok',
      counts: { written: 1, unresolved: 0 },
    });
  });

  it('import-history: a dry run first, then writes only dates not stored yet', async () => {
    const db = seed();
    db.assets.push({
      id: 'sxr8',
      name: 'iShares Core S&P 500',
      ticker: 'SXR8',
      isin: 'IE00B5BMR087',
      exchange: 'XETR',
      assetType: 'etf',
      tradingCurrency: 'EUR',
      priceSource: 'alphavantage',
      priceSourceId: 'SXR8.DEX',
    });
    db.prices.set('sxr8|2024-01-03', {
      assetId: 'sxr8',
      date: '2024-01-03',
      close: dec('476.5'),
      currency: 'EUR',
      splitFactor: null,
      source: 'alphavantage',
    });
    const file =
      'Date\tClose\tAdj Close\nJan 3, 2024\t476.12\t476.12\nJan 2, 2024\t478.00\t478.00\n';
    const h = harness(db, REF, ENV, new Map([['SXR8.txt', file]]));
    const argv = ['import-history', '--asset', 'sxr8', '--file', 'SXR8.txt', '--currency', 'EUR'];

    expect(await run(argv, h.deps)).toBe(0);
    expect(h.out).toContain('Dry run: nothing written. Run again with --commit.');
    expect(h.out[0]).toBe(
      'SXR8: 2 closes from 2024-01-02 to 2024-01-03 (0 lines without a price skipped); 1 to write; 1 dates already stored are kept.',
    );
    expect(db.writes.prices).toBe(0);

    expect(await run([...argv, '--commit'], h.deps)).toBe(0);
    expect(db.prices.get('sxr8|2024-01-02')).toMatchObject({ source: 'import', currency: 'EUR' });
    expect(db.prices.get('sxr8|2024-01-02')?.close.toString()).toBe('478');
    expect(db.prices.get('sxr8|2024-01-03')?.source).toBe('alphavantage'); // kept
    expect(h.out.join('\n')).not.toMatch(/478|476/); // no prices on the console
  });

  it('import-history refuses a currency that is not the listing currency, and unknown tickers', async () => {
    const h = harness(seed(), REF, ENV, new Map([['f.csv', 'Date,Close\n2024-01-02,100\n']]));
    const base = ['import-history', '--file', 'f.csv', '--commit'];
    expect(await run([...base, '--asset', 'AAPL', '--currency', 'EUR'], h.deps)).toBe(1);
    expect(h.out.at(-1)).toBe(
      'AAPL is listed in USD, but --currency says EUR. Nothing was written.',
    );
    expect(await run([...base, '--asset', 'NOPE', '--currency', 'EUR'], h.deps)).toBe(1);
    expect(h.out.at(-1)).toBe('No asset with ticker NOPE.');
  });
});
