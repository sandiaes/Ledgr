// Test-only in-memory ImportDb. Mirrors what ledgr_import_commit / ledgr_import_undo and the
// schema enforce: atomic writes, one live batch per file, unique import_row_hash per user,
// same-owner references, and undo refused while rows outside the batch use its rows.
import { Decimal, type Transaction } from '@ledgr/core';
import type { BatchInfo, CommitPayload, ExistingState, ImportDb, TableCounts } from '../db';

interface Owned {
  userId: string;
  batchId: string | null;
}

type Row<T> = T & Owned;

interface Data {
  batches: {
    id: string;
    userId: string;
    tx: string;
    ca: string | null;
    createdAt: string;
    undoneAt: string | null;
  }[];
  accounts: Row<CommitPayload['accounts'][number]>[];
  assets: Row<CommitPayload['assets'][number]>[];
  ca_series: Row<CommitPayload['ca_series'][number]>[];
  transactions: Row<CommitPayload['transactions'][number] & { createdAt: number }>[];
  ca_subscriptions: Row<CommitPayload['ca_subscriptions'][number]>[];
  ca_factors: Row<CommitPayload['ca_factors'][number]>[];
}

const TABLES = [
  'accounts',
  'assets',
  'ca_series',
  'transactions',
  'ca_subscriptions',
  'ca_factors',
] as const;

export class MemoryDb implements ImportDb {
  readonly projectRef = 'abcdefghijklmnopqrst';
  data: Data = {
    batches: [],
    accounts: [],
    assets: [],
    ca_series: [],
    transactions: [],
    ca_subscriptions: [],
    ca_factors: [],
  };
  private clock = 0;
  private batchSeq = 0;
  readonly users = new Set<string>();

  async checkUser(userId: string): Promise<void> {
    if (!this.users.has(userId)) throw new Error('no such user');
  }

  async loadState(userId: string): Promise<ExistingState> {
    const mine = <T extends Owned>(rows: T[]) => rows.filter((r) => r.userId === userId);
    return {
      batches: this.data.batches
        .filter((b) => b.userId === userId && !b.undoneAt)
        .map((b) => ({
          id: b.id,
          transactionsFileSha256: b.tx,
          caFileSha256: b.ca,
          createdAt: b.createdAt,
        })),
      accounts: mine(this.data.accounts).map((a) => ({ id: a.id, name: a.name })),
      assets: mine(this.data.assets).map((a) => ({
        id: a.id,
        ticker: a.ticker,
        assetType: a.asset_type,
        isin: a.isin,
      })),
      caSeries: mine(this.data.ca_series).map((s) => ({ id: s.id, code: s.code })),
      importedTransactions: mine(this.data.transactions).map((t) => ({
        id: t.id,
        importRowHash: t.import_row_hash,
        quantity: t.quantity,
        batchId: t.batchId,
      })),
      caSubscriptions: mine(this.data.ca_subscriptions).map((s) => ({
        id: s.id,
        transactionId: s.transaction_id,
      })),
      caFactors: mine(this.data.ca_factors).map((f) => ({
        subscriptionId: f.subscription_id,
        month: f.month,
        factor: f.factor,
      })),
    };
  }

