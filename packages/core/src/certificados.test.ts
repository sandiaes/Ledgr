import { describe, expect, it } from 'vitest';
import {
  CaRateUnavailableError,
  createRuleBasedCaValuer,
  defaultCaRateRule,
  type CaContext,
  type CaSeries,
  type CaSubscription,
  type CaValuer,
} from './certificados';
import { LedgerError } from './errors';
import { computeHoldings } from './holdings';
import { createFxLookup, createPriceLookup } from './lookups';
import { buy, d, expectClose, expectDec, redeem, subscribe } from './test-utils';
import type { Asset } from './types';

// ILLUSTRATIVE parameters for the tests (shaped like a Série E), not official values.
// Quarterly capitalisation, 10-year term, base = euribor_3m + 1% in [0%, 3.5%],
// +0.5% in years 2-5, +1% in years 6-10, 28% withholding on each capitalisation.
const series: CaSeries = {
  id: 'E',
  code: 'E',
  termMonths: 120,
  capitalisationMonths: 3,
  minHoldingMonths: 3,
  referenceRate: 'euribor_3m',
  baseSpread: d('0.01'),
  rateFloor: d('0'),
  rateCap: d('0.035'),
  loyaltyPremiums: [
    { fromYear: 2, toYear: 5, premium: d('0.005') },
    { fromYear: 6, toYear: 10, premium: d('0.01') },
  ],
  withholdingTaxRate: d('0.28'),
};

const constantRate = (rate: string) => createRuleBasedCaValuer({ referenceRate: () => d(rate) });

const unit = (
  valuer: CaValuer,
  asOf: string,
  opts: { s?: CaSeries; from?: string; manual?: { date: string; unitValue: string } } = {},
) =>
  valuer.valueUnit({
    series: opts.s ?? series,
    subscriptionDate: opts.from ?? '2023-01-15',
    subscriptionUnitValue: d('1'),
    asOf,
    manual: opts.manual ? { date: opts.manual.date, unitValue: d(opts.manual.unitValue) } : null,
  });

// With euribor 2%: base = 3%; quarterly gross = 3% * 3/12 = 0.75%; net = 0.75% * 0.72 = 0.54%
const Q1 = d('1.0054');
// Year 2: 3% + 0.5% = 3.5%; quarterly gross 0.875%; net 0.63%
const Q2 = d('1.0063');

