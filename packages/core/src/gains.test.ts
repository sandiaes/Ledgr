import { describe, expect, it } from 'vitest';
import { dailyFlows } from './cashflows';
import { MissingValuationError } from './errors';
import { gainsSummary, netContributions } from './gains';
import { computeHoldings } from './holdings';
import { createFxLookup, createPriceLookup } from './lookups';
import { buy, d, deposit, dividend, expectDec, fee, interest, sell, withdraw } from './test-utils';
import type { Asset } from './types';

const assets: Asset[] = [
  { id: 'A', assetType: 'stock', tradingCurrency: 'EUR' },
  { id: 'B', assetType: 'etf', tradingCurrency: 'USD' },
];

// deposits 3000 (fee 1 on the second) - withdrawal 500 (fee 2)        net contributions 2500
// A: buy 10 @ 100 + 5 = 1005; sell 4 @ 120 - 2 = 478; cost 402        realized  +76
//    6 left, cost 603, price 90 -> 540                                unrealized -63
// B: buy 5 @ 200 USD + 2 USD at fx 0.9 = 1002 * 0.9 = 901.8 EUR
//    price 210 USD at fx 0.95 -> 5*210*0.95 = 997.5                   unrealized +95.7
// dividend 20 - 3 fee, interest 4                                     income net  21
// fee row 6                                                           other costs 6
// (the deposit and withdrawal fees change no figure: cash is not tracked, D5)
const transactions = [
  deposit('2024-01-01', '2000'),
  deposit('2024-01-02', '1000', { fees: '1' }),
  buy('2024-01-10', 'A', '10', '100', { fees: '5' }),
  buy('2024-01-11', 'B', '5', '200', { fees: '2', currency: 'USD', fx: '0.9' }),
  sell('2024-03-01', 'A', '4', '120', { fees: '2' }),
  dividend('2024-04-01', '20', { asset: 'A', fees: '3' }),
  interest('2024-05-01', '4'),
  fee('2024-05-02', '6'),
  withdraw('2024-06-01', '500', { fees: '2' }),
];
const asOf = '2024-06-30';
const prices = createPriceLookup([
  { assetId: 'A', date: asOf, close: d('90'), currency: 'EUR' },
  { assetId: 'B', date: asOf, close: d('210'), currency: 'USD' },
]);
const fx = createFxLookup([{ currency: 'USD', date: asOf, rateToEur: d('0.95') }]);

describe('netContributions', () => {
  it('deposits minus withdrawals, fees excluded', () => {
    const c = netContributions(transactions);
    expectDec(c.depositsEur, '3000');
    expectDec(c.withdrawalsEur, '500');
    expectDec(c.netEur, '2500');
    expectDec(netContributions(transactions, '2024-01-01').netEur, '2000');
  });

  it('converts foreign-currency deposits at trade-date fx', () => {
    // 100 USD at 0.9 = 90 EUR
    expectDec(
      netContributions([deposit('2024-01-01', '100', { currency: 'USD', fx: '0.9' })]).netEur,
      '90',
    );
  });
});

describe('gainsSummary', () => {
  const holdings = computeHoldings({ transactions, assets, asOf, prices, fx });
  const g = gainsSummary({ transactions, holdings, asOf });

  it('realized vs unrealized vs total', () => {
    expectDec(g.realizedEur, '76');
    // -63 + 95.7
    expectDec(g.unrealizedEur, '32.7');
    expectDec(g.totalGainEur, '108.7');
    expectDec(g.incomeNetEur, '21');
    expectDec(g.otherCostsEur, '6');
    // 108.7 + 21 - 6
    expectDec(g.totalReturnEur, '123.7');
  });

  it('total gain = value - the sum of the day flows (deposits and withdrawals are not flows)', () => {
    // flows: +1005 +901.8 -478 -17 -4 +6 = 1413.8; value 540 + 997.5 = 1537.5
    // 1537.5 - 1413.8 = 123.7
    const flows = dailyFlows(transactions, { asOf });
    const total = flows.reduce((s, f) => s.plus(f.flowEur), d('0'));
    expectDec(total, '1413.8');
    const positions = holdings.reduce((s, h) => s.plus(h.marketValueEur!), d('0'));
    expectDec(positions.minus(total), g.totalReturnEur);
  });

  it('deposits and withdrawals, fees included, change no figure', () => {
    const without = transactions.filter((t) => t.type !== 'deposit' && t.type !== 'withdrawal');
    const g2 = gainsSummary({ transactions: without, holdings, asOf });
    expect(Object.values(g2).map(String)).toEqual(Object.values(g).map(String));
  });

  it('negative returns are reported as negative', () => {
    const txs = [buy('2024-01-01', 'A', '10', '100'), sell('2024-02-01', 'A', '5', '80')];
    const h = computeHoldings({ transactions: txs, assets, asOf, prices, fx });
    const s = gainsSummary({ transactions: txs, holdings: h, asOf });
    // realized 5*80 - 500 = -100; unrealized 5*90 - 500 = -50
    expectDec(s.realizedEur, '-100');
    expectDec(s.unrealizedEur, '-50');
    expectDec(s.totalReturnEur, '-150');
  });

  it('dividends only: income without positions', () => {
    const txs = [dividend('2024-01-01', '10'), dividend('2024-02-01', '5', { fees: '1' })];
    const s = gainsSummary({ transactions: txs, holdings: [], asOf });
    expectDec(s.totalGainEur, '0');
    expectDec(s.incomeNetEur, '14');
    expectDec(s.totalReturnEur, '14');
  });

  it('income net of withholding tax', () => {
    // 20 - 5.6 withheld - 1 fee = 13.4
    const txs = [dividend('2024-01-01', '20', { withholding: '5.6', fees: '1' })];
    const s = gainsSummary({ transactions: txs, holdings: [], asOf });
    expectDec(s.incomeNetEur, '13.4');
    expectDec(s.totalReturnEur, '13.4');
  });

  it('refuses to summarise with unvalued holdings', () => {
    const h = computeHoldings({
      transactions,
      assets,
      asOf,
      prices: createPriceLookup([]),
      fx,
    });
    expect(() => gainsSummary({ transactions, holdings: h, asOf })).toThrow(MissingValuationError);
  });
});
