import { describe, expect, it } from 'vitest';
import { snapshotFromRow, transactionFromRow } from './rows';

describe('row mappers', () => {
  it('parses numerics from text exactly and keeps month-level dates', () => {
    const tx = transactionFromRow({
      id: 't',
      account_id: 'a',
      asset_id: 'x',
      type: 'buy',
      trade_date: '2024-03-01',
      trade_date_precision: 'month',
      quantity: '0.123456789012345678',
      unit_price: '41234.5',
      amount: null,
      fees: '0',
      currency: 'EUR',
      fx_rate_to_eur: '1',
      ca_subscription_id: null,
      withholding_tax: null,
      transfer_to_account_id: null,
    });
    expect(tx.quantity?.toString()).toBe('0.123456789012345678');
    expect(tx.tradeDatePrecision).toBe('month');
    expect(transactionFromRow({ ...rowOf(tx), trade_date_precision: 'day' })).not.toHaveProperty(
      'tradeDatePrecision',
    );
  });

  it('reads a snapshot as value and net invested', () => {
    const s = snapshotFromRow({
      snapshot_date: '2026-10-22',
      total_value_eur: '12345.678901234567',
      net_contributions_eur: '-10.5',
    });
    expect([s.date, s.valueEur.toString(), s.netInvestedEur.toString()]).toEqual([
      '2026-10-22',
      '12345.678901234567',
      '-10.5',
    ]);
  });
});

function rowOf(tx: ReturnType<typeof transactionFromRow>) {
  return {
    id: tx.id,
    account_id: tx.accountId,
    asset_id: tx.assetId,
    type: tx.type,
    trade_date: tx.tradeDate,
    quantity: tx.quantity?.toString(),
    unit_price: tx.unitPrice?.toString(),
    amount: null,
    fees: tx.fees.toString(),
    currency: tx.currency,
    fx_rate_to_eur: tx.fxRateToEur.toString(),
  };
}