describe('rule-based certificado valuer', () => {
  const v = constantRate('0.02');

  it('no interest for an incomplete period', () => {
    expect(unit(v, '2023-01-15')).toEqual({
      unitValue: d('1'),
      source: 'rules',
      lastCapitalisation: null,
    });
    expectDec(unit(v, '2023-04-14').unitValue, '1');
  });

  it('first capitalisation: 1 * (1 + 0.03 * 3/12 * (1 - 0.28)) = 1.0054', () => {
    const r = unit(v, '2023-04-15');
    expectDec(r.unitValue, Q1);
    expect(r.lastCapitalisation).toBe('2023-04-15');
  });

  it('compounds quarterly on the net value; loyalty premium from year 2', () => {
    // 4 quarters in year 1, then the first year-2 quarter
    expectDec(unit(v, '2024-01-15').unitValue, Q1.pow(4));
    expectDec(unit(v, '2024-04-15').unitValue, Q1.pow(4).times(Q2));
  });

  it('caps the base rate, premium added on top of the cap', () => {
    // euribor 4% + 1% = 5% -> capped 3.5%: quarter net = 3.5% * 0.25 * 0.72 = 0.63%
    // year 2: 3.5% + 0.5% = 4%: quarter net = 4% * 0.25 * 0.72 = 0.72%
    const capped = constantRate('0.04');
    expectDec(unit(capped, '2023-04-15').unitValue, '1.0063');
    expectDec(unit(capped, '2024-04-15').unitValue, d('1.0063').pow(4).times('1.0072'));
  });

  it('floors the base rate at 0, premium still applies', () => {
    // euribor -2% + 1% = -1% -> floored at 0: year 1 earns nothing
    // year 2: 0% + 0.5%: quarter net = 0.5% * 0.25 * 0.72 = 0.09%
    const floored = constantRate('-0.02');
    expectDec(unit(floored, '2024-01-15').unitValue, '1');
    expectDec(unit(floored, '2024-04-15').unitValue, '1.0009');
  });

  it('uses the reference rate in force at the start of each period', () => {
    // Q1 starts 2023-01-15 at 2% (-> 3%); Q2 starts 2023-04-15 at 3% (-> 4%, capped 3.5%)
    const stepped = createRuleBasedCaValuer({
      referenceRate: (_, date) => d(date < '2023-04-15' ? '0.02' : '0.03'),
    });
    expectDec(unit(stepped, '2023-07-15').unitValue, Q1.times('1.0063'));
  });

  it('stops accruing at the end of the term', () => {
    // 6-month term: two quarters only, however late we value it
    expectDec(unit(v, '2030-01-01', { s: { ...series, termMonths: 6 } }).unitValue, Q1.pow(2));
  });

  it('anchors periods on the subscription date, clamped to month end', () => {
    // 2023-11-30 + 3 months = 2024-02-29; + 6 months = 2024-05-30
    expectDec(unit(v, '2024-02-28', { from: '2023-11-30' }).unitValue, '1');
    expectDec(unit(v, '2024-02-29', { from: '2023-11-30' }).unitValue, Q1);
    expectDec(unit(v, '2024-05-29', { from: '2023-11-30' }).unitValue, Q1);
    expectDec(unit(v, '2024-05-30', { from: '2023-11-30' }).unitValue, Q1.pow(2));
  });

  it('no withholding when the series rate is 0', () => {
    // quarter = 3% * 0.25 = 0.75%
    const s = { ...series, withholdingTaxRate: d('0') };
    expectDec(unit(v, '2023-04-15', { s }).unitValue, '1.0075');
  });

  it('manual override: continue accruing from the override date', () => {
    // override 1.01/unit on 2023-06-01; next capitalisation 2023-07-15 -> 1.01 * 1.0054
    const manual = { date: '2023-06-01', unitValue: '1.01' };
    const r = unit(v, '2023-07-15', { manual });
    expect(r.source).toBe('manual');
    expectDec(r.unitValue, d('1.01').times(Q1));
    expectDec(unit(v, '2023-06-01', { manual }).unitValue, '1.01');
  });

  it('an override on a capitalisation date already includes that period', () => {
    const r = unit(v, '2023-07-15', { manual: { date: '2023-07-15', unitValue: '1.02' } });
    expectDec(r.unitValue, '1.02');
  });

  it('ignores an override dated after asOf (history uses rules)', () => {
    const r = unit(v, '2023-05-01', { manual: { date: '2023-06-01', unitValue: '1.01' } });
    expect(r.source).toBe('rules');
    expectDec(r.unitValue, Q1);
  });

  it('rejects an override before the subscription', () => {
    expect(() => unit(v, '2023-06-01', { manual: { date: '2022-12-01', unitValue: '1' } })).toThrow(
      /before the subscription/,
    );
  });

  it('throws when a reference rate is missing', () => {
    const none = createRuleBasedCaValuer({ referenceRate: () => null });
    expect(() => unit(none, '2023-04-15')).toThrow(CaRateUnavailableError);
    expectDec(unit(none, '2023-04-14').unitValue, '1');
  });

  it('the rate rule is pluggable', () => {
    // flat 4%: quarter net = 4% * 0.25 * 0.72 = 0.72%
    const custom = createRuleBasedCaValuer({
      referenceRate: () => d('0'),
      rateRule: () => d('0.04'),
    });
    expectDec(unit(custom, '2023-04-15').unitValue, '1.0072');
  });

  it('default rule sums overlapping premiums and works without floor/cap', () => {
    const s = {
      ...series,
      rateFloor: null,
      rateCap: null,
      loyaltyPremiums: [
        { fromYear: 1, toYear: 3, premium: d('0.001') },
        { fromYear: 2, toYear: 2, premium: d('0.002') },
      ],
    };
    const ctx = { series: s, periodStart: '2024-01-01', referenceRate: d('0.05') };
    expectDec(defaultCaRateRule({ ...ctx, holdingYear: 1 }), '0.061');
    expectDec(defaultCaRateRule({ ...ctx, holdingYear: 2 }), '0.063');
    expectDec(defaultCaRateRule({ ...ctx, holdingYear: 4 }), '0.06');
  });
});

