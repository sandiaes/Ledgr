import { describe, expect, it } from 'vitest';
import { InsufficientHoldingsError } from './errors';
import { runFifo } from './fifo';
import { buy, expectDec, sell, transfer } from './test-utils';
import { maxDisposable, unitsHeld } from './validation';

const at = (date: string, accountId = 'degiro', assetId = 'A') => ({ accountId, assetId, date });

describe('unitsHeld and maxDisposable', () => {
  // degiro holds 10 from 1 March and sells 6 on 1 May; ibkr holds 7 of the same asset.
  const ledger = [
    buy('2024-03-01', 'A', '10', '1', { account: 'degiro' }),
    sell('2024-05-01', 'A', '6', '1', { account: 'degiro' }),
    buy('2024-03-01', 'A', '7', '1', { account: 'ibkr' }),
  ];

  it('hold 10, later sell 6: on an earlier date only 4 can be sold', () => {
    expectDec(unitsHeld(ledger, at('2024-04-01')), '10');
    expectDec(maxDisposable(ledger, at('2024-04-01')), '4');
    // after the later sale, the 4 left
    expectDec(maxDisposable(ledger, at('2024-06-01')), '4');
    // before the buy: nothing; ibkr's units never count for degiro
    expectDec(maxDisposable(ledger, at('2024-02-01')), '0');
    expectDec(maxDisposable(ledger, at('2024-04-01', 'ibkr')), '7');
  });

  it('the limit is exact: selling it passes, 1e-18 more fails', () => {
    const ok = sell('2024-04-01', 'A', '4', '1', { account: 'degiro' });
    const over = sell('2024-04-01', 'A', '4.000000000000000001', '1', { account: 'degiro' });
    expect(() => runFifo([...ledger, ok])).not.toThrow();
    expect(() => runFifo([...ledger, over])).toThrow(InsufficientHoldingsError);
  });

  it('a sale on a date comes after that day’s rows, and transfers count', () => {
    // wal: 2 held; on 1 Apr a buy of 3 (same day); 1 Jun 5 transferred in; 1 Jul sell 9.
    // balances after 1 Apr: 5, then 10 (Jun), then 1 (Jul) -> max on 1 Apr is 1
    const txs = [
      buy('2024-03-01', 'A', '2', '1', { account: 'wal' }),
      buy('2024-04-01', 'A', '3', '1', { account: 'wal' }),
      buy('2024-03-01', 'A', '5', '1', { account: 'ex' }),
      transfer('2024-06-01', 'A', '5', 'wal', { account: 'ex' }),
      sell('2024-07-01', 'A', '9', '1', { account: 'wal' }),
    ];
    expectDec(unitsHeld(txs, at('2024-04-01', 'wal')), '5');
    expectDec(maxDisposable(txs, at('2024-04-01', 'wal')), '1');
    expectDec(maxDisposable(txs, at('2024-06-15', 'wal')), '1');
    expectDec(maxDisposable(txs, at('2024-07-02', 'wal')), '1');
    // ex sent its 5 away on 1 June: before that it could sell them all, after it nothing
    expectDec(maxDisposable(txs, at('2024-05-01', 'ex')), '0');
    expectDec(unitsHeld(txs, at('2024-05-01', 'ex')), '5');
  });
});
