// JobsDb over Supabase's REST API (PostgREST) with the service-role key, using fetch only so
// the same code runs in Node and in Edge Functions. The service role bypasses RLS, so every
// request filters on user_id and every write sets it. Numerics are read as text (::text)
// and written as strings, never through JS floats. Errors carry the HTTP status and the
// PostgREST error code only: a constraint message can quote row values.
import { dec, type IsoDate, type StoredPriceRow, type Transaction } from '@ledgr/core';
import {
  snapshotRow,
  type AssetRecord,
  type FxUpsert,
  type JobRunRecord,
  type JobsDb,
  type PriceUpsert,
} from './db';
import type { Fetch } from './http';

const PAGE = 1000;
const WRITE_BATCH = 500;

export class RestDbError extends Error {
  override name = 'RestDbError';
  constructor(
    readonly table: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Supabase ${table}: HTTP ${status}${code ? ` (${code})` : ''}`);
  }
}

export interface RestDbOptions {
  /** https://<ref>.supabase.co */
  url: string;
  /** Service-role key: sb_secret_... or the legacy service_role JWT. */
  serviceKey: string;
  userId: string;
  fetch: Fetch;
}

type Row = Record<string, unknown>;

export function createRestDb(opts: RestDbOptions): JobsDb {
  const base = `${opts.url.replace(/\/+$/, '')}/rest/v1`;
  // As supabase-js sends them: the gateway accepts a legacy JWT or an sb_secret_ key in both.
  const headers: Record<string, string> = {
    apikey: opts.serviceKey,
    Authorization: `Bearer ${opts.serviceKey}`,
    'Content-Type': 'application/json',
  };
  const user = `user_id=eq.${encodeURIComponent(opts.userId)}`;

  async function fail(table: string, res: Response): Promise<never> {
    let code: string | null = null;
    try {
      const body = (await res.json()) as { code?: unknown };
      code = typeof body.code === 'string' ? body.code : null;
    } catch {
      // not JSON
    }
    throw new RestDbError(table, res.status, code);
  }

  async function select(table: string, query: string): Promise<Row[]> {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await opts.fetch(
        `${base}/${table}?${user}&${query}&limit=${PAGE}&offset=${offset}`,
        { headers },
      );
      if (!res.ok) await fail(table, res);
      const page = (await res.json()) as Row[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  async function first(table: string, query: string): Promise<Row | null> {
    const res = await opts.fetch(`${base}/${table}?${user}&${query}&limit=1`, { headers });
    if (!res.ok) await fail(table, res);
    return ((await res.json()) as Row[])[0] ?? null;
  }

  async function upsert(table: string, onConflict: string, rows: readonly Row[]): Promise<void> {
    for (let i = 0; i < rows.length; i += WRITE_BATCH) {
      const body = rows.slice(i, i + WRITE_BATCH).map((r) => ({ ...r, user_id: opts.userId }));
      const res = await opts.fetch(`${base}/${table}?on_conflict=${onConflict}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(body),
      });
      if (!res.ok) await fail(table, res);
      await res.body?.cancel();
    }
  }

  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const priceRow = (r: Row): StoredPriceRow => ({
    assetId: String(r.asset_id),
    date: String(r.price_date),
    close: dec(String(r.close)),
    currency: String(r.currency),
    splitFactor:
      r.split_factor === null || r.split_factor === undefined ? null : dec(String(r.split_factor)),
  });
  const PRICE_COLUMNS = 'select=asset_id,price_date,close::text,currency,split_factor::text';

  return {
    async loadAssets(): Promise<AssetRecord[]> {
      const rows = await select(
        'assets',
        'select=id,name,ticker,isin,exchange,asset_type,trading_currency,price_source,price_source_id&deleted_at=is.null&order=id',
      );
      return rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        ticker: str(r.ticker),
        isin: str(r.isin),
        exchange: str(r.exchange),
        assetType: r.asset_type as AssetRecord['assetType'],
        tradingCurrency: String(r.trading_currency),
        priceSource: String(r.price_source),
        priceSourceId: str(r.price_source_id),
      }));
    },

    async loadTransactions(): Promise<Transaction[]> {
      const rows = await select(
        'transactions',
        'select=id,account_id,asset_id,type,trade_date,quantity::text,unit_price::text,amount::text,fees::text,' +
          'currency,fx_rate_to_eur::text,ca_subscription_id,withholding_tax::text,transfer_to_account_id' +
          '&deleted_at=is.null&order=trade_date.asc,created_at.asc,id.asc',
      );
      const decOrNull = (v: unknown) => (v === null || v === undefined ? null : dec(String(v)));
      return rows.map((r) => ({
        id: String(r.id),
        accountId: String(r.account_id),
        assetId: str(r.asset_id),
        type: r.type as Transaction['type'],
        tradeDate: String(r.trade_date),
        quantity: decOrNull(r.quantity),
        unitPrice: decOrNull(r.unit_price),
        amount: decOrNull(r.amount),
        fees: dec(String(r.fees)),
        currency: String(r.currency).trim(),
        fxRateToEur: dec(String(r.fx_rate_to_eur)),
        caSubscriptionId: str(r.ca_subscription_id),
        withholdingTax: decOrNull(r.withholding_tax),
        transferToAccountId: str(r.transfer_to_account_id),
      }));
    },

    async loadCa() {
      const [subs, factors] = await Promise.all([
        select(
          'ca_subscriptions',
          'select=id,series_id,transaction_id&deleted_at=is.null&order=id',
        ),
        select(
          'ca_factors',
          'select=subscription_id,month,factor::text&order=subscription_id,month',
        ),
      ]);
      return {
        subscriptions: subs.map((s) => ({
          id: String(s.id),
          seriesId: String(s.series_id),
          transactionId: String(s.transaction_id),
        })),
        factors: factors.map((f) => ({
          subscriptionId: String(f.subscription_id),
          month: String(f.month),
          factor: dec(String(f.factor)),
        })),
      };
    },

    async loadPrices(o = {}) {
      let q = `${PRICE_COLUMNS}&order=asset_id,price_date`;
      if (o.from) q += `&price_date=gte.${o.from}`;
      if (o.assetIds) {
        if (o.assetIds.length === 0) return [];
        q += `&asset_id=in.(${o.assetIds.map(encodeURIComponent).join(',')})`;
      }
      return (await select('prices', q)).map(priceRow);
    },

    async latestPriceBefore(assetId, date) {
      const r = await first(
        'prices',
        `${PRICE_COLUMNS}&asset_id=eq.${encodeURIComponent(assetId)}&price_date=lt.${date}&order=price_date.desc`,
      );
      return r ? priceRow(r) : null;
    },

    async priceBounds(assetId) {
      const q = `select=price_date&asset_id=eq.${encodeURIComponent(assetId)}`;
      const [lo, hi] = await Promise.all([
        first('prices', `${q}&order=price_date.asc`),
        first('prices', `${q}&order=price_date.desc`),
      ]);
      return lo && hi ? { first: String(lo.price_date), last: String(hi.price_date) } : null;
    },

    async loadFx(o = {}) {
      let q = 'select=currency,rate_date,rate_to_eur::text&order=currency,rate_date';
      if (o.from) q += `&rate_date=gte.${o.from}`;
      return (await select('fx_rates', q)).map((r) => ({
        currency: String(r.currency).trim(),
        date: String(r.rate_date),
        rateToEur: dec(String(r.rate_to_eur)),
      }));
    },

    async lastFxDate(currency) {
      const r = await first(
        'fx_rates',
        `select=rate_date&currency=eq.${currency}&order=rate_date.desc`,
      );
      return r ? (String(r.rate_date) as IsoDate) : null;
    },

    upsertPrices: (rows: readonly PriceUpsert[]) =>
      upsert(
        'prices',
        'asset_id,price_date',
        rows.map((r) => ({
          asset_id: r.assetId,
          price_date: r.date,
          close: r.close,
          currency: r.currency,
          source: r.source,
          split_factor: r.splitFactor,
        })),
      ),

    upsertFx: (rows: readonly FxUpsert[]) =>
      upsert(
        'fx_rates',
        'user_id,currency,rate_date',
        rows.map((r) => ({
          currency: r.currency,
          rate_date: r.date,
          rate_to_eur: r.rateToEur,
          source: r.source,
        })),
      ),

    upsertSnapshots: (rows) =>
      upsert('portfolio_snapshots', 'user_id,snapshot_date', rows.map(snapshotRow)),

    async recordRun(run: JobRunRecord) {
      const res = await opts.fetch(`${base}/job_runs`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: opts.userId,
          job: run.job,
          trigger: run.trigger,
          started_at: run.startedAt,
          finished_at: run.finishedAt,
          status: run.status,
          counts: run.counts,
          issues: run.issues,
        }),
      });
      if (!res.ok) await fail('job_runs', res);
      await res.body?.cancel();
    },

    async setPriceSymbol(assetId, source, symbol) {
      const res = await opts.fetch(`${base}/assets?${user}&id=eq.${encodeURIComponent(assetId)}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ price_source: source, price_source_id: symbol }),
      });
      if (!res.ok) await fail('assets', res);
      const updated = (await res.json()) as Row[];
      if (updated.length !== 1) throw new RestDbError('assets', 404, null);
    },
  };
}
