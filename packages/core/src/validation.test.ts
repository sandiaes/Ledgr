import { describe, expect, it } from 'vitest';
import { InsufficientHoldingsError } from './errors';
import { runFifo } from './fifo';
import { buy, dividend, expectDec, fee, interest, sell, transfer } from './test-utils';
import type { Transaction } from './types';
import {
  editableInApp,
  formFromTransaction,
  maxDisposable,
  mostUsedAccount,
  previewTransaction,
  sellableAccounts,
  unitsHeld,
  validateLedgerChange,
  validateNewTransaction,
  type LedgerChangeIssue,
  type LedgerContext,
  type TransactionForm,
  type TransactionIssue,
} from './validation';

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

// ---------------------------------------------------------------------------
// The New transaction form (validateNewTransaction and friends)
// ---------------------------------------------------------------------------

const TODAY = '2024-06-15';
// degiro: 10 A @ 10 on 1 Mar, sells 6 on 1 May (4 left, cost 40)
// ibkr:    7 A @ 12 on 1 Mar (cost 84)
// CA is a certificado; 'closed' is a soft-deleted broker (not offered)
const ledgerRows = [
  buy('2024-03-01', 'A', '10', '10', { account: 'degiro', id: 'b-degiro' }),
  sell('2024-05-01', 'A', '6', '11', { account: 'degiro', id: 's-degiro' }),
  buy('2024-03-01', 'A', '7', '12', { account: 'ibkr', id: 'b-ibkr' }),
];
const context = (transactions: Transaction[] = ledgerRows): LedgerContext => ({
  transactions,
  assets: [
    { id: 'A', assetType: 'etf' },
    { id: 'B', assetType: 'stock' },
    { id: 'CA', assetType: 'certificado_aforro' },
  ],
  accountIds: ['degiro', 'ibkr'],
});
const form = (over: Partial<TransactionForm> = {}): TransactionForm => ({
  type: 'buy',
  accountId: 'degiro',
  assetId: 'A',
  date: TODAY,
  quantity: '3',
  total: '1234.5',
  fee: '',
  ...over,
});
const check = (
  f: Partial<TransactionForm>,
  opts: { original?: Transaction; rows?: Transaction[] } = {},
) =>
  validateNewTransaction({
    form: form(f),
    id: 'new-1',
    ledger: context(opts.rows),
    today: TODAY,
    original: opts.original,
  });
/** The issues as `field:code` strings. */
const codes = (f: Partial<TransactionForm>, opts: Parameters<typeof check>[1] = {}) =>
  check(f, opts).issues.map((i) => `${i.field}:${i.code}`);

describe('validateNewTransaction: a valid row', () => {
  it('builds a buy in EUR at fx 1 with the unit price derived from the total', () => {
    const r = check({ fee: '2,5' });
    expect(r.ok).toBe(true);
    const row = r.row as Transaction;
    expect(row).toMatchObject({
      id: 'new-1',
      type: 'buy',
      accountId: 'degiro',
      assetId: 'A',
      tradeDate: TODAY,
      amount: null,
      currency: 'EUR',
      withholdingTax: null,
      caSubscriptionId: null,
      transferToAccountId: null,
    });
    expectDec(row.quantity, '3');
    expectDec(row.unitPrice, '411.5');
    expectDec(row.fees, '2.5');
    expectDec(row.fxRateToEur, '1');
    expect(row.tradeDatePrecision).toBeUndefined(); // day precision
  });

  it('a total that does not divide stores the unit price to 18 decimals', () => {
    expectDec(check({ quantity: '3', total: '100' }).row?.unitPrice, '33.333333333333333333');
  });

  it('dividend: the amount received, no quantity, no fee', () => {
    const row = check({ type: 'dividend', quantity: '', total: '12.34' }).row as Transaction;
    expect(row).toMatchObject({ type: 'dividend', assetId: 'A', quantity: null, unitPrice: null });
    expectDec(row.amount, '12.34');
    expectDec(row.fees, '0');
  });

  it('interest: no asset (cash interest)', () => {
    const row = check({ type: 'interest', assetId: null, quantity: '', total: '0.42' })
      .row as Transaction;
    expect(row).toMatchObject({ type: 'interest', assetId: null, accountId: 'degiro' });
    expectDec(row.amount, '0.42');
  });

  it('today is allowed; quantities in the input stay exact', () => {
    expect(check({ date: TODAY, quantity: '0.000000000000000001', total: '1' }).ok).toBe(true);
  });
});