  async commit(userId: string, p: CommitPayload): Promise<string> {
    const next: Data = structuredClone(this.data);
    const live = next.batches.filter((b) => b.userId === userId && !b.undoneAt);
    if (
      live.some(
        (b) =>
          b.tx === p.transactions_file_sha256 || (p.ca_file_sha256 && b.ca === p.ca_file_sha256),
      )
    ) {
      throw new Error('duplicate key value violates unique constraint (file already imported)');
    }
    const batchId = `00000000-0000-4000-8000-${String(++this.batchSeq).padStart(12, '0')}`;
    next.batches.push({
      id: batchId,
      userId,
      tx: p.transactions_file_sha256,
      ca: p.ca_file_sha256,
      createdAt: `t${this.batchSeq}`,
      undoneAt: null,
    });
    const own = { userId, batchId };
    next.accounts.push(...p.accounts.map((a) => ({ ...a, ...own })));
    next.assets.push(...p.assets.map((a) => ({ ...a, ...own })));
    next.ca_series.push(...p.ca_series.map((s) => ({ ...s, ...own })));
    const base = ++this.clock * 1_000_000;
    next.transactions.push(
      ...p.transactions.map((t) => ({ ...t, ...own, createdAt: base + t.seq })),
    );
    next.ca_subscriptions.push(...p.ca_subscriptions.map((s) => ({ ...s, ...own })));
    next.ca_factors.push(...p.ca_factors.map((f) => ({ ...f, ...own })));

    const owns = (rows: { id: string; userId: string }[], id: string) =>
      rows.some((r) => r.id === id && r.userId === userId);
    for (const t of next.transactions.filter((t) => t.batchId === batchId)) {
      if (!owns(next.accounts, t.account_id) || !owns(next.assets, t.asset_id))
        throw new Error('foreign key violation');
    }
    const hashes = next.transactions
      .filter((t) => t.userId === userId)
      .map((t) => t.import_row_hash);
    if (new Set(hashes).size !== hashes.length) throw new Error('duplicate import_row_hash');
    for (const s of next.ca_subscriptions.filter((s) => s.batchId === batchId)) {
      if (!owns(next.ca_series, s.series_id) || !owns(next.transactions, s.transaction_id))
        throw new Error('foreign key violation');
    }
    const factorKeys = next.ca_factors.map((f) => `${f.subscription_id}|${f.month}`);
    if (new Set(factorKeys).size !== factorKeys.length) throw new Error('duplicate factor month');
    for (const f of next.ca_factors.filter((f) => f.batchId === batchId)) {
      if (!owns(next.ca_subscriptions, f.subscription_id)) throw new Error('foreign key violation');
    }
    this.data = next;
    return batchId;
  }

  async batchInfo(userId: string, batchId: string): Promise<BatchInfo | null> {
    const b = this.data.batches.find((x) => x.id === batchId && x.userId === userId);
    if (!b) return null;
    const counts = Object.fromEntries(
      TABLES.map((t) => [
        t,
        (this.data[t] as Owned[]).filter((r) => r.batchId === batchId && r.userId === userId)
          .length,
      ]),
    ) as TableCounts;
    return { id: b.id, createdAt: b.createdAt, undoneAt: b.undoneAt, counts };
  }

  async undo(userId: string, batchId: string): Promise<TableCounts> {
    const b = this.data.batches.find((x) => x.id === batchId && x.userId === userId && !x.undoneAt);
    if (!b) throw new Error(`No live import batch ${batchId} for this user`);
    const inBatch = (r: Owned) => r.batchId === batchId && r.userId === userId;
    const ids = (rows: (Owned & { id: string })[]) =>
      new Set(rows.filter(inBatch).map((r) => r.id));
    const acc = ids(this.data.accounts);
    const ast = ids(this.data.assets);
    const ser = ids(this.data.ca_series);
    const txs = ids(this.data.transactions);
    const sub = ids(this.data.ca_subscriptions);
    const outside = <T extends Owned>(rows: T[]) => rows.filter((r) => !inBatch(r));
    const referenced =
      outside(this.data.transactions).some((t) => acc.has(t.account_id) || ast.has(t.asset_id)) ||
      outside(this.data.ca_subscriptions).some(
        (s) => ser.has(s.series_id) || txs.has(s.transaction_id),
      ) ||
      outside(this.data.ca_factors).some((f) => sub.has(f.subscription_id));
    if (referenced) throw new Error('update or delete violates foreign key constraint');
    const counts = {} as TableCounts;
    for (const t of TABLES) {
      const before = (this.data[t] as Owned[]).length;
      (this.data[t] as Owned[]) = (this.data[t] as Owned[]).filter((r) => !inBatch(r));
      counts[t] = before - (this.data[t] as Owned[]).length;
    }
    b.undoneAt = 'undone';
    return counts;
  }

  /** The user's ledger as the app would load it: by trade date, then created_at. */
  ledger(userId: string): Transaction[] {
    return this.data.transactions
      .filter((t) => t.userId === userId)
      .sort((a, b) =>
        a.trade_date < b.trade_date
          ? -1
          : a.trade_date > b.trade_date
            ? 1
            : a.createdAt - b.createdAt,
      )
      .map((t) => ({
        id: t.id,
        accountId: t.account_id,
        assetId: t.asset_id,
        type: t.type,
        tradeDate: t.trade_date,
        quantity: new Decimal(t.quantity),
        unitPrice: new Decimal(t.unit_price),
        amount: null,
        fees: new Decimal(0),
        currency: t.currency,
        fxRateToEur: new Decimal(t.fx_rate_to_eur),
      }));
  }
}
