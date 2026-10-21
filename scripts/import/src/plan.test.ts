import { describe, expect, it } from 'vitest';
import { duplicateKey } from './hash';
import { readMappingFile } from './inputs';
import { buildMapping, isValidIsin } from './mapping';
import { canCommit, type ImportPlan } from './plan';
import { completeMappingText, editLines, fixtureText, utf8 } from './test/fixtures';
import { CA, plan, TX } from './test/plan-helper';

const rejected = (p: ImportPlan, file = 'transactions') =>
  p.rejects
    .filter((r) => r.file === file)
    .map((r) => [r.line, [...new Set(r.reasons.map((x) => x.code))].join(',')]);

describe('the base fixture', () => {
  const p = plan();

  it('has no rejects and can be committed', () => {
    expect(p.fatal).toEqual([]);
    expect(p.rejects).toEqual([]);
    expect(canCommit(p)).toBe(true);
    expect(p.counts).toEqual({
      transactions: { read: 140, insert: 140, skip: 0, reject: 0 },
      ca: { read: 3, insert: 3, skip: 0, reject: 0 },
    });
  });

  it('creates one account per broker, one asset per ticker, one CA series', () => {
    expect(p.payload.accounts.map((a) => [a.name, a.account_type]).sort()).toEqual([
      ['Aforro', 'platform'],
      ['Degiro', 'broker'],
      ['IBKR', 'broker'],
      ['Kraken', 'exchange'],
    ]);
    expect(p.payload.assets).toHaveLength(24);
    expect(p.payload.ca_series).toEqual([{ id: expect.any(String), code: 'E', name: 'Série E' }]);
    const ca = p.payload.assets.find((a) => a.ticker === 'E');
    expect(ca).toMatchObject({
      asset_type: 'certificado_aforro',
      price_source: 'ca_factors',
      trading_currency: 'EUR',
    });
  });

  it('maps rows: day 1 at month precision, positive quantities, EUR at fx 1, file order', () => {
    const t = p.payload.transactions;
    expect(t).toHaveLength(137); // 134 non-CA rows + 3 CA subscriptions
    expect(t.map((x) => x.seq)).toEqual(t.map((_, i) => i + 1));
    expect(t[0]).toMatchObject({
      type: 'buy',
      trade_date: '2021-01-01',
      trade_date_precision: 'month',
      quantity: '60',
      unit_price: '169.1955',
      currency: 'EUR',
      fx_rate_to_eur: '1',
    });
    const sell = t.find((x) => x.type === 'sell' && x.quantity === '93');
    expect(sell).toMatchObject({ unit_price: '39.7254' });
    expect(new Set(t.map((x) => x.import_row_hash)).size).toBe(137);
    for (const x of t) expect(Number(x.quantity) > 0).toBe(true);
  });

  it('groups CA rows by (series, month) into subscriptions with their factors', () => {
    expect(
      p.ca.map((c) => [c.series, c.month, c.units.toString(), c.lines, c.factor?.toString()]),
    ).toEqual([
      ['E', '2023-01-01', '36000', [68, 69], '1.10482'],
      ['E', '2023-03-01', '14000', [72, 73], '1.09754'],
      ['E', '2023-05-01', '9000', [75, 76], '1.08988'],
    ]);
    const subs = p.payload.transactions.filter((x) => x.type === 'subscription');
    expect(subs.map((s) => [s.trade_date, s.quantity, s.unit_price])).toEqual([
      ['2023-01-01', '36000', '1'],
      ['2023-03-01', '14000', '1'],
      ['2023-05-01', '9000', '1'],
    ]);
    expect(p.payload.ca_subscriptions.map((s) => s.transaction_id)).toEqual(subs.map((s) => s.id));
    expect(p.payload.ca_factors.map((f) => [f.month, f.factor, f.source])).toEqual([
      ['2026-10-01', '1.10482', 'excel'],
      ['2026-10-01', '1.09754', 'excel'],
      ['2026-10-01', '1.08988', 'excel'],
    ]);
    // A subscription sits in file order at its first row: after line 67, before line 70.
    const order = p.payload.transactions.map((x) => x.type);
    expect(order.indexOf('subscription')).toBe(66);
  });

  it('warns about the out-of-order row but does not block', () => {
    expect(p.warnings.filter((w) => w.file === 'transactions')).toEqual([
      {
        file: 'transactions',
        line: 134,
        message: expect.stringMatching(/2026-06 comes after a row of 2026-07/),
      },
    ]);
  });
});