describe('validateNewTransaction: blocked values', () => {
  it('quantity: empty, zero, negative, not a number, thousands separators, too precise', () => {
    expect(codes({ quantity: '' })).toEqual(['quantity:required']);
    expect(codes({ quantity: '0' })).toEqual(['quantity:not_positive']);
    expect(codes({ quantity: '0,000' })).toEqual(['quantity:not_positive']);
    expect(codes({ quantity: '-1' })).toEqual(['quantity:not_positive']);
    expect(codes({ quantity: 'abc' })).toEqual(['quantity:not_a_number']);
    expect(codes({ quantity: '1e3' })).toEqual(['quantity:not_a_number']);
    expect(codes({ quantity: '1.234,5' })).toEqual(['quantity:separators']);
    expect(codes({ quantity: '0.0000000000000000001' })).toEqual(['quantity:too_many_decimals']);
  });

  it('total / amount received: empty, zero, negative', () => {
    expect(codes({ total: '' })).toEqual(['total:required']);
    expect(codes({ total: '0' })).toEqual(['total:not_positive']);
    expect(codes({ total: '-5' })).toEqual(['total:not_positive']);
    expect(codes({ type: 'dividend', total: '0' })).toEqual(['total:not_positive']);
    expect(codes({ type: 'interest', assetId: null, total: '-0.01' })).toEqual([
      'total:not_positive',
    ]);
    // so small that the unit price would be stored as 0
    expect(codes({ quantity: '3', total: '0.000000000000000001' })).toEqual(['total:not_positive']);
  });

  it('fee: optional and >= 0; none on income (the amount is already net)', () => {
    expect(check({ fee: '' }).ok).toBe(true);
    expect(check({ fee: '0' }).ok).toBe(true);
    expect(codes({ fee: '-1' })).toEqual(['fee:negative']);
    expect(codes({ fee: 'x' })).toEqual(['fee:not_a_number']);
    expect(codes({ type: 'dividend', fee: '1' })).toEqual(['fee:not_allowed']);
    expect(check({ type: 'dividend', fee: '0' }).ok).toBe(true);
  });

  it('date: invalid, or in the future', () => {
    expect(codes({ date: '2024-06-16' })).toEqual(['date:future']);
    expect(codes({ date: '2025-01-01', type: 'sell', quantity: '1' })).toEqual(['date:future']);
    expect(codes({ date: '2024-02-30' })).toEqual(['date:invalid']);
    expect(codes({ date: '15/06/2024' })).toEqual(['date:invalid']);
    expect(codes({ date: '' })).toEqual(['date:invalid']);
  });

  it('asset and broker: required, known, no certificado, none for interest', () => {
    expect(codes({ assetId: null })).toEqual(['asset:required']);
    expect(codes({ type: 'dividend', assetId: null })).toEqual(['asset:required']);
    expect(codes({ assetId: 'nope' })).toEqual(['asset:unknown']);
    expect(codes({ assetId: 'CA' })).toEqual(['asset:not_allowed']);
    expect(codes({ type: 'interest', assetId: 'A' })).toEqual(['asset:not_allowed']);
    expect(codes({ accountId: null })).toEqual(['account:required']);
    expect(codes({ accountId: 'closed' })).toEqual(['account:unknown']);
  });

  it('reports every field problem at once', () => {
    expect(codes({ quantity: '0', total: '', date: '2099-01-01', accountId: null })).toEqual([
      'account:required',
      'date:future',
      'quantity:not_positive',
      'total:required',
    ]);
  });

  it('refuses the types the form does not offer', () => {
    expect(codes({ type: 'deposit' as TransactionForm['type'] })).toEqual(['type:unsupported']);
  });
});

