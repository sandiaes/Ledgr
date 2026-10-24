import {
  buildDashboard,
  holdingPeriods,
  localDate,
  type IsoDate,
  type PortfolioInput,
  type StoredPriceRow,
} from '@ledgr/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { errorCode } from '../auth/errors';
import { useServices, type Ledger, type Market } from '../services';

export const TIME_ZONE = 'Europe/Lisbon';
const MINUTE = 60_000;

/** Assets held today that have market prices (certificados are valued by factor). */
function pricedHoldings(ledger: Ledger, today: IsoDate): string[] {
  const type = new Map(ledger.assets.map((a) => [a.id, a.assetType]));
  return holdingPeriods(ledger.transactions, today)
    .filter((p) => p.to === null && type.get(p.assetId) !== 'certificado_aforro')
    .map((p) => p.assetId)
    .sort();
}

export type PortfolioState<V> =
  | { status: 'loading' }
  | { status: 'error'; code: string }
  | {
      status: 'ready';
      view: V;
      ledger: Ledger;
      market: Market;
      /** When the prices were read: the "as of" time. */
      asOf: number;
      /** value-now did not answer: valued with the cached quotes and closes. */
      liveUnavailable: boolean;
    };

export type PortfolioResult<V> = PortfolioState<V> & {
  refreshing: boolean;
  refresh(): Promise<void>;
};

/**
 * The fetched rows turned into one screen's view by a core builder (docs/app-plan.md §5):
 * value-now first (it refreshes the quotes), the ledger and snapshots in parallel, then
 * prices. Every screen shares the same cached queries; core does all the arithmetic.
 * `build` must be a stable function (a core builder).
 */
export function usePortfolio<V>(build: (input: PortfolioInput) => V): PortfolioResult<V> {
  const { data: api } = useServices();
  const today = localDate(new Date(), TIME_ZONE);

  const valueNow = useQuery({
    queryKey: ['valueNow'],
    queryFn: () => api.valueNow(),
    staleTime: 5 * MINUTE,
  });
  const ledger = useLedger();
  const snapshots = useQuery({
    queryKey: ['snapshots'],
    queryFn: () => api.snapshots(),
    staleTime: 60 * MINUTE,
  });
  const held = useMemo(
    () => (ledger.data ? pricedHoldings(ledger.data, today) : null),
    [ledger.data, today],
  );
  const market = useQuery({
    queryKey: ['market', today, held?.join(',')],
    queryFn: () => api.market(today, held ?? []),
    enabled: held !== null && valueNow.isFetched,
    staleTime: 5 * MINUTE,
  });

  const computed = useMemo(() => {
    if (!ledger.data || !snapshots.data || !market.data || !valueNow.isFetched) return null;
    try {
      const reference = valueNow.data ?? null;
      return {
        view: build({
          today,
          transactions: ledger.data.transactions,
          assets: ledger.data.assets,
          prices: market.data.prices,
          liveQuotes: market.data.liveQuotes,
          fx: market.data.fx,
          ca: ledger.data.ca,
          snapshots: snapshots.data,
          reference,
        }),
      };
    } catch (e) {
      return { error: errorCode(e) };
    }
  }, [build, today, ledger.data, snapshots.data, market.data, valueNow.data, valueNow.isFetched]);

  const refresh = useCallback(async () => {
    await valueNow.refetch();
    await Promise.all([ledger.refetch(), snapshots.refetch()]);
    await market.refetch();
  }, [valueNow, ledger, snapshots, market]);
  const refreshing = valueNow.isRefetching || ledger.isRefetching || market.isRefetching;

  const failed = [ledger, snapshots, market].find((q) => q.isError);
  let state: PortfolioState<V>;
  if (failed) state = { status: 'error', code: errorCode(failed.error) };
  else if (computed && 'error' in computed)
    state = { status: 'error', code: computed.error as string };
  else if (computed && ledger.data && market.data)
    state = {
      status: 'ready',
      view: computed.view as V,
      ledger: ledger.data,
      market: market.data,
      asOf: market.dataUpdatedAt,
      liveUnavailable: valueNow.isError || valueNow.data === null,
    };
  else state = { status: 'loading' };
  return { ...state, refreshing, refresh };
}

export const useDashboard = () => usePortfolio(buildDashboard);

/** One asset's whole price history, fetched (paginated) when its chart opens. */
export function usePriceHistory(assetId: string, enabled: boolean) {
  const { data: api } = useServices();
  return useQuery<StoredPriceRow[]>({
    queryKey: ['prices', assetId],
    queryFn: () => api.priceHistory(assetId),
    enabled,
    staleTime: 60 * MINUTE,
  });
}

/** The ledger alone (forms, Activity, Certificados): the same cached query as every screen. */
export function useLedger() {
  const { data: api } = useServices();
  return useQuery({
    queryKey: ['ledger'],
    queryFn: () => api.ledger(),
    staleTime: 60 * MINUTE,
  });
}

/** The owner's today (Europe/Lisbon). */
export const useToday = (): IsoDate => localDate(new Date(), TIME_ZONE);

/**
 * After a save: the ledger, the market data (held assets may change) and value-now are
 * fetched again, so every figure that depends on the ledger follows (docs/app-plan.md §5).
 */
export function useRefreshAfterWrite(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all(
      [['ledger'], ['market'], ['valueNow']].map((queryKey) =>
        client.invalidateQueries({ queryKey }),
      ),
    );
  }, [client]);
}

/** The newest price and snapshot runs (Settings). */
export function useJobRuns() {
  const { data: api } = useServices();
  return useQuery({ queryKey: ['jobRuns'], queryFn: () => api.jobRuns(), staleTime: 5 * MINUTE });
}
