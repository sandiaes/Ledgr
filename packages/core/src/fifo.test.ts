import { describe, expect, it } from 'vitest';
import { InsufficientHoldingsError, LedgerError } from './errors';
import { runFifo } from './fifo';
import { buy, expectDec, redeem, sell, subscribe, transfer } from './test-utils';

describe('runFifo', () => {
  it('partial sell of a single lot, fees in cost and proceeds', () => {
    // buy 10 @ 100 + fee 5          cost      = 10*100 + 5 = 1005
    // sell 4 @ 120 - fee 2          proceeds  = 4*120 - 2  = 478
    // cost of 4 units               = 1005 * 4/10           = 402
    // gain                          = 478 - 402             = 76
    // left: 6 units, cost           = 1005 - 402            = 603
    const { openLots, disposals } = runFifo([
      buy('2024-01-10', 'A', '10', '100', { id: 'b1', fees: '5' }),
      sell('2024-03-01', 'A', '4', '120', { id: 's1', fees: '2' }),
    ]);
    expect(disposals).toHaveLength(1);
    const s = disposals[0]!;
    expectDec(s.proceedsEur, '478');
    expectDec(s.costEur, '402');
    expectDec(s.gainEur, '76');
    expect(s.matches.map((m) => m.lotId)).toEqual(['b1']);
    expect(openLots).toHaveLength(1);
    expectDec(openLots[0]!.quantity, '6');
    expectDec(openLots[0]!.costEur, '603');
    expectDec(openLots[0]!.originalCostEur, '1005');
  });

  it('sell across multiple lots, oldest first', () => {
    // lot b1: 10 @ 100, fee 0   -> cost 1000
    // lot b2: 10 @ 110, fee 10  -> cost 1110
    // sell 15 @ 130, fee 15     -> proceeds 15*130 - 15 = 1935
    //   b1: 10 units, cost 1000,             proceeds 1935*10/15 = 1290, gain 290
    //   b2:  5 units, cost 1110*5/10 = 555,  proceeds 1935 - 1290 = 645, gain 90
    //   total cost 1555, gain 380
    // left: b2 5 units, cost 555
    const { openLots, disposals } = runFifo([
      buy('2024-01-01', 'A', '10', '100', { id: 'b1' }),
      buy('2024-02-01', 'A', '10', '110', { id: 'b2', fees: '10' }),
      sell('2024-03-01', 'A', '15', '130', { fees: '15' }),
    ]);
    const s = disposals[0]!;
    expectDec(s.proceedsEur, '1935');
    expectDec(s.costEur, '1555');
    expectDec(s.gainEur, '380');
    expect(s.matches.map((m) => [m.lotId, m.quantity.toString()])).toEqual([
      ['b1', '10'],
      ['b2', '5'],
    ]);
    expectDec(s.matches[0]!.proceedsEur, '1290');
    expectDec(s.matches[0]!.gainEur, '290');
    expectDec(s.matches[1]!.costEur, '555');
    expectDec(s.matches[1]!.proceedsEur, '645');
    expectDec(s.matches[1]!.gainEur, '90');
    expect(openLots.map((l) => [l.lotId, l.quantity.toString(), l.costEur.toString()])).toEqual([
      ['b2', '5', '555'],
    ]);
  });

  it('several sells walk through lots and leave the newest', () => {
    // b1 5 @ 10 = 50, b2 5 @ 20 = 100, b3 5 @ 30 = 150
    // sell 3  -> b1 3 (cost 30)
    // sell 4  -> b1 2 (cost 20) + b2 2 (cost 40) = 60
    // sell 4  -> b2 3 (cost 60) + b3 1 (cost 30) = 90
    // left b3: 4 units, cost 120
    const { openLots, disposals } = runFifo([
      buy('2024-01-01', 'A', '5', '10', { id: 'b1' }),
      buy('2024-01-02', 'A', '5', '20', { id: 'b2' }),
      buy('2024-01-03', 'A', '5', '30', { id: 'b3' }),
      sell('2024-02-01', 'A', '3', '40'),
      sell('2024-02-02', 'A', '4', '40'),
      sell('2024-02-03', 'A', '4', '40'),
    ]);
    expect(disposals.map((s) => s.costEur.toString())).toEqual(['30', '60', '90']);
    expect(openLots).toHaveLength(1);
    expect(openLots[0]!.lotId).toBe('b3');
    expectDec(openLots[0]!.quantity, '4');
    expectDec(openLots[0]!.costEur, '120');
  });

  it('same-day buy and sell works whatever order the rows arrive in', () => {
    // sell row listed first; same date, so the buy is processed first.
    // buy 10 @ 50 = 500; sell 10 @ 55 = 550; gain 50
    const { openLots, disposals } = runFifo([
      sell('2024-05-05', 'A', '10', '55'),
      buy('2024-05-05', 'A', '10', '50'),
    ]);
    expect(openLots).toHaveLength(0);
    expectDec(disposals[0]!.gainEur, '50');
  });

  it('same-day sell still matches an older lot first', () => {
    // b-old 1 @ 10; same day: b-new 1 @ 20, sell 1 @ 30 -> consumes b-old, gain 20
    const { openLots, disposals } = runFifo([
      buy('2024-01-01', 'A', '1', '10', { id: 'b-old' }),
      sell('2024-06-01', 'A', '1', '30'),
      buy('2024-06-01', 'A', '1', '20', { id: 'b-new' }),
    ]);
    expect(disposals[0]!.matches[0]!.lotId).toBe('b-old');
    expectDec(disposals[0]!.gainEur, '20');
    expect(openLots.map((l) => l.lotId)).toEqual(['b-new']);
  });

  it('within one date, lots are consumed in input (file) order', () => {
    // Month-level imports put every row on the 1st, so input order is the only order.
    // Input: buy 10 @ 1, sell 10, buy 10 @ 2, sell 5. Sequentially, the first sell takes
    // the @1 lot (cost 10) and the second takes half of the @2 lot (cost 10), leaving
    // 5 @ 2. Acquisitions-first within the day (#2) gives the same matches.
    const rows = [
      buy('2021-02-01', 'A', '10', '1', { id: 'r1' }),
      sell('2021-02-01', 'A', '10', '5', { id: 'r2' }),
      buy('2021-02-01', 'A', '10', '2', { id: 'r3' }),
      sell('2021-02-01', 'A', '5', '6', { id: 'r4' }),
    ];
    const { openLots, disposals } = runFifo(rows);
    expect(disposals.map((x) => x.matches.map((m) => m.lotId))).toEqual([['r1'], ['r3']]);
    expectDec(disposals[0]!.costEur, '10');
    expectDec(disposals[1]!.costEur, '10');
    expect(openLots.map((l) => [l.lotId, l.quantity.toString()])).toEqual([['r3', '5']]);

    // Swapping the two buys in the input changes which lot is first in, so input order
    // is what decides: the first sell now takes the @2 lot.
    const swapped = runFifo([rows[2]!, rows[1]!, rows[0]!, rows[3]!]);
    expect(swapped.disposals[0]!.matches.map((m) => m.lotId)).toEqual(['r3']);
    expectDec(swapped.disposals[0]!.costEur, '20');
  });

  it('fractional crypto down to the satoshi', () => {
    // b1 0.05 BTC @ 40000 + fee 2  -> 2000 + 2 = 2002
    // b2 0.02 BTC @ 50000 + fee 1  -> 1000 + 1 = 1001
    // sell 0.06 @ 60000 - fee 3    -> 3600 - 3 = 3597
    //   b1 0.05 cost 2002; b2 0.01 cost 1001*0.01/0.02 = 500.5; total 2502.5
    //   gain 3597 - 2502.5 = 1094.5
    // left 0.01 BTC cost 500.5; then sell 0.00999999 leaving 1 satoshi
    //   cost of 0.00999999 = 500.5 * 0.00999999/0.01 = 500.4994995
    //   1 sat left with cost 500.5 - 500.4994995 = 0.0005005
    const { openLots, disposals } = runFifo([
      buy('2024-01-01', 'BTC', '0.05', '40000', { fees: '2' }),
      buy('2024-02-01', 'BTC', '0.02', '50000', { fees: '1' }),
      sell('2024-03-01', 'BTC', '0.06', '60000', { fees: '3' }),
      sell('2024-04-01', 'BTC', '0.00999999', '60000'),
    ]);
    expectDec(disposals[0]!.costEur, '2502.5');
    expectDec(disposals[0]!.gainEur, '1094.5');
    expectDec(disposals[1]!.costEur, '500.4994995');
    expectDec(openLots[0]!.quantity, '0.00000001');
    expectDec(openLots[0]!.costEur, '0.0005005');
  });

  it('selling everything leaves no lots (zero holdings)', () => {
    const { openLots, costBasisTimeline } = runFifo([
      buy('2024-01-01', 'A', '3', '10'),
      buy('2024-01-02', 'A', '2', '10'),
      sell('2024-01-03', 'A', '5', '9'),
    ]);
    expect(openLots).toEqual([]);
    expectDec(costBasisTimeline.at(-1)!.costBasisEur, '0');
  });

  it('a sell exceeding holdings throws, even by one satoshi', () => {
    const txs = [
      buy('2024-01-01', 'BTC', '0.5', '40000'),
      sell('2024-01-02', 'BTC', '0.50000001', '41000', { id: 's-over' }),
    ];
    expect(() => runFifo(txs)).toThrow(InsufficientHoldingsError);
    try {
      runFifo(txs);
    } catch (e) {
      const err = e as InsufficientHoldingsError;
      expect(err.transactionId).toBe('s-over');
      expectDec(err.requested, '0.50000001');
      expectDec(err.available, '0.5');
    }
  });

  it('a sell with no prior buy throws', () => {
    expect(() => runFifo([sell('2024-01-02', 'A', '1', '1')])).toThrow(InsufficientHoldingsError);
  });

  it('a sell dated before its buy throws (dates, not row order, decide)', () => {
    expect(() =>
      runFifo([buy('2024-01-02', 'A', '1', '1'), sell('2024-01-01', 'A', '1', '1')]),
    ).toThrow(InsufficientHoldingsError);
  });

  it('pools lots across accounts: a sale anywhere consumes the oldest lot anywhere', () => {
    // b1: acc1 10 @ 1 = 10 (oldest)     b2: acc2 10 @ 2 = 20
    // sell 5 @ 3 from acc2 -> consumes b1 (acc1's lot): cost 5, proceeds 15, gain 10
    // sell 12 @ 3 from acc2 (more than acc2 bought) -> b1 5 (cost 5) + b2 7 (cost 14) = 19
    const { openLots, disposals } = runFifo([
      buy('2024-01-01', 'A', '10', '1', { id: 'b1', account: 'acc1' }),
      buy('2024-01-02', 'A', '10', '2', { id: 'b2', account: 'acc2' }),
      sell('2024-02-01', 'A', '5', '3', { account: 'acc2' }),
      sell('2024-03-01', 'A', '12', '3', { account: 'acc2' }),
    ]);
    expect(disposals[0]!.matches.map((m) => m.lotId)).toEqual(['b1']);
    expectDec(disposals[0]!.gainEur, '10');
    expect(disposals[0]!.accountId).toBe('acc2');
    expect(disposals[1]!.matches.map((m) => [m.lotId, m.quantity.toString()])).toEqual([
      ['b1', '5'],
      ['b2', '7'],
    ]);
    expectDec(disposals[1]!.costEur, '19');
    expect(openLots.map((l) => [l.lotId, l.accountId, l.quantity.toString()])).toEqual([
      ['b2', 'acc2', '3'],
    ]);
  });

  it('a transfer is not a sale: no disposal, lots and cost unchanged', () => {
    const { openLots, disposals } = runFifo([
      buy('2024-01-01', 'A', '10', '5', { id: 'b1', account: 'acc1' }),
      transfer('2024-01-02', 'A', '4', 'acc2', { fees: '1' }),
    ]);
    expect(disposals).toEqual([]);
    expect(openLots.map((l) => [l.lotId, l.quantity.toString(), l.costEur.toString()])).toEqual([
      ['b1', '10', '50'],
    ]);
  });

  it('the oversell check is against all accounts combined', () => {
    const txs = [
      buy('2024-01-01', 'A', '10', '1', { account: 'acc1' }),
      buy('2024-01-01', 'A', '10', '1', { account: 'acc2' }),
    ];
    const sellAll = sell('2024-01-02', 'A', '20', '1', { account: 'acc1' });
    const sellMore = sell('2024-01-02', 'A', '21', '1', { account: 'acc1' });
    expect(runFifo([...txs, sellAll]).openLots).toEqual([]);
    expect(() => runFifo([...txs, sellMore])).toThrow(InsufficientHoldingsError);
  });

  it('negative return: selling below cost gives a loss', () => {
    // buy 10 @ 100 + 1 = 1001; sell 10 @ 80 - 1 = 799; loss -202
    const { disposals } = runFifo([
      buy('2024-01-01', 'A', '10', '100', { fees: '1' }),
      sell('2024-06-01', 'A', '10', '80', { fees: '1' }),
    ]);
    expectDec(disposals[0]!.gainEur, '-202');
  });

  it('worthless disposal with a fee has negative proceeds', () => {
    // buy 5 @ 2 = 10; sell 5 @ 0 - fee 1 = -1; loss -11
    const { disposals } = runFifo([
      buy('2024-01-01', 'A', '5', '2'),
      sell('2024-06-01', 'A', '5', '0', { fees: '1' }),
    ]);
    expectDec(disposals[0]!.proceedsEur, '-1');
    expectDec(disposals[0]!.gainEur, '-11');
  });

  it('multiple currencies: cost at buy-date fx, proceeds at sell-date fx', () => {
    // buy 10 @ 100 USD + 1 USD fee, fx 0.90 -> 1001 * 0.90 = 900.90 EUR
    // sell 10 @ 100 USD - 1 USD fee, fx 0.95 -> 999 * 0.95 = 949.05 EUR
    // EUR gain 48.15 although the USD price did not move (FX gain - fees)
    const { disposals } = runFifo([
      buy('2024-01-01', 'US', '10', '100', { fees: '1', currency: 'USD', fx: '0.90' }),
      sell('2024-06-01', 'US', '10', '100', { fees: '1', currency: 'USD', fx: '0.95' }),
    ]);
    expectDec(disposals[0]!.costEur, '900.9');
    expectDec(disposals[0]!.proceedsEur, '949.05');
    expectDec(disposals[0]!.gainEur, '48.15');
  });

  it('records the open cost basis at the end of each trade date', () => {
    // 01-01: +100, +50 (same day) -> 150; 01-05: sell half of b1 -> 150 - 50 = 100
    const { costBasisTimeline } = runFifo([
      buy('2024-01-01', 'A', '2', '50', { id: 'b1' }),
      buy('2024-01-01', 'B', '1', '50'),
      sell('2024-01-05', 'A', '1', '70'),
    ]);
    expect(costBasisTimeline.map((p) => [p.date, p.costBasisEur.toString()])).toEqual([
      ['2024-01-01', '150'],
      ['2024-01-05', '100'],
    ]);
  });

  it('asOf ignores later rows', () => {
    const txs = [buy('2024-01-01', 'A', '2', '50'), sell('2024-02-01', 'A', '2', '70')];
    expect(runFifo(txs, { asOf: '2024-01-31' }).openLots).toHaveLength(1);
    expect(runFifo(txs, { asOf: '2024-02-01' }).openLots).toHaveLength(0);
  });

  it('a redemption linked to a CA subscription consumes that lot, not the oldest', () => {
    // s1 1000 units, s2 500 units; redeem 200 linked to s2 -> s1 untouched, s2 left 300
    const caSubscriptions = [{ id: 'ca2', transactionId: 's2' }];
    const { openLots, disposals } = runFifo(
      [
        subscribe('2023-01-01', 'CA', '1000', '1', { id: 's1' }),
        subscribe('2023-06-01', 'CA', '500', '1', { id: 's2' }),
        redeem('2024-01-01', 'CA', '200', '1.03', { caSubscriptionId: 'ca2' }),
      ],
      { caSubscriptions },
    );
    // proceeds 200*1.03 = 206, cost 200, gain 6
    expectDec(disposals[0]!.gainEur, '6');
    expect(disposals[0]!.type).toBe('redemption');
    expect(openLots.map((l) => [l.lotId, l.quantity.toString()])).toEqual([
      ['s1', '1000'],
      ['s2', '300'],
    ]);
  });

  it('an unlinked redemption is FIFO; a linked one cannot exceed its lot', () => {
    const txs = [
      subscribe('2023-01-01', 'CA', '100', '1', { id: 's1' }),
      subscribe('2023-06-01', 'CA', '100', '1', { id: 's2' }),
    ];
    const fifo = runFifo([...txs, redeem('2024-01-01', 'CA', '150', '1')]);
    expect(fifo.openLots.map((l) => [l.lotId, l.quantity.toString()])).toEqual([['s2', '50']]);

    const caSubscriptions = [{ id: 'ca1', transactionId: 's1' }];
    expect(() =>
      runFifo([...txs, redeem('2024-01-01', 'CA', '150', '1', { caSubscriptionId: 'ca1' })], {
        caSubscriptions,
      }),
    ).toThrow(InsufficientHoldingsError);
    expect(() =>
      runFifo([...txs, redeem('2024-01-01', 'CA', '1', '1', { caSubscriptionId: 'nope' })]),
    ).toThrow(LedgerError);
  });
});