describe('checks that block the import', () => {
  it('a ticker with more than one asset type, until type_override resolves it', () => {
    // The fixture types every SXR8 row as ETFs; make one Stocks (as the real data has).
    const tx = editLines(TX, { 88: '2024-04-01,Stocks,Buy,SXR8,0.25,354.5082,88.63,Degiro' });
    const p = plan({ tx });
    const sxr8 = rejected(p);
    expect(sxr8).toHaveLength(36);
    expect(new Set(sxr8.map(([, c]) => c))).toEqual(new Set(['type conflict']));
    expect(p.rejects[0]!.reasons[0]!.text).toMatch(
      /SXR8 appears as etf and stock: set type_override/,
    );
    expect(canCommit(p)).toBe(false);

    const fixed = plan({ tx, mapping: completeMappingText({ SXR8: { type_override: 'etf' } }) });
    expect(fixed.rejects).toEqual([]);
    expect(fixed.warnings).toContainEqual({
      file: 'transactions',
      line: 88,
      message: 'imported as etf (type_override); the row says Stocks',
    });
  });

  it('a mapping row listing two types needs type_override', () => {
    const p = plan({ mapping: completeMappingText({ SXR8: { asset_type: 'etf|stock' } }) });
    expect(rejected(p, 'mapping')).toEqual([[20, 'incomplete mapping']]);
    expect(p.rejects[0]!.reasons[0]!.text).toMatch(/set type_override/);
  });

  it('unknown tickers, and a template mapping that is not complete yet', () => {
    const noGme = completeMappingText()
      .split('\n')
      .filter((l) => !l.startsWith('GME,'))
      .join('\n');
    const p = plan({ mapping: noGme });
    expect(new Set(rejected(p).map(([, c]) => c))).toEqual(new Set(['unknown ticker']));
    expect(p.missingTickers).toEqual([{ ticker: 'GME', types: ['stock'] }]);

    const template = plan({ mapping: fixtureText('asset_mapping.csv') });
    expect(canCommit(template)).toBe(false);
    expect(rejected(template, 'mapping')).toHaveLength(23); // every row but E
  });

  it('mapping values are checked, never guessed', () => {
    const p = plan({
      mapping: completeMappingText({
        VWCE: { isin: 'IE00BK5BQT81' }, // wrong check digit
        AAPL: { currency: 'USD' },
        MSFT: { price_symbol: 'MSFT' },
        GME: { name: '' },
      }),
    });
    const texts = p.rejects
      .filter((r) => r.file === 'mapping')
      .flatMap((r) => r.reasons.map((x) => x.text));
    expect(texts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/AAPL: currency USD is not supported/),
        expect.stringMatching(/GME: name is blank/),
        expect.stringMatching(/MSFT: price_symbol must be provider:symbol/),
        expect.stringMatching(/VWCE: isin is not a valid ISIN/),
      ]),
    );
    expect(isValidIsin('IE00BK5BQT80')).toBe(true);
    expect(isValidIsin('US0378331005')).toBe(true);
    expect(isValidIsin('IE00BK5BQT81')).toBe(false);
  });

  it('a mapped ISIN is stored, and a blank cell is not "none"', () => {
    const p = plan({
      mapping: completeMappingText({
        VWCE: { isin: 'IE00BK5BQT80', price_symbol: 'yahoo:VWCE.DE' },
      }),
    });
    expect(p.payload.assets.find((a) => a.ticker === 'VWCE')).toMatchObject({
      isin: 'IE00BK5BQT80',
      price_source: 'yahoo',
      price_source_id: 'VWCE.DE',
    });
    const blank = buildMapping(
      readMappingFile(
        utf8(
          'ticker,asset_type,name,isin,exchange,currency,price_symbol,type_override\nX,stock,X,,-,EUR,-,\n',
        ),
      ).records,
    );
    expect(blank.get('X')!.problems).toEqual(['isin is blank (use - for none)']);
  });

  it('unmapped broker, unknown Type and Transact Type', () => {
    const p = plan({
      tx: editLines(TX, {
        2: '2021-01-01,Stocks,Buy,GME,60,169.1955,10151.73,Trade Republic',
        3: '2021-01-01,Bonds,Buy,GME,33,157.9710,5213.04,Degiro',
        4: '2021-01-01,Stocks,Gift,BB,27,13.2400,357.48,Degiro',
      }),
    });
    expect(rejected(p).slice(0, 3)).toEqual([
      [2, 'unmapped broker'],
      [3, 'unknown type'],
      [4, 'unknown transact type'],
    ]);
  });

  it('Order Value that differs from Units x Order Price beyond rounding', () => {
    // 60 x 169.1955 = 10151.73 exactly. Rounding allows 0.0005 (value) + 60 x 0.00005.
    const off = plan({
      tx: editLines(TX, { 2: '2021-01-01,Stocks,Buy,GME,60,169.1955,10152.73,Degiro' }),
    });
    expect(rejected(off)[0]).toEqual([2, 'value mismatch']);
    const within = plan({
      tx: editLines(TX, { 2: '2021-01-01,Stocks,Buy,GME,60,169.1955,10151.733,Degiro' }),
    });
    expect(within.rejects).toEqual([]);
  });

  it('sign must match the transact type', () => {
    const p = plan({
      tx: editLines(TX, { 14: '2021-02-01,Stocks,Sell,GME,93,39.7254,3694.46,Degiro' }),
    });
    expect(rejected(p)[0]).toEqual([14, 'sign mismatch']);
  });

  it('a sell above the holdings', () => {
    const p = plan({
      tx: editLines(TX, { 14: '2021-02-01,Stocks,Sell,GME,-124,39.7254,-4925.95,Degiro' }),
    });
    expect(rejected(p)).toEqual([[14, 'sell exceeds holdings']]);
  });

  it('a sell above the holdings of its account, though not above the total', () => {
    // By 2025-01 Degiro holds 2.75 SXR8 and IBKR 1.5: selling 3 at Degiro is too many.
    const p = plan({ tx: editLines(TX, {}, ['2025-01-01,ETFs,Sell,SXR8,-3,400,-1200.00,Degiro']) });
    expect(rejected(p)).toEqual([[142, 'sell exceeds holdings']]);
    expect(p.rejects[0]!.reasons[0]!.text).toMatch(/Degiro holds 2\.75/);
  });

  it('exact duplicate rows, until their key is allowed', () => {
    const row = '2021-01-01,Stocks,Buy,GME,60,169.1955,10151.73,Degiro';
    const tx = editLines(TX, {}, [row.replace('2021-01-01', '2021-01-01')]);
    const p = plan({ tx });
    expect(rejected(p).filter(([, c]) => c === 'duplicate')).toEqual([
      [2, 'duplicate'],
      [142, 'duplicate'],
    ]);
    const key = p.duplicates[0]!.key;
    expect(p.rejects[0]!.reasons[0]!.text).toContain(key);

    const ok = plan({ tx, allowed: [key] });
    expect(ok.rejects).toEqual([]);
    const [a, b] = ok.payload.transactions.filter(
      (t) => t.quantity === '60' && t.unit_price === '169.1955',
    );
    expect(a!.import_row_hash).not.toBe(b!.import_row_hash); // occurrence counter
  });

  it('the same row in another regional format is still the same row', async () => {
    const { readTransactions: read } = await import('./inputs');
    const a = read(
      utf8(
        'Month,Type,Transact Type,Ticker/Type,Units,Order Price,Order Value,Broker\n2021-01-01,Stocks,Buy,GME,34.50,10,345.00,Degiro\n',
      ),
    ).records[0]!;
    const b = read(
      utf8(
        'Month;Type;Transact Type;Ticker/Type;Units;Order Price;Order Value;Broker\n01/01/2021;stocks;BUY;gme;34,5;10;345;DEGIRO\n',
      ),
    ).records[0]!;
    expect(duplicateKey(a)).toBe(duplicateKey(b));
  });

  it('empty rows are skipped; total and partial rows are rejected', () => {
    const tx = editLines(TX, {}, [
      ',,,,,,,',
      '',
      'Total,,,,,,138010.92,',
      '2026-10-01,ETFs,Buy,SXR8,,1,1,IBKR',
    ]);
    const p = plan({ tx });
    expect(p.skips.filter((s) => s.reason === 'empty row').map((s) => s.line)).toEqual([142, 143]);
    expect(rejected(p)).toEqual([
      [144, 'total row'],
      [145, 'unreadable row'],
    ]);
    expect(p.counts.transactions).toEqual({ read: 144, insert: 140, skip: 2, reject: 2 });
  });
});