describe('validateNewTransaction: a sale is limited to its broker (FIFO per account)', () => {
  const sale = (over: Partial<TransactionForm>) => check({ type: 'sell', ...over });

  it('degiro can sell its 4 left; 4 + 1e-18 is refused, naming held and available', () => {
    expect(sale({ quantity: '4', total: '48' }).ok).toBe(true);
    const r = sale({ quantity: '4.000000000000000001', total: '48' });
    expect(r.issues).toHaveLength(1);
    const issue = r.issues[0] as Extract<TransactionIssue, { code: 'exceeds_holdings' }>;
    expect(issue).toMatchObject({
      field: 'quantity',
      code: 'exceeds_holdings',
      accountId: 'degiro',
    });
    expectDec(issue.held, '4');
    expectDec(issue.available, '4');
  });

  it('ibkr’s 7 units do not count for degiro, and the other way round', () => {
    expect(codes({ type: 'sell', quantity: '5', total: '60' })).toEqual([
      'quantity:exceeds_holdings',
    ]);
    expect(sale({ accountId: 'ibkr', quantity: '7', total: '84' }).ok).toBe(true);
    expect(codes({ type: 'sell', accountId: 'ibkr', quantity: '7.5', total: '90' })).toEqual([
      'quantity:exceeds_holdings',
    ]);
  });

  it('a backdated sale may not take units a later sale needs', () => {
    // On 1 April degiro holds 10, but the 1 May sale needs 6 of them: 4 can be sold.
    const r = sale({ date: '2024-04-01', quantity: '5', total: '50' });
    const issue = r.issues[0] as Extract<TransactionIssue, { code: 'exceeds_holdings' }>;
    expect(issue.code).toBe('exceeds_holdings');
    expectDec(issue.held, '10');
    expectDec(issue.available, '4');
    expect(sale({ date: '2024-04-01', quantity: '4', total: '40' }).ok).toBe(true);
  });

  it('a broker with no units of the asset on the date is refused', () => {
    expect(codes({ type: 'sell', assetId: 'B', quantity: '1', total: '1' })).toEqual([
      'account:no_units',
    ]);
    // before the first buy
    expect(codes({ type: 'sell', date: '2024-02-28', quantity: '1', total: '1' })).toEqual([
      'account:no_units',
    ]);
  });

  it('a sale the same day as a buy may use it (buys come first in a day)', () => {
    const rows = [...ledgerRows, buy(TODAY, 'B', '2', '5', { account: 'ibkr' })];
    expect(
      check({ type: 'sell', accountId: 'ibkr', assetId: 'B', quantity: '2', total: '11' }, { rows })
        .ok,
    ).toBe(true);
  });

  it('units transferred in count, units transferred out do not', () => {
    const rows = [...ledgerRows, transfer('2024-06-01', 'A', '3', 'degiro', { account: 'ibkr' })];
    expect(check({ type: 'sell', quantity: '7', total: '70' }, { rows }).ok).toBe(true);
    expect(
      codes({ type: 'sell', accountId: 'ibkr', quantity: '5', total: '50' }, { rows }),
    ).toEqual(['quantity:exceeds_holdings']);
  });
});

