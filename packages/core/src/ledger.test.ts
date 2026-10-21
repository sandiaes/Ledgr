import { describe, expect, it } from 'vitest';
import { LedgerError } from './errors';
import { cashBalanceEur, cashEffectEur, prepareLedger, validateTransaction } from './ledger';
import {
  buy,
  d,
  deposit,
  dividend,
  expectDec,
  fee,
  interest,
  redeem,
  sell,
  subscribe,
  transfer,
  withdraw,
} from './test-utils';
import type { Transaction } from './types';

describe('validateTransaction', () => {
  const ok = buy('2024-01-01', 'A', '1', '10');

  it('accepts well-formed rows of every type', () => {
    for (const tx of [
      ok,
      sell('2024-01-01', 'A', '1', '0'),
      subscribe('2024-01-01', 'CA', '100', '1'),
      redeem('2024-01-01', 'CA', '100', '1', { caSubscriptionId: 'x' }),
      dividend('2024-01-01', '1'),
      interest('2024-01-01', '1'),
      deposit('2024-01-01', '1'),
      withdraw('2024-01-01', '1'),
      fee('2024-01-01', '1'),
      transfer('2024-01-01', 'A', '1', 'acc2', { fees: '1' }),
    ]) {
      expect(() => validateTransaction(tx)).not.toThrow();
    }
  });

  const bad: [string, Partial<Transaction>, RegExp][] = [
    ['bad date', { tradeDate: '2024-02-30' }, /Invalid trade date/],
    ['negative fees', { fees: d('-1') }, /Fees/],
    ['zero fx', { fxRateToEur: d('0') }, /fxRateToEur must be > 0/],
    ['EUR with fx != 1', { fxRateToEur: d('1.1') }, /EUR rows/],
    ['no asset', { assetId: null }, /requires an asset/],
    ['zero quantity', { quantity: d('0') }, /quantity > 0/],
    ['no price', { unitPrice: null }, /unitPrice >= 0/],
    ['negative price', { unitPrice: d('-1') }, /unitPrice >= 0/],
    ['amount on a trade', { amount: d('1') }, /must not have an amount/],
    ['CA link on a buy', { caSubscriptionId: 'x' }, /only allowed on redemptions/],
  ];
  it.each(bad)('rejects a trade with %s', (_, patch, message) => {
    expect(() => validateTransaction({ ...ok, ...patch })).toThrow(message);
  });

  it('withholding tax: dividends and interest only, between 0 and the amount', () => {
    const div = dividend('2024-01-01', '10');
    expect(() => validateTransaction({ ...div, withholdingTax: d('10') })).not.toThrow();
    expect(() =>
      validateTransaction({ ...interest('2024-01-01', '10'), withholdingTax: d('2.8') }),
    ).not.toThrow();
    expect(() => validateTransaction({ ...div, withholdingTax: d('10.01') })).toThrow(/exceeds/);
    expect(() => validateTransaction({ ...div, withholdingTax: d('-1') })).toThrow(/>= 0/);
    expect(() =>
      validateTransaction({ ...buy('2024-01-01', 'A', '1', '1'), withholdingTax: d('1') }),
    ).toThrow(/only allowed on dividends and interest/);
  });

  it('rejects malformed transfers', () => {
    const t = transfer('2024-01-01', 'A', '1', 'acc2');
    expect(() => validateTransaction({ ...t, assetId: null })).toThrow(/requires an asset/);
    expect(() => validateTransaction({ ...t, quantity: d('0') })).toThrow(/quantity > 0/);
    expect(() => validateTransaction({ ...t, unitPrice: d('1') })).toThrow(/unitPrice or amount/);
    expect(() => validateTransaction({ ...t, amount: d('1') })).toThrow(/unitPrice or amount/);
    expect(() => validateTransaction({ ...t, transferToAccountId: null })).toThrow(
      /requires transferToAccountId/,
    );
    expect(() => validateTransaction({ ...t, transferToAccountId: 'acc1' })).toThrow(
      /another account/,
    );
    expect(() =>
      validateTransaction({ ...buy('2024-01-01', 'A', '1', '1'), transferToAccountId: 'acc2' }),
    ).toThrow(/only allowed on transfers/);
  });

  it('rejects malformed cash rows', () => {
    const div = dividend('2024-01-01', '5', { id: 'div-1' });
    expect(() => validateTransaction({ ...div, amount: null })).toThrow(/amount > 0/);
    expect(() => validateTransaction({ ...div, amount: d('0') })).toThrow(/amount > 0/);
    expect(() => validateTransaction({ ...div, quantity: d('1') })).toThrow(/must not have/);
    expect(() => validateTransaction({ ...div, amount: null })).toThrow(LedgerError);
    expect(() => validateTransaction({ ...div, amount: null })).toThrow(/transaction div-1/);
  });
});