describe('certificados in holdings', () => {
  const assets: Asset[] = [
    { id: 'CA', assetType: 'certificado_aforro', tradingCurrency: 'EUR' },
    { id: 'A', assetType: 'stock', tradingCurrency: 'EUR' },
  ];
  const sub = (patch: Partial<CaSubscription> = {}): CaSubscription => ({
    id: 'ca1',
    seriesId: 'E',
    transactionId: 's1',
    manualValue: null,
    manualValueDate: null,
    ...patch,
  });
  const transactions = [
    subscribe('2023-01-15', 'CA', '1000', '1', { id: 's1' }),
    redeem('2023-08-01', 'CA', '400', '1.01', { caSubscriptionId: 'ca1' }),
  ];
  const noPrices = createPriceLookup([]);
  const fx = createFxLookup([]);
  const context = (subs: CaSubscription[], valuer: CaValuer = constantRate('0.02')): CaContext => ({
    valuer,
    series: [series],
    subscriptions: subs,
  });

  it('values the remaining units by accrual after a partial redemption', () => {
    // 600 units left; 4 capitalisations to 2024-01-15 -> 600 * 1.0054^4; cost 600
    const [h] = computeHoldings({
      transactions,
      assets,
      asOf: '2024-01-15',
      prices: noPrices,
      fx,
      ca: context([sub()]),
    });
    expectDec(h!.quantity, '600');
    expectDec(h!.costBasisEur, '600');
    expectDec(h!.marketValueEur, Q1.pow(4).times(600));
    expect(h!.valuation.kind).toBe('certificado');
  });

  it('manual override is per unit outstanding on its date', () => {
    // 610 EUR for the 600 units held on 2023-12-01 -> 610/600 per unit
    // next capitalisation 2024-01-15: 600 * 610/600 * 1.0054 = 610 * 1.0054 = 613.294
    const [h] = computeHoldings({
      transactions,
      assets,
      asOf: '2024-01-15',
      prices: noPrices,
      fx,
      ca: context([sub({ manualValue: d('610'), manualValueDate: '2023-12-01' })]),
    });
    // 610/600 repeats, so the result is exact only to the 50-significant-digit precision
    expectClose(h!.marketValueEur, '613.294', '1e-40');
    if (h!.valuation.kind !== 'certificado') throw new Error('expected certificado valuation');
    expect(h!.valuation.lots[0]!.source).toBe('manual');
  });

  it('rejects an override dated when no units were outstanding', () => {
    expect(() =>
      computeHoldings({
        transactions: [...transactions, subscribe('2023-02-01', 'CA', '1', '1', { id: 's2' })],
        assets,
        asOf: '2024-01-15',
        prices: noPrices,
        fx,
        ca: context([
          sub(),
          sub({
            id: 'ca2',
            transactionId: 's2',
            manualValue: d('1'),
            manualValueDate: '2023-01-20',
          }),
        ]),
      }),
    ).toThrow(LedgerError);
  });

  it('a whole different valuer can be plugged in', () => {
    const fixed: CaValuer = {
      valueUnit: () => ({ unitValue: d('2'), source: 'rules', lastCapitalisation: null }),
    };
    const [h] = computeHoldings({
      transactions,
      assets,
      asOf: '2024-01-15',
      prices: noPrices,
      fx,
      ca: context([sub()], fixed),
    });
    expectDec(h!.marketValueEur, '1200');
  });

  it('falls back to the price lookup when a lot is not linked to a series', () => {
    const prices = createPriceLookup([
      { assetId: 'CA', date: '2024-01-01', close: d('1.03'), currency: 'EUR' },
    ]);
    const [h] = computeHoldings({
      transactions: [subscribe('2023-01-15', 'CA', '100', '1', { id: 'unlinked' })],
      assets,
      asOf: '2024-01-15',
      prices,
      fx,
      ca: context([]),
    });
    expectDec(h!.marketValueEur, '103');
    expect(h!.valuation.kind).toBe('price');
  });

  it('non-certificado assets are unaffected by the CA context', () => {
    const [h] = computeHoldings({
      transactions: [buy('2023-01-01', 'A', '1', '10')],
      assets,
      asOf: '2024-01-15',
      prices: createPriceLookup([
        { assetId: 'A', date: '2024-01-15', close: d('12'), currency: 'EUR' },
      ]),
      fx,
      ca: context([]),
    });
    expectDec(h!.marketValueEur, '12');
  });
});