describe('validateNewTransaction: edits', () => {
  const original = ledgerRows[1] as Transaction; // degiro sells 6 on 1 May

  it('the row itself is left out: the 6 sold can become 10, not 11', () => {
    const r = check(
      { type: 'sell', date: '2024-05-01', quantity: '10', total: '110' },
      { original },
    );
    expect(r.ok).toBe(true);
    expect(r.row?.id).toBe('s-degiro'); // keeps its id
    expect(
      codes({ type: 'sell', date: '2024-05-01', quantity: '11', total: '121' }, { original }),
    ).toEqual(['quantity:exceeds_holdings']);
  });

  it('an edit that leaves a later sale uncovered is refused, naming that sale', () => {
    const buyRow = ledgerRows[0] as Transaction; // 10 bought; the 1 May sale needs 6
    const r = check({ date: '2024-03-01', quantity: '5', total: '50' }, { original: buyRow });
    expect(r.issues).toHaveLength(1);
    const issue = r.issues[0] as LedgerChangeIssue;
    expect(issue).toMatchObject({
      field: 'ledger',
      code: 'breaks_later_sale',
      transactionId: 's-degiro',
      date: '2024-05-01',
      accountId: 'degiro',
      assetId: 'A',
    });
    expectDec(issue.requested, '6');
    expectDec(issue.available, '5');
    // moving the buy after the sale breaks it too
    expect(
      codes({ date: '2024-05-02', quantity: '10', total: '100' }, { original: buyRow }),
    ).toEqual(['ledger:breaks_later_sale']);
    expect(check({ date: '2024-03-01', quantity: '6', total: '60' }, { original: buyRow }).ok).toBe(
      true,
    );
  });

  it('the type cannot change, and rows the form cannot show cannot be edited', () => {
    expect(
      codes({ type: 'buy', date: '2024-05-01', quantity: '6', total: '66' }, { original }),
    ).toEqual(['type:cannot_change']);
    const usd = buy('2024-03-01', 'A', '1', '10', { currency: 'USD', fx: '0.9', account: 'ibkr' });
    expect(codes({}, { original: usd })).toEqual(['type:not_editable']);
    const taxed = dividend('2024-03-01', '10', { asset: 'A', withholding: '1.5' });
    expect(codes({ type: 'dividend' }, { original: taxed })).toEqual(['type:not_editable']);
  });

  it('saving an unchanged trade keeps its stored unit price exactly', () => {
    for (const [q, p] of [
      ['3', '33.333333333333333333'],
      ['3', '123.456'],
      ['7', '0.123456789012345678'],
      ['0.00012345', '61234.987654321'],
    ] as const) {
      const row = buy('2024-03-01', 'B', q, p, { account: 'ibkr', id: 'edit-me' });
      const prefill = formFromTransaction(row);
      const r = check(prefill, { original: row, rows: [...ledgerRows, row] });
      expect(r.ok, `${q} @ ${p}`).toBe(true);
      expectDec(r.row?.unitPrice, p);
    }
    // the shortest total that gives the same price is prefilled
    expect(formFromTransaction(buy('2024-03-01', 'B', '3', '33.333333333333333333')).total).toBe(
      '100',
    );
    expect(formFromTransaction(buy('2024-03-01', 'B', '3', '123.456')).total).toBe('370.368');
  });

  it('an imported month-level date stays month-level unless the date changes', () => {
    const monthly: Transaction = {
      ...buy('2024-03-01', 'B', '2', '50', { account: 'ibkr', id: 'm1' }),
      tradeDatePrecision: 'month',
    };
    const rows = [...ledgerRows, monthly];
    const same = check(
      { ...formFromTransaction(monthly), total: '120' },
      { original: monthly, rows },
    );
    expect(same.row?.tradeDatePrecision).toBe('month');
    const moved = check(
      { ...formFromTransaction(monthly), date: '2024-03-05' },
      { original: monthly, rows },
    );
    expect(moved.row?.tradeDatePrecision).toBeUndefined();
  });
});

describe('validateLedgerChange (delete)', () => {
  it('refuses a delete that leaves a later sale uncovered, naming it', () => {
    const issue = validateLedgerChange({
      transactions: ledgerRows,
      change: { kind: 'delete', id: 'b-degiro' },
    });
    expect(issue).toMatchObject({ transactionId: 's-degiro', date: '2024-05-01' });
    expectDec(issue?.available, '0');
    expect(
      validateLedgerChange({
        transactions: ledgerRows,
        change: { kind: 'delete', id: 's-degiro' },
      }),
    ).toBeNull();
    expect(
      validateLedgerChange({ transactions: ledgerRows, change: { kind: 'delete', id: 'b-ibkr' } }),
    ).toBeNull();
  });

  it('deleting a transfer in is refused when a later sale used those units', () => {
    const rows = [
      buy('2024-01-01', 'A', '5', '1', { account: 'ex' }),
      transfer('2024-02-01', 'A', '5', 'wal', { account: 'ex', id: 'tr' }),
      sell('2024-03-01', 'A', '5', '1', { account: 'wal', id: 'sold' }),
    ];
    expect(
      validateLedgerChange({ transactions: rows, change: { kind: 'delete', id: 'tr' } }),
    ).toMatchObject({ transactionId: 'sold', accountId: 'wal' });
  });
});

