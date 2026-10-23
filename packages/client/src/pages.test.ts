import { describe, expect, it } from 'vitest';
import { DataError, selectAll } from './pages';

/** A fake table of `n` rows served the way PostgREST's range() serves them. */
function fakeTable(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { page, calls };
}

describe('selectAll', () => {
  it('reads 2,500 rows in three pages, each row once and in order', async () => {
    const { page, calls } = fakeTable(2500);
    const rows = await selectAll('transactions', page);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('asks once more when the last page is exactly full', async () => {
    const { page, calls } = fakeTable(2000);
    expect(await selectAll('prices', page)).toHaveLength(2000);
    expect(calls).toHaveLength(3);
  });

  it('fails with the table and code only', async () => {
    const failing = async () => ({ data: null, error: { code: '42501', message: 'value 12.34' } });
    const err = await selectAll('assets', failing).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as DataError).message).toBe('Could not read assets (42501)');
  });
});
