import { describe, expect, it } from 'vitest';
import { closedPositions } from './closed';
import { buy, d, dividend, expectDec, sell } from './test-utils';

describe('closedPositions', () => {
  it('buy 10 @ 10, buy 10 @ 12, sell 20 @ 15: realized 80', () => {
    // cost 100 + 120 = 220, proceeds 300, gain 80, % = 80 / 220; dividend 4 while held
    const [c, ...rest] = closedPositions([
      buy('2024-01-01', 'A', '10', '10'),
      buy('2024-02-01', 'A', '10', '12'),
      dividend('2024-03-01', '4', { asset: 'A' }),
      sell('2024-04-01', 'A', '20', '15'),
    ]);
    expect(rest).toEqual([]);
    expect([c!.assetId, c!.firstBuy, c!.lastSale]).toEqual(['A', '2024-01-01', '2024-04-01']);
    expectDec(c!.unitsBought, '20');
    expectDec(c!.unitsSold, '20');
    expectDec(c!.costEur, '220');
    expectDec(c!.proceedsEur, '300');
    expectDec(c!.realizedEur, '80');
    expectDec(c!.realizedPct, d('80').div('220'));
    expectDec(c!.incomeEur, '4');
  });

  it('split by broker; open and re-opened positions are not listed', () => {
    // C at degiro: 5 @ 10 sold @ 12 -> +10; at ibkr: 3 @ 20 sold @ 18 -> -6; total +4
    // R: closed, then re-opened -> under its open position. O: still open.
    const rows = closedPositions([
      buy('2024-01-01', 'C', '5', '10', { account: 'degiro' }),
      buy('2024-01-01', 'C', '3', '20', { account: 'ibkr' }),
      sell('2024-02-01', 'C', '5', '12', { account: 'degiro' }),
      sell('2024-03-01', 'C', '3', '18', { account: 'ibkr' }),
      buy('2024-01-01', 'R', '1', '10'),
      sell('2024-02-01', 'R', '1', '11'),
      buy('2024-03-01', 'R', '1', '12'),
      buy('2024-01-01', 'O', '2', '10'),
      sell('2024-02-01', 'O', '1', '11'),
    ]);
    expect(rows.map((r) => r.assetId)).toEqual(['C']);
    expectDec(rows[0]!.realizedEur, '4');
    expect(
      rows[0]!.accounts.map((a) => [a.accountId, a.unitsSold.toString(), a.realizedEur.toString()]),
    ).toEqual([
      ['degiro', '5', '10'],
      ['ibkr', '3', '-6'],
    ]);
  });

  it('asOf: closed then, re-opened later', () => {
    const txs = [
      buy('2024-01-01', 'R', '1', '10'),
      sell('2024-02-01', 'R', '1', '11'),
      buy('2024-03-01', 'R', '1', '12'),
    ];
    expect(closedPositions(txs, { asOf: '2024-02-15' }).map((r) => r.assetId)).toEqual(['R']);
    expect(closedPositions(txs)).toEqual([]);
  });
});