describe('editableInApp', () => {
  it('only rows the form can show exactly', () => {
    expect(editableInApp(ledgerRows[0] as Transaction)).toBe(true);
    expect(editableInApp(dividend('2024-03-01', '10', { asset: 'A' }))).toBe(true);
    expect(editableInApp(interest('2024-03-01', '1'))).toBe(true);
    expect(editableInApp(interest('2024-03-01', '1', { asset: 'A' }))).toBe(false);
    expect(editableInApp(dividend('2024-03-01', '10'))).toBe(false); // no asset
    expect(editableInApp(dividend('2024-03-01', '10', { asset: 'A', fees: '1' }))).toBe(false);
    expect(editableInApp(fee('2024-03-01', '5'))).toBe(false);
    expect(editableInApp(transfer('2024-03-01', 'A', '1', 'x'))).toBe(false);
    expect(editableInApp(buy('2024-03-01', 'A', '1', '1', { currency: 'USD', fx: '0.9' }))).toBe(
      false,
    );
  });
});

describe('sellableAccounts and mostUsedAccount', () => {
  it('lists the brokers holding units on the date, most first, with what they can sell', () => {
    const list = sellableAccounts(ledgerRows, { assetId: 'A', date: '2024-04-01' });
    expect(list.map((a) => [a.accountId, a.held.toString(), a.available.toString()])).toEqual([
      ['degiro', '10', '4'],
      ['ibkr', '7', '7'],
    ]);
    expect(
      sellableAccounts(ledgerRows, { assetId: 'A', date: TODAY }).map((a) => a.accountId),
    ).toEqual(['ibkr', 'degiro']);
    expect(sellableAccounts(ledgerRows, { assetId: 'B', date: TODAY })).toEqual([]);
  });

  const accountIds = ['degiro', 'ibkr', 'tr'];
  const used = (rows: Transaction[], type: TransactionForm['type'] = 'buy', ids = accountIds) =>
    mostUsedAccount({ transactions: rows, type, today: TODAY, accountIds: ids });

  it('the broker with the most rows of the type in the last 12 months', () => {
    const rows = [
      buy('2024-01-01', 'A', '1', '1', { account: 'degiro' }),
      buy('2024-02-01', 'A', '1', '1', { account: 'degiro' }),
      buy('2024-06-01', 'A', '1', '1', { account: 'ibkr' }),
    ];
    expect(used(rows)).toBe('degiro');
  });

  it('ties go to the most recent row; rows older than 12 months only count when none are newer', () => {
    const tie = [
      buy('2024-01-01', 'A', '1', '1', { account: 'degiro' }),
      buy('2024-02-01', 'A', '1', '1', { account: 'ibkr' }),
    ];
    expect(used(tie)).toBe('ibkr');
    const old = [
      buy('2022-01-01', 'A', '1', '1', { account: 'ibkr' }),
      buy('2022-02-01', 'A', '1', '1', { account: 'ibkr' }),
      buy('2024-05-01', 'A', '1', '1', { account: 'degiro' }),
    ];
    expect(used(old)).toBe('degiro');
    expect(used(old.slice(0, 2))).toBe('ibkr'); // all time when none in 12 months
    // 12 months to today: 2023-06-15 itself is outside the window, 2023-06-16 inside
    expect(
      used([
        buy('2023-06-15', 'A', '1', '1', { account: 'ibkr' }),
        buy('2023-06-15', 'A', '1', '1', { account: 'ibkr' }),
        buy('2023-06-16', 'A', '1', '1', { account: 'degiro' }),
      ]),
    ).toBe('degiro');
  });

  it('counts only that type, else all types; deleted brokers are never proposed', () => {
    const rows = [
      buy('2024-01-01', 'A', '1', '1', { account: 'degiro' }),
      dividend('2024-02-01', '1', { asset: 'A', account: 'tr' }),
    ];
    expect(used(rows, 'dividend')).toBe('tr');
    expect(used(rows, 'interest')).toBe('tr'); // no interest rows: all types, most recent
    expect(used(rows, 'buy', ['ibkr', 'tr'])).toBe('tr');
    expect(used([], 'buy')).toBeNull();
  });

  it('sell: the broker with the most units of the asset on the date', () => {
    const at = (date: string) =>
      mostUsedAccount({
        transactions: ledgerRows,
        type: 'sell',
        today: TODAY,
        accountIds,
        assetId: 'A',
        date,
      });
    expect(at('2024-04-01')).toBe('degiro'); // 10 vs 7
    expect(at(TODAY)).toBe('ibkr'); // 4 vs 7
    expect(at('2024-02-01')).toBeNull();
  });
});