describe('certificados de aforro', () => {
  it('CA Order Price must be 1, and CA sells are not supported yet', () => {
    const p = plan({
      tx: editLines(TX, {}, [
        '2023-06-01,CA,Buy,E,1000,2,2000.00,Aforro',
        '2023-07-01,CA,Sell,E,-1000,1,-1000.00,Aforro',
      ]),
      ca: CA + 'E,2023-06-01,1000,1.08\n',
    });
    expect(rejected(p)).toEqual([
      [142, 'ca'],
      [143, 'ca'],
    ]);
  });

  it('CA file units must equal the grouped rows', () => {
    const p = plan({ ca: CA.replace('36000', '35000') });
    expect(rejected(p, 'ca')).toEqual([[2, 'ca']]);
    expect(rejected(p)).toEqual([
      [68, 'ca'],
      [69, 'ca'],
    ]);
  });

  it('a subscription without a ratio, and a ratio without a subscription', () => {
    const p = plan({ ca: editLines(CA, { 3: null }, ['E,2024-01-01,5000,1.07']) });
    expect(rejected(p)).toEqual([
      [72, 'ca'],
      [73, 'ca'],
    ]);
    expect(rejected(p, 'ca')).toEqual([[4, 'ca']]);
  });

  it('without a CA file, new subscriptions are refused', () => {
    const p = plan({ ca: null, ratioMonth: null });
    expect(rejected(p).map(([l]) => l)).toEqual([68, 69, 72, 73, 75, 76]);
    expect(p.rejects[0]!.reasons[0]!.text).toMatch(/pass --ca/);
  });

  it('--ratio-month is required with a CA file and may not precede a subscription', () => {
    expect(plan({ ratioMonth: null }).fatal).toEqual(['A CA file needs --ratio-month YYYY-MM.']);
    expect(rejected(plan({ ratioMonth: '2023-02-01' }), 'ca')).toEqual([
      [3, 'ca'],
      [4, 'ca'],
    ]);
  });
});
