import { dec, type PositionRow } from '@ledgr/core';
import { sortPositions } from './listing';

const row = (assetId: string, value: string, dayPct: string | null): PositionRow => ({
  assetId,
  assetType: 'stock',
  currency: 'EUR',
  accountIds: ['a'],
  units: dec('1'),
  valueEur: dec(value),
  weight: dec(value).div(100),
  costBasisEur: dec(value),
  unrealizedEur: dec('0'),
  unrealizedPct: dec('0'),
  dayChangeEur: dayPct === null ? dec('1') : dec('0'),
  dayChangePct: dayPct === null ? null : dec(dayPct),
  openedToday: dayPct === null,
  valuation: { assetId, source: 'price', asOf: '2026-10-23', ageDays: 0, stale: false },
  certificado: null,
});

describe('sortPositions', () => {
  const rows = [row('new', '50', null), row('up', '10', '0.02'), row('down', '30', '-0.01')];
  const ids = (r: PositionRow[]) => r.map((x) => x.assetId);

  it('puts a position opened today (no day %) last in both directions', () => {
    expect(ids(sortPositions(rows, { key: 'day', dir: 'desc' }))).toEqual(['up', 'down', 'new']);
    expect(ids(sortPositions(rows, { key: 'day', dir: 'asc' }))).toEqual(['down', 'up', 'new']);
  });

  it('does not change the input', () => {
    sortPositions(rows, { key: 'value', dir: 'asc' });
    expect(ids(rows)).toEqual(['new', 'up', 'down']);
  });
});
