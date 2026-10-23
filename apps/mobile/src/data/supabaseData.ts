import {
  ACCOUNT_COLUMNS,
  accountFromRow,
  assertAal2,
  ASSET_COLUMNS,
  assetFromRow,
  CA_FACTOR_COLUMNS,
  CA_SUBSCRIPTION_COLUMNS,
  caFactorFromRow,
  caSubscriptionFromRow,
  DataError,
  FX_COLUMNS,
  fxFromRow,
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
  type Row,
} from '@ledgr/client';
import { addDays, dec, PRICE_LOOKBACK_DAYS } from '@ledgr/core';
import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { DataApi } from '../services';

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

  return {
    async ledger() {
      const [transactions, assets, accounts, subscriptions, factors] = await Promise.all([
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
      ]);
      return {
        transactions: transactions.map(transactionFromRow),
        assets: assets.map(assetFromRow),
        accounts: accounts.map(accountFromRow),
        ca: {
          subscriptions: subscriptions.map(caSubscriptionFromRow),
          factors: factors.map(caFactorFromRow),
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