describe('prepareLedger', () => {
  it('sorts by date, then acquisitions < other < disposals, then input order', () => {
    const rows = [
      sell('2024-01-02', 'A', '1', '1', { id: 's' }),
      transfer('2024-01-02', 'A', '1', 'acc2', { id: 'tr' }),
      dividend('2024-01-02', '1', { id: 'div' }),
      buy('2024-01-02', 'A', '1', '1', { id: 'b2' }),
      buy('2024-01-01', 'A', '1', '1', { id: 'b1' }),
      buy('2024-01-02', 'A', '1', '1', { id: 'b3' }),
    ];
    expect(prepareLedger(rows).map((t) => t.id)).toEqual(['b1', 'b2', 'b3', 'tr', 'div', 's']);
    expect(prepareLedger(rows, '2024-01-01').map((t) => t.id)).toEqual(['b1']);
  });

  it('rejects an invalid asOf', () => {
    expect(() => prepareLedger([], '2024-13-01')).toThrow(/Invalid ISO date/);
  });
});

describe('cash', () => {
  it('each row type moves cash as documented', () => {
    // all fees 1; USD rows at fx 0.5
    const f = { fees: '1' };
    expectDec(cashEffectEur(deposit('2024-01-01', '100', f)), '99');
    expectDec(cashEffectEur(withdraw('2024-01-01', '100', f)), '-101');
    expectDec(cashEffectEur(buy('2024-01-01', 'A', '2', '10', f)), '-21');
    expectDec(cashEffectEur(subscribe('2024-01-01', 'CA', '2', '10', f)), '-21');
    expectDec(cashEffectEur(sell('2024-01-01', 'A', '2', '10', f)), '19');
    expectDec(cashEffectEur(redeem('2024-01-01', 'CA', '2', '10', f)), '19');
    expectDec(cashEffectEur(dividend('2024-01-01', '10', f)), '9');
    expectDec(cashEffectEur(interest('2024-01-01', '10', f)), '9');
    expectDec(cashEffectEur(fee('2024-01-01', '10', f)), '-11');
    // a transfer moves units, not cash; only its fee leaves
    expectDec(cashEffectEur(transfer('2024-01-01', 'A', '5', 'acc2', f)), '-1');
    // 10 - 2.8 withheld - 1 fee
    expectDec(cashEffectEur(dividend('2024-01-01', '10', { ...f, withholding: '2.8' })), '6.2');
    expectDec(cashEffectEur(interest('2024-01-01', '10', { ...f, withholding: '2.8' })), '6.2');
    // (10 USD - 1 USD) * 0.5
    expectDec(
      cashEffectEur(dividend('2024-01-01', '10', { ...f, currency: 'USD', fx: '0.5' })),
      '4.5',
    );
  });

  it('cash balance accumulates up to asOf', () => {
    // +1000, -(5*100+2) = -502, +(5*110-2) = +548 -> 1046 by 03-01; +10 dividend on 04-01
    const txs = [
      deposit('2024-01-01', '1000'),
      buy('2024-02-01', 'A', '5', '100', { fees: '2' }),
      sell('2024-03-01', 'A', '5', '110', { fees: '2' }),
      dividend('2024-04-01', '10'),
    ];
    expectDec(cashBalanceEur(txs, '2024-03-01'), '1046');
    expectDec(cashBalanceEur(txs), '1056');
  });
});
