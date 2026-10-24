import { dec, type TransactionType } from '@ledgr/core';
import { ACTIVITY_ICONS, listedTotal } from './listing';

const row = (type: TransactionType, total: string) => ({ type, totalEur: dec(total) });

describe('listedTotal', () => {
  it('shows money out with a minus and money in with a plus, amount unchanged', () => {
    for (const type of ['buy', 'subscription', 'fee'] as const) {
      const t = listedTotal(row(type, '1000'));
      expect([t.value.toString(), t.sign]).toEqual(['-1000', true]);
    }
    for (const type of ['sell', 'redemption', 'dividend', 'interest'] as const) {
      const t = listedTotal(row(type, '550.25'));
      expect([t.value.toString(), t.sign]).toEqual(['550.25', true]);
    }
  });

  it('leaves other rows unsigned', () => {
    for (const type of ['transfer', 'deposit', 'withdrawal'] as const) {
      const t = listedTotal(row(type, '5'));
      expect([t.value.toString(), t.sign]).toEqual(['5', false]);
    }
  });

  it('does not change the row', () => {
    const r = row('buy', '1000');
    listedTotal(r);
    expect(r.totalEur.toString()).toBe('1000');
  });
});

describe('ACTIVITY_ICONS', () => {
  it('has an icon for every transaction type', () => {
    const types: TransactionType[] = [
      'buy',
      'sell',
      'dividend',
      'interest',
      'fee',
      'deposit',
      'withdrawal',
      'subscription',
      'redemption',
      'transfer',
    ];
    for (const t of types) expect(ACTIVITY_ICONS[t]).toBeTruthy();
    expect(Object.keys(ACTIVITY_ICONS).sort()).toEqual([...types].sort());
  });
});