describe('previewTransaction', () => {
  const preview = (row: Transaction, replaceId?: string) =>
    previewTransaction({ transactions: ledgerRows, row, asOf: TODAY, replaceId });

  it('a buy: units, cost basis and average cost before and after, in the broker and overall', () => {
    const row = check({ accountId: 'ibkr', quantity: '5', total: '60', fee: '1' })
      .row as Transaction;
    const p = preview(row);
    expectDec(p.totalEur, '61'); // cost with the fee
    expectDec(p.account?.before.units, '7');
    expectDec(p.account?.before.costBasisEur, '84');
    expectDec(p.account?.before.averageCostEur, '12');
    expectDec(p.account?.after.units, '12');
    expectDec(p.account?.after.costBasisEur, '145');
    expectDec(p.overall?.before.units, '11'); // degiro 4 + ibkr 7
    expectDec(p.overall?.before.costBasisEur, '124');
    expectDec(p.overall?.after.units, '16');
    expectDec(p.overall?.after.costBasisEur, '185');
    expect(p.realizedGainEur).toBeNull();
  });

  it('a sell: the realized gain of this sale (FIFO in its broker, fee deducted)', () => {
    const row = check({ type: 'sell', quantity: '2', total: '30', fee: '1' }).row as Transaction;
    const p = preview(row);
    expectDec(p.totalEur, '29'); // proceeds net of the fee
    expectDec(p.realizedGainEur, '9'); // 29 - 2 x 10
    expectDec(p.account?.before.units, '4');
    expectDec(p.account?.after.units, '2');
    expectDec(p.account?.after.costBasisEur, '20');
    expectDec(p.overall?.after.units, '9');
    // selling everything: no average cost left
    const all = check({ type: 'sell', quantity: '4', total: '48' }).row as Transaction;
    expect(preview(all).account?.after.averageCostEur).toBeNull();
  });

  it('an edit compares the ledger with the original row to the ledger with the new one', () => {
    const original = ledgerRows[1] as Transaction;
    const row = check(
      { type: 'sell', date: '2024-05-01', quantity: '10', total: '110' },
      { original },
    ).row as Transaction;
    const p = preview(row, original.id);
    expectDec(p.account?.before.units, '4');
    expectDec(p.account?.after.units, '0');
    expectDec(p.realizedGainEur, '10'); // 110 - 100
  });

  it('income changes no position; interest has none', () => {
    const div = check({ type: 'dividend', total: '5' }).row as Transaction;
    const p = preview(div);
    expectDec(p.totalEur, '5');
    expect(p.account?.before.units.eq(p.account.after.units)).toBe(true);
    const int = check({ type: 'interest', assetId: null, total: '1' }).row as Transaction;
    expect(preview(int).account).toBeNull();
  });
});
