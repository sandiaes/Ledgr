// Idempotency, undo and FIFO file order against the in-memory database layer.
import { runFifo } from '@ledgr/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { canCommit } from './plan';
import { editLines } from './test/fixtures';
import { MemoryDb } from './test/memory-db';
import { CA, plan, TX } from './test/plan-helper';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const APPENDED = editLines(TX, {}, ['2026-10-01,Crypto,Buy,BTCEUR,0.01,100000,1000.00,Kraken']);

let db: MemoryDb;
beforeEach(() => {
  db = new MemoryDb();
  db.users.add(USER).add(OTHER);
});

async function importOnce(o: Parameters<typeof plan>[0] = {}, user = USER) {
  const p = plan({ ...o, state: await db.loadState(user) });
  expect(p.rejects).toEqual([]);
  expect(p.fatal).toEqual([]);
  return { p, batchId: await db.commit(user, p.payload) };
}

describe('idempotency', () => {
  it('the same file is refused the second time, and every row is already there', async () => {
    await importOnce();
    const again = plan({ state: await db.loadState(USER) });
    expect(again.fatal).toEqual([
      expect.stringMatching(/transactions file was already imported/),
      expect.stringMatching(/CA file was already imported/),
    ]);
    expect(canCommit(again)).toBe(false);
    expect(again.payload.transactions).toEqual([]);
    expect(again.payload.ca_factors).toEqual([]);
    expect(again.counts.transactions).toEqual({ read: 140, insert: 0, skip: 140, reject: 0 });
  });

  it('a re-export with one new row inserts only that row', async () => {
    await importOnce();
    const { p } = await importOnce({ tx: APPENDED, ca: null, ratioMonth: null });
    expect(p.counts.transactions).toEqual({ read: 141, insert: 1, skip: 140, reject: 0 });
    expect(p.payload.transactions.map((t) => t.quantity)).toEqual(['0.01']);
    // Existing accounts and assets are reused, nothing else is created.
    expect(p.payload.accounts).toEqual([]);
    expect(p.payload.assets).toEqual([]);
    expect(db.data.transactions).toHaveLength(138);
    expect(new Set(db.data.transactions.map((t) => t.import_row_hash)).size).toBe(138);
  });

  it('identical legitimate rows are each imported once, and only once', async () => {
    const row = '2026-10-01,Crypto,Buy,BTCEUR,0.01,100000,1000.00,Kraken';
    const twice = editLines(TX, {}, [row, row]);
    const key = plan({ tx: twice }).duplicates[0]!.key;
    await importOnce({ tx: twice, allowed: [key] });
    expect(db.data.transactions.filter((t) => t.quantity === '0.01')).toHaveLength(2);
    // Re-exported with a third copy: only the third is new.
    const { p } = await importOnce({
      tx: editLines(twice, {}, [row]),
      ca: null,
      ratioMonth: null,
      allowed: [key],
    });
    expect(p.payload.transactions).toHaveLength(1);
    expect(db.data.transactions.filter((t) => t.quantity === '0.01')).toHaveLength(3);
  });

  it('a new month of ratios adds factors; the same month never overwrites one', async () => {
    await importOnce();
    const november = CA.replace('1.10482', '1.10600')
      .replace('1.09754', '1.09870')
      .replace('1.08988', '1.09100');
    const { p } = await importOnce({ tx: APPENDED, ca: november, ratioMonth: '2026-11-01' });
    expect(p.payload.ca_subscriptions).toEqual([]);
    expect(p.payload.ca_factors.map((f) => [f.month, f.factor])).toEqual([
      ['2026-11-01', '1.106'],
      ['2026-11-01', '1.0987'],
      ['2026-11-01', '1.091'],
    ]);
    expect(db.data.ca_factors).toHaveLength(6);

    const changed = plan({
      tx: editLines(APPENDED, {}, ['']),
      ca: CA.replace('1.10482', '1.2'),
      ratioMonth: '2026-10-01',
      state: await db.loadState(USER),
    });
    expect(changed.rejects.map((r) => [r.file, r.line, r.reasons[0]!.code])).toEqual([
      ['ca', 2, 'factor conflict'],
    ]);
    expect(changed.skips.filter((s) => s.file === 'ca').map((s) => s.reason)).toEqual([
      'factor already recorded',
      'factor already recorded',
    ]);
  });

  it('a subscription already imported with other units is rejected', async () => {
    await importOnce();
    const p = plan({
      tx: editLines(APPENDED, { 69: '2023-01-01,CA,Buy,E,2000,1,2000.00,Aforro' }),
      ca: CA.replace('36000', '37000'),
      ratioMonth: '2026-11-01',
      state: await db.loadState(USER),
    });
    expect(p.rejects.map((r) => [r.file, r.line, r.reasons[0]!.code])).toEqual([
      ['ca', 2, 'already imported differently'],
      ['transactions', 68, 'already imported differently'],
      ['transactions', 69, 'already imported differently'],
    ]);
  });

  it("one user's imports do not count for another", async () => {
    await importOnce();
    const { p } = await importOnce({}, OTHER);
    expect(p.payload.transactions).toHaveLength(137);
    expect(db.data.transactions.filter((t) => t.userId === OTHER)).toHaveLength(137);
  });
});

