// Test-only fixture builders. Not exported from the package.
import { expect } from 'vitest';
import { Decimal } from './decimal';
import type { Transaction, TransactionType } from './types';

export const d = (s: string) => new Decimal(s);

/** Exact decimal equality with a readable failure message. */
export function expectDec(actual: Decimal | null | undefined, expected: string | Decimal) {
  expect(actual?.toString()).toBe(new Decimal(expected).toString());
}

/** |actual - expected| <= tol, for results of iterative or transcendental maths. */
export function expectClose(
  actual: Decimal | null | undefined,
  expected: string | Decimal,
  tol: string | Decimal = '1e-20',
) {
  expect(actual, 'value is null').toBeTruthy();
  const diff = (actual as Decimal).minus(expected).abs();
  expect(diff.lte(tol), `${actual?.toString()} != ${expected.toString()} (±${tol})`).toBe(true);
}

export interface Extra {
  id?: string;
  account?: string;
  fees?: string;
  currency?: string;
  fx?: string;
  caSubscriptionId?: string;
  withholding?: string;
}

let seq = 0;

function base(type: TransactionType, date: string, extra: Extra) {
  return {
    id: extra.id ?? `${type}-${++seq}`,
    accountId: extra.account ?? 'acc1',
    type,
    tradeDate: date,
    fees: d(extra.fees ?? '0'),
    currency: extra.currency ?? 'EUR',
    fxRateToEur: d(extra.fx ?? '1'),
    caSubscriptionId: extra.caSubscriptionId ?? null,
    withholdingTax: extra.withholding ? d(extra.withholding) : null,
  };
}

function trade(
  type: 'buy' | 'sell' | 'subscription' | 'redemption',
  date: string,
  asset: string,
  qty: string,
  price: string,
  extra: Extra = {},
): Transaction {
  return {
    ...base(type, date, extra),
    assetId: asset,
    quantity: d(qty),
    unitPrice: d(price),
    amount: null,
  };
}

function flow(
  type: 'dividend' | 'interest' | 'deposit' | 'withdrawal' | 'fee',
  date: string,
  amount: string,
  extra: Extra & { asset?: string } = {},
): Transaction {
  return {
    ...base(type, date, extra),
    assetId: extra.asset ?? null,
    quantity: null,
    unitPrice: null,
    amount: d(amount),
  };
}

type TradeArgs = [date: string, asset: string, qty: string, price: string, extra?: Extra];
type FlowArgs = [date: string, amount: string, extra?: Extra & { asset?: string }];

export const buy = (...a: TradeArgs) => trade('buy', ...a);
export const sell = (...a: TradeArgs) => trade('sell', ...a);
export const subscribe = (...a: TradeArgs) => trade('subscription', ...a);
export const redeem = (...a: TradeArgs) => trade('redemption', ...a);
export const dividend = (...a: FlowArgs) => flow('dividend', ...a);
export const interest = (...a: FlowArgs) => flow('interest', ...a);
export const deposit = (...a: FlowArgs) => flow('deposit', ...a);
export const withdraw = (...a: FlowArgs) => flow('withdrawal', ...a);
export const fee = (...a: FlowArgs) => flow('fee', ...a);

/** Moves `qty` of `asset` from `extra.account` (default acc1) to `to`. */
export function transfer(
  date: string,
  asset: string,
  qty: string,
  to: string,
  extra: Extra = {},
): Transaction {
  return {
    ...base('transfer', date, extra),
    assetId: asset,
    quantity: d(qty),
    unitPrice: null,
    amount: null,
    transferToAccountId: to,
  };
}
