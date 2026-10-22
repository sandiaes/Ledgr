// Test-only JobsDb in memory, with the same upsert keys as the real tables.
import type {
  CaFactor,
  CaSubscription,
  FxRow,
  IsoDate,
  StoredPriceRow,
  Transaction,
} from '@ledgr/core';
import { dec } from '@ledgr/core';
import { snapshotRow, type AssetRecord, type JobRunRecord, type JobsDb } from '../db';

export class MemoryDb implements JobsDb {
  assets: AssetRecord[] = [];
  transactions: Transaction[] = [];
  subscriptions: CaSubscription[] = [];
  factors: CaFactor[] = [];
  prices = new Map<string, StoredPriceRow & { source: string }>();
  fx = new Map<string, FxRow & { source: string }>();
  snapshots = new Map<IsoDate, Record<string, unknown>>();
  runs: JobRunRecord[] = [];
  writes = { prices: 0, fx: 0, snapshots: 0 };

  async loadAssets() {
    return this.assets.map((a) => ({ ...a }));
  }
  async loadTransactions() {
    return [...this.transactions];
  }
  async loadCa() {
    return { subscriptions: [...this.subscriptions], factors: [...this.factors] };
  }
  async loadPrices(o: { from?: IsoDate; assetIds?: readonly string[] } = {}) {
    return [...this.prices.values()]
      .filter(
        (p) => (!o.from || p.date >= o.from) && (!o.assetIds || o.assetIds.includes(p.assetId)),
      )
      .sort((a, b) => (a.assetId + a.date < b.assetId + b.date ? -1 : 1));
  }
  async latestPriceBefore(assetId: string, date: IsoDate) {
    const rows = [...this.prices.values()].filter((p) => p.assetId === assetId && p.date < date);
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
  }
  async priceBounds(assetId: string) {
    const dates = [...this.prices.values()]
      .filter((p) => p.assetId === assetId)
      .map((p) => p.date)
      .sort();
    return dates.length
      ? { first: dates[0] as IsoDate, last: dates[dates.length - 1] as IsoDate }
      : null;
  }
  async loadFx(o: { from?: IsoDate } = {}) {
    return [...this.fx.values()].filter((r) => !o.from || r.date >= o.from);
  }
  async lastFxDate(currency: string) {
    const dates = [...this.fx.values()]
      .filter((r) => r.currency === currency)
      .map((r) => r.date)
      .sort();
    return dates[dates.length - 1] ?? null;
  }
  async upsertPrices(rows: Parameters<JobsDb['upsertPrices']>[0]) {
    this.writes.prices += rows.length;
    for (const r of rows) {
      this.prices.set(`${r.assetId}|${r.date}`, {
        assetId: r.assetId,
        date: r.date,
        close: dec(r.close),
        currency: r.currency,
        splitFactor: r.splitFactor ? dec(r.splitFactor) : null,
        source: r.source,
      });
    }
  }
  async upsertFx(rows: Parameters<JobsDb['upsertFx']>[0]) {
    this.writes.fx += rows.length;
    for (const r of rows) {
      this.fx.set(`${r.currency}|${r.date}`, {
        currency: r.currency,
        date: r.date,
        rateToEur: dec(r.rateToEur),
        source: r.source,
      });
    }
  }
  async upsertSnapshots(rows: Parameters<JobsDb['upsertSnapshots']>[0]) {
    this.writes.snapshots += rows.length;
    for (const s of rows) this.snapshots.set(s.snapshotDate, snapshotRow(s));
  }
  async recordRun(run: JobRunRecord) {
    this.runs.push(run);
  }
  async setPriceSymbol(assetId: string, source: string, symbol: string) {
    const a = this.assets.find((x) => x.id === assetId);
    if (!a) throw new Error('no such asset');
    a.priceSource = source;
    a.priceSourceId = symbol;
  }
}

/** A fetch that answers from a list of [matcher, handler] routes and records every call. */
export function fakeFetch(
  routes: [RegExp, (url: string, init?: RequestInit) => Response | Promise<Response>][],
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const [re, handler] of routes) if (re.test(url)) return handler(url, init);
    return new Response('not found', { status: 404 });
  };
  return { fetch: fn, calls };
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const noSleep = async () => {};