describe('undo', () => {
  it('removes exactly the rows of one batch, and refuses while a later batch uses them', async () => {
    const first = await importOnce();
    const snapshot = structuredClone(db.data);
    const second = await importOnce({ tx: APPENDED, ca: null, ratioMonth: null });

    // The second batch's row uses the first batch's Kraken account and BTCEUR asset.
    await expect(db.undo(USER, first.batchId)).rejects.toThrow(/foreign key/);
    expect(db.data.transactions).toHaveLength(138);

    expect(await db.batchInfo(USER, second.batchId)).toMatchObject({
      counts: { transactions: 1, accounts: 0, assets: 0 },
    });
    expect(await db.undo(USER, second.batchId)).toEqual({
      accounts: 0,
      assets: 0,
      ca_series: 0,
      transactions: 1,
      ca_subscriptions: 0,
      ca_factors: 0,
    });
    expect(db.data.transactions).toEqual(snapshot.transactions);
    expect(db.data.accounts).toEqual(snapshot.accounts);

    expect(await db.undo(USER, first.batchId)).toEqual({
      accounts: 4,
      assets: 24,
      ca_series: 1,
      transactions: 137,
      ca_subscriptions: 3,
      ca_factors: 3,
    });
    expect(db.data.transactions).toEqual([]);
    await expect(db.undo(USER, first.batchId)).rejects.toThrow(/No live import batch/);

    // After an undo the same file may be imported again.
    const again = plan({ state: await db.loadState(USER) });
    expect(again.fatal).toEqual([]);
    expect(again.payload.transactions).toHaveLength(137);
  });

  it("does not touch another user's batch or rows", async () => {
    const mine = await importOnce();
    await importOnce({}, OTHER);
    await expect(db.undo(OTHER, mine.batchId)).rejects.toThrow(/No live import batch/);
    await db.undo(USER, mine.batchId);
    expect(db.data.transactions.filter((t) => t.userId === OTHER)).toHaveLength(137);
    expect(db.data.transactions.filter((t) => t.userId === USER)).toHaveLength(0);
  });
});

describe('FIFO follows the file order within a month', () => {
  const header = 'Month,Type,Transact Type,Ticker/Type,Units,Order Price,Order Value,Broker';
  const buy1 = '2021-02-01,Stocks,Buy,V,10,1,10.00,Degiro';
  const buy2 = '2021-02-01,Stocks,Buy,V,10,2,20.00,Degiro';
  const sell = '2021-02-01,Stocks,Sell,V,-10,3,-30.00,Degiro';
  const fifoCost = async (lines: string[]) => {
    await importOnce({ tx: [header, ...lines].join('\n') + '\n', ca: null, ratioMonth: null });
    const { disposals } = runFifo(db.ledger(USER));
    return disposals[0]!.costEur.toString();
  };

  it('the first row in the file is the first lot in', async () => {
    expect(await fifoCost([buy1, buy2, sell])).toBe('10');
  });

  it('swapping the two buys in the file swaps the lot consumed', async () => {
    expect(await fifoCost([buy2, buy1, sell])).toBe('20');
  });

  it('created_at increases in file order, and dates still come first', async () => {
    await importOnce({
      tx: [header, '2021-03-01,Stocks,Buy,V,1,5,5.00,Degiro', buy1, buy2].join('\n') + '\n',
      ca: null,
      ratioMonth: null,
    });
    const ledger = db.ledger(USER);
    expect(ledger.map((t) => [t.tradeDate, t.unitPrice?.toString()])).toEqual([
      ['2021-02-01', '1'],
      ['2021-02-01', '2'],
      ['2021-03-01', '5'],
    ]);
    const seqs = db.data.transactions.map((t) => t.createdAt);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });
});
