import {
  ACCOUNT_COLUMNS,
  accountFromRow,
  assertAal2,
  ASSET_COLUMNS,
  assetFromRow,
  CA_FACTOR_COLUMNS,
  CA_SERIES_COLUMNS,
  CA_SUBSCRIPTION_COLUMNS,
  caFactorFromRow,
  caSeriesFromRow,
  caSubscriptionFromRow,
  DataError,
  FX_COLUMNS,
  fxFromRow,
  JOB_RUN_COLUMNS,
  jobRunFromRow,
  LIVE_QUOTE_COLUMNS,
  liveQuoteFromRow,
  MfaRequiredError,
  PRICE_COLUMNS,
  priceFromRow,
  selectAll,
  SNAPSHOT_COLUMNS,
  snapshotFromRow,
  TRANSACTION_COLUMNS,
  transactionFromRow,
  transactionToRow,
  type Row,
} from '@ledgr/client';
import { addDays, dec, PRICE_LOOKBACK_DAYS } from '@ledgr/core';
import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { DataApi } from '../services';

const DUPLICATE = '23505';

export function createSupabaseData(sb: SupabaseClient): DataApi {
  /** Checked before every request, so an aal1 session never runs a query. */
  const guard = async () => {
    const { data } = await sb.auth.getSession();
    assertAal2(data.session?.access_token);
  };
  const all = (table: string, build: (from: number, to: number) => PromiseLike<unknown>) =>
    selectAll<Row>(table, async (from, to) => {
      await guard();
      return (await build(from, to)) as { data: Row[] | null; error: { code?: string } | null };
    });

  /** One request (aal2 checked first); a PostgREST error becomes a DataError (code only). */
  const one = async <T>(
    table: string,
    run: () => PromiseLike<{ data: T; error: { code?: string } | null }>,
  ) => {
    await guard();
    const { data, error } = await run();
    if (error) throw new DataError(table, error.code ?? null);
    return data;
  };
  /** Whether a row with this id exists (deleted or not): a retried insert already landed. */
  const exists = async (table: string, id: string) =>
    ((await one(table, () => sb.from(table).select('id').eq('id', id).limit(1))) as Row[]).length >
    0;

  return {
    async ledger() {
      const [transactions, assets, accounts, subscriptions, factors, series] = await Promise.all([
        all('transactions', (f, t) =>
          sb
            .from('transactions')
            .select(TRANSACTION_COLUMNS)
            .is('deleted_at', null)
            .order('trade_date')
            .order('created_at')
            .order('id')
            .range(f, t),
        ),
        all('assets', (f, t) =>
          sb.from('assets').select(ASSET_COLUMNS).is('deleted_at', null).order('id').range(f, t),
        ),
        all('accounts', (f, t) =>
          sb.from('accounts').select(ACCOUNT_COLUMNS).order('id').range(f, t),
        ),
        all('ca_subscriptions', (f, t) =>
          sb
            .from('ca_subscriptions')
            .select(CA_SUBSCRIPTION_COLUMNS)
            .is('deleted_at', null)
            .order('id')
            .range(f, t),
        ),
        all('ca_factors', (f, t) =>
          sb
            .from('ca_factors')
            .select(CA_FACTOR_COLUMNS)
            .order('subscription_id')
            .order('month')
            .range(f, t),
        ),
        all('ca_series', (f, t) =>
          sb.from('ca_series').select(CA_SERIES_COLUMNS).order('id').range(f, t),
        ),
      ]);
      return {
        transactions: transactions.map(transactionFromRow),
        assets: assets.map(assetFromRow),
        accounts: accounts.map(accountFromRow),
        ca: {
          subscriptions: subscriptions.map(caSubscriptionFromRow),
          factors: factors.map(caFactorFromRow),
          series: series.map(caSeriesFromRow),
        },
      };
    },

    async market(today, heldAssetIds) {
      const from = addDays(today, -PRICE_LOOKBACK_DAYS);
      const [prices, fx, quotes] = await Promise.all([
        all('prices', (f, t) =>
          sb
            .from('prices')
            .select(PRICE_COLUMNS)
            .gte('price_date', from)
            .order('asset_id')
            .order('price_date')
            .range(f, t),
        ),
        all('fx_rates', (f, t) =>
          sb
            .from('fx_rates')
            .select(FX_COLUMNS)
            .gte('rate_date', from)
            .order('currency')
            .order('rate_date')
            .range(f, t),
        ),
        all('live_quotes', (f, t) =>
          sb.from('live_quotes').select(LIVE_QUOTE_COLUMNS).order('asset_id').range(f, t),
        ),
      ]);
      // A held asset with no close in the window still gets its latest older one.
      const covered = new Set(prices.map((r) => String(r.asset_id)));
      const older = await Promise.all(
        heldAssetIds
          .filter((id) => !covered.has(id))
          .map(async (id) => {
            await guard();
            const res = await sb
              .from('prices')
              .select(PRICE_COLUMNS)
              .eq('asset_id', id)
              .lt('price_date', from)
              .order('price_date', { ascending: false })
              .limit(1);
            if (res.error) throw new DataError('prices', res.error.code ?? null);
            return (res.data ?? []) as Row[];
          }),
      );
      return {
        prices: [...prices, ...older.flat()].map(priceFromRow),
        fx: fx.map(fxFromRow),
        liveQuotes: quotes.map(liveQuoteFromRow).map((q) => ({
          assetId: q.assetId,
          date: q.tradingDay,
          close: dec(q.price),
          currency: q.currency,
        })),
      };
    },

    async snapshots() {
      const rows = await all('portfolio_snapshots', (f, t) =>
        sb
          .from('portfolio_snapshots')
          .select(SNAPSHOT_COLUMNS)
          .order('snapshot_date')
          .order('id')
          .range(f, t),
      );
      return rows.map(snapshotFromRow);
    },

    async priceHistory(assetId) {
      const rows = await all('prices', (f, t) =>
        sb
          .from('prices')
          .select(PRICE_COLUMNS)
          .eq('asset_id', assetId)
          .order('price_date')
          .range(f, t),
      );
      return rows.map(priceFromRow);
    },

    async jobRuns() {
      const latest = async (job: string) => {
        const rows = (await one('job_runs', () =>
          sb
            .from('job_runs')
            .select(JOB_RUN_COLUMNS)
            .eq('job', job)
            .order('finished_at', { ascending: false })
            .limit(1),
        )) as Row[];
        return rows[0] ? jobRunFromRow(rows[0]) : null;
      };
      const [prices, snapshots] = await Promise.all([latest('prices'), latest('snapshots')]);
      return { prices, snapshots };
    },

    async insertTransaction(row) {
      await guard();
      const { error } = await sb.from('transactions').insert(transactionToRow(row));
      if (!error) return;
      // A retry after a lost response: the primary key says the row is already there.
      if (error.code === DUPLICATE && (await exists('transactions', row.id))) return;
      throw new DataError('transactions', error.code ?? null);
    },

    async updateTransaction(row) {
      const fields = transactionToRow(row);
      delete fields.id; // the id never changes
      const rows = (await one('transactions', () =>
        sb.from('transactions').update(fields).eq('id', row.id).is('deleted_at', null).select('id'),
      )) as Row[];
      if (rows.length !== 1) throw new DataError('transactions', 'not_found');
    },

    async deleteTransaction(id) {
      const rows = (await one('transactions', () =>
        sb
          .from('transactions')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id)
          .is('deleted_at', null)
          .select('id'),
      )) as Row[];
      if (rows.length === 1) return;
      // Already deleted (a retry): fine. Not there at all: an error.
      if (!(await exists('transactions', id))) throw new DataError('transactions', 'not_found');
    },

    async insertAsset(asset) {
      await guard();
      const { error } = await sb.from('assets').insert({
        id: asset.id,
        name: asset.name,
        asset_type: asset.assetType,
        ticker: asset.ticker,
        isin: asset.isin,
        exchange: asset.exchange,
        trading_currency: asset.tradingCurrency,
        price_source: 'manual',
        price_source_id: null,
      });
      if (!error) return;
      if (error.code === DUPLICATE && (await exists('assets', asset.id))) return;
      // 23505 otherwise: another asset already has this ISIN.
      throw new DataError('assets', error.code ?? null);
    },

    async insertFactors(month, rows) {
      if (rows.length === 0) return;
      await guard();
      const { error } = await sb.from('ca_factors').insert(
        rows.map((r) => ({
          subscription_id: r.subscriptionId,
          month,
          factor: r.factor.toFixed(),
          source: 'app',
        })),
      );
      if (!error) return;
      if (error.code === DUPLICATE) {
        // A retry: fine if every factor is stored with the same value. Rows are never updated.
        const stored = (
          (await one('ca_factors', () =>
            sb
              .from('ca_factors')
              .select(CA_FACTOR_COLUMNS)
              .eq('month', month)
              .in(
                'subscription_id',
                rows.map((r) => r.subscriptionId),
              ),
          )) as Row[]
        ).map(caFactorFromRow);
        const same = rows.every((r) =>
          stored.some((f) => f.subscriptionId === r.subscriptionId && f.factor.eq(r.factor)),
        );
        if (same) return;
        throw new DataError('ca_factors', 'already_recorded');
      }
      throw new DataError('ca_factors', error.code ?? null);
    },

    async valueNow() {
      await guard();
      const { data, error } = await sb.functions.invoke('value-now', { method: 'POST' });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const body = (await (error.context as Response).json().catch(() => null)) as {
            error?: unknown;
          } | null;
          if (body?.error === 'mfa_required') throw new MfaRequiredError();
        }
        return null;
      }
      const body = data as {
        computedAt?: unknown;
        totalValueEur?: unknown;
        costBasisEur?: unknown;
      };
      if (typeof body?.totalValueEur !== 'string' || typeof body.costBasisEur !== 'string') {
        return null;
      }
      return {
        computedAt: String(body.computedAt),
        totalValueEur: dec(body.totalValueEur),
        costBasisEur: dec(body.costBasisEur),
      };
    },
  };
}
