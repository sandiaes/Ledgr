// ImportDb over Supabase with the service-role key. The service role bypasses RLS, so every
// read filters on user_id explicitly and every write goes through the import functions,
// which set user_id on each row.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BatchInfo, CommitPayload, ExistingState, ImportDb, TableCounts } from './db';
import type { ImportEnv } from './env';

const PAGE = 1000;
const TABLES = [
  'accounts',
  'assets',
  'ca_series',
  'transactions',
  'ca_subscriptions',
  'ca_factors',
] as const;

export class SupabaseImportDb implements ImportDb {
  readonly projectRef: string;
  private readonly client: SupabaseClient;

  constructor(env: ImportEnv) {
    this.projectRef = env.projectRef;
    this.client = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async checkUser(userId: string): Promise<void> {
    const { data, error } = await this.client.auth.admin.getUserById(userId);
    if (error || !data.user) {
      throw new Error(
        `LEDGR_USER_ID was not found in project ${this.projectRef} (${error?.message ?? 'no such user'})`,
      );
    }
  }

  /** All rows of a filtered select, page by page (PostgREST caps a response). */
  private async all<T>(
    table: string,
    columns: string,
    userId: string,
    filter: { isNull?: string; notNull?: string } = {},
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.client.from(table).select(columns).eq('user_id', userId);
      if (filter.isNull) q = q.is(filter.isNull, null);
      if (filter.notNull) q = q.not(filter.notNull, 'is', null);
      const { data, error } = await q.order('id').range(from, from + PAGE - 1);
      if (error) throw new Error(`Reading ${table}: ${error.message}`);
      rows.push(...((data ?? []) as unknown as T[]));
      if (!data || data.length < PAGE) return rows;
    }
  }

  async loadState(userId: string): Promise<ExistingState> {
    const [batches, accounts, assets, caSeries, txs, subs, factors] = await Promise.all([
      this.all<{
        id: string;
        transactions_file_sha256: string;
        ca_file_sha256: string | null;
        created_at: string;
      }>('import_batches', 'id, transactions_file_sha256, ca_file_sha256, created_at', userId, {
        isNull: 'undone_at',
      }),
      this.all<{ id: string; name: string }>('accounts', 'id, name', userId, {
        isNull: 'deleted_at',
      }),
      this.all<{
        id: string;
        ticker: string | null;
        asset_type: ExistingState['assets'][number]['assetType'];
        isin: string | null;
      }>('assets', 'id, ticker, asset_type, isin', userId, { isNull: 'deleted_at' }),
      this.all<{ id: string; code: string }>('ca_series', 'id, code', userId, {
        isNull: 'deleted_at',
      }),
      this.all<{
        id: string;
        import_row_hash: string;
        quantity: string | number;
        import_batch_id: string | null;
      }>('transactions', 'id, import_row_hash, quantity::text, import_batch_id', userId, {
        notNull: 'import_row_hash',
      }),
      this.all<{ id: string; transaction_id: string }>(
        'ca_subscriptions',
        'id, transaction_id',
        userId,
      ),
      this.all<{ subscription_id: string; month: string; factor: string | number }>(
        'ca_factors',
        'subscription_id, month, factor::text',
        userId,
      ),
    ]);
    return {
      batches: batches.map((b) => ({
        id: b.id,
        transactionsFileSha256: b.transactions_file_sha256,
        caFileSha256: b.ca_file_sha256,
        createdAt: b.created_at,
      })),
      accounts,
      assets: assets.map((a) => ({
        id: a.id,
        ticker: a.ticker,
        assetType: a.asset_type,
        isin: a.isin,
      })),
      caSeries,
      importedTransactions: txs.map((t) => ({
        id: t.id,
        importRowHash: t.import_row_hash,
        quantity: String(t.quantity),
        batchId: t.import_batch_id,
      })),
      caSubscriptions: subs.map((s) => ({ id: s.id, transactionId: s.transaction_id })),
      caFactors: factors.map((f) => ({
        subscriptionId: f.subscription_id,
        month: f.month,
        factor: String(f.factor),
      })),
    };
  }

  async commit(userId: string, payload: CommitPayload): Promise<string> {
    const { data, error } = await this.client.rpc('ledgr_import_commit', {
      p_user_id: userId,
      p_batch: payload,
    });
    if (error) throw new Error(`Commit failed, nothing was written: ${error.message}`);
    return data as string;
  }

  async batchInfo(userId: string, batchId: string): Promise<BatchInfo | null> {
    const { data, error } = await this.client
      .from('import_batches')
      .select('id, created_at, undone_at')
      .eq('user_id', userId)
      .eq('id', batchId)
      .maybeSingle();
    if (error) throw new Error(`Reading import_batches: ${error.message}`);
    if (!data) return null;
    const counts = {} as TableCounts;
    for (const table of TABLES) {
      const { count, error: e } = await this.client
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('import_batch_id', batchId);
      if (e) throw new Error(`Counting ${table}: ${e.message}`);
      counts[table] = count ?? 0;
    }
    return {
      id: data.id as string,
      createdAt: data.created_at as string,
      undoneAt: data.undone_at as string | null,
      counts,
    };
  }

  async undo(userId: string, batchId: string): Promise<TableCounts> {
    const { data, error } = await this.client.rpc('ledgr_import_undo', {
      p_user_id: userId,
      p_batch_id: batchId,
    });
    if (error) throw new Error(`Undo failed, nothing was removed: ${error.message}`);
    return data as TableCounts;
  }
}
