import { describe, expect, it } from 'vitest';
import { createRuleBasedCaValuer, type CaSeries } from './certificados';
import { MissingValuationError } from './errors';
import { createFxLookup, createPriceLookup } from './lookups';
import { buildSnapshot, type SnapshotInput } from './snapshot';
import { buy, d, deposit, dividend, expectDec, subscribe } from './test-utils';
import type { Asset } from './types';

const assets: Asset[] = [
  { id: 'A', assetType: 'stock', tradingCurrency: 'EUR' },
  { id: 'E', assetType: 'etf', tradingCurrency: 'USD' },
  { id: 'BTC', assetType: 'crypto', tradingCurrency: 'EUR' },
  { id: 'CA', assetType: 'certificado_aforro', tradingCurrency: 'EUR' },
];

// Illustrative series: euribor 2% + 1% = 3%, quarterly, 28% withholding (see certificados.test)
const series: CaSeries = {
  id: 'E1',
  code: 'E',
  termMonths: 120,
  capitalisationMonths: 3,
  minHoldingMonths: 3,
  referenceRate: 'euribor_3m',
  baseSpread: d('0.01'),
  rateFloor: d('0'),
  rateCap: d('0.035'),
  loyaltyPremiums: [],
  withholdingTaxRate: d('0.28'),
};

const input: SnapshotInput = {
  date: '2024-04-15',
  transactions: [
    deposit('2024-01-01', '5000'),
    buy('2024-01-02', 'A', '10', '100', { fees: '1' }), //                     1001
    buy('2024-01-02', 'E', '10', '50', { currency: 'USD', fx: '0.9' }), //     500 USD * 0.9 = 450
    buy('2024-01-03', 'BTC', '0.01', '50000'), //                               500
    subscribe('2024-01-15', 'CA', '1000', '1', { id: 'sub1' }), //              1000
    dividend('2024-03-01', '10', { asset: 'A' }),
    buy('2024-05-01', 'A', '1', '100'), // after the snapshot date: ignored
  ],
  assets,
  prices: createPriceLookup([
    { assetId: 'A', date: '2024-04-12', close: d('110'), currency: 'EUR' },
    { assetId: 'E', date: '2024-04-12', close: d('55'), currency: 'USD' },
    { assetId: 'BTC', date: '2024-04-15', close: d('60000'), currency: 'EUR' },
  ]),
  fx: createFxLookup([
    { currency: 'USD', date: '2024-01-02', rateToEur: d('0.9') },
    { currency: 'USD', date: '2024-04-12', rateToEur: d('0.92') },
  ]),
  ca: {
    valuer: createRuleBasedCaValuer({ referenceRate: () => d('0.02') }),
    series: [series],
    subscriptions: [
      { id: 'c1', seriesId: 'E1', transactionId: 'sub1', manualValue: null, manualValueDate: null },
    ],
  },
};

describe('buildSnapshot', () => {
  it("produces the day's totals across asset types and currencies", () => {
    // stock   A    10 * 110                         = 1100
    // etf     E    10 * 55 USD * 0.92               =  506
    // crypto  BTC  0.01 * 60000                     =  600
    // CA      1000 * (1 + 0.03 * 3/12 * 0.72)       = 1005.4   (first capitalisation 04-15)
    // cash    5000 - 1001 - 450 - 500 - 1000 + 10   = 2059
    // total   1100 + 506 + 600 + 1005.4 + 2059      = 5270.4
    // cost    1001 + 450 + 500 + 1000               = 2951
    const s = buildSnapshot(input);
    expect(s.snapshotDate).toBe('2024-04-15');
    expectDec(s.stockValueEur, '1100');
    expectDec(s.etfValueEur, '506');
    expectDec(s.cryptoValueEur, '600');
    expectDec(s.certificadoAforroValueEur, '1005.4');
    expectDec(s.cashEur, '2059');
    expectDec(s.totalValueEur, '5270.4');
    expectDec(s.totalCostBasisEur, '2951');
    expectDec(s.netContributionsEur, '5000');
  });

  it('without deposits, cash is not tracked and not in the total', () => {
    // same ledger minus the deposit: positions 1100 + 506 + 600 + 1005.4 = 3211.4
    const noDeposit = input.transactions.filter((t) => t.type !== 'deposit');
    const s = buildSnapshot({ ...input, transactions: noDeposit });
    expect(s.cashEur).toBeNull();
    expectDec(s.totalValueEur, '3211.4');
    expectDec(s.netContributionsEur, '0');
  });

  it('trackCash overrides the default either way', () => {
    // forced on without deposits: cash = -1001 - 450 - 500 - 1000 + 10 = -2941
    const noDeposit = input.transactions.filter((t) => t.type !== 'deposit');
    const on = buildSnapshot({ ...input, transactions: noDeposit, trackCash: true });
    expectDec(on.cashEur, '-2941');
    expectDec(on.totalValueEur, '270.4');
    // forced off with deposits
    const off = buildSnapshot({ ...input, trackCash: false });
    expect(off.cashEur).toBeNull();
    expectDec(off.totalValueEur, '3211.4');
  });

  it('before any activity everything is zero', () => {
    const s = buildSnapshot({ ...input, date: '2023-12-31' });
    for (const v of Object.values(s).filter((x) => typeof x !== 'string')) expectDec(v, '0');
  });

  it('throws rather than writing a snapshot with a missing price', () => {
    expect(() => buildSnapshot({ ...input, prices: createPriceLookup([]) })).toThrow(
      MissingValuationError,
    );
  });
});
