import {
  buildDashboard,
  holdingPeriods,
  localDate,
  type Dashboard,
  type IsoDate,
} from '@ledgr/core';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { errorCode } from '../auth/errors';
import { useServices, type Ledger } from '../services';

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

export type DashboardState =
  | { status: 'loading' }
  | { status: 'error'; code: string }
  | {
      status: 'ready';
      view: Dashboard;
      ledger: Ledger;
      /** When the prices were read: the "as of" time. */
      asOf: number;
      /** value-now did not answer: valued with the cached quotes and closes. */
      liveUnavailable: boolean;
    };

/**
 * The Dashboard's data (docs/app-plan.md §5): value-now first (it refreshes the quotes),
 * the ledger and snapshots in parallel, then prices; core does all the arithmetic.
 */
export function useDashboard(): DashboardState & { refreshing: boolean; refresh(): Promise<void> } {
  const { data: api } = useServices();
  const today = localDate(new Date(), TIME_ZONE);

  const valueNow = useQuery({
    queryKey: ['valueNow'],
    queryFn: () => api.valueNow(),
    staleTime: 5 * MINUTE,
  });
  const ledger = useQuery({
    queryKey: ['ledger'],
    queryFn: () => api.ledger(),
    staleTime: 60 * MINUTE,
  });
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
        view: buildDashboard({
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
  }, [today, ledger.data, snapshots.data, market.data, valueNow.data, valueNow.isFetched]);

  const refresh = useCallback(async () => {
    await valueNow.refetch();
    await Promise.all([ledger.refetch(), snapshots.refetch()]);
    await market.refetch();
  }, [valueNow, ledger, snapshots, market]);
  const refreshing = valueNow.isRefetching || ledger.isRefetching || market.isRefetching;

  const failed = [ledger, snapshots, market].find((q) => q.isError);
  let state: DashboardState;
  if (failed) state = { status: 'error', code: errorCode(failed.error) };
  else if (computed && 'error' in computed)
    state = { status: 'error', code: computed.error as string };
  else if (computed && ledger.data)
    state = {
      status: 'ready',
      view: computed.view,
      ledger: ledger.data,
      asOf: market.dataUpdatedAt,
      liveUnavailable: valueNow.isError || valueNow.data === null,
    };
  else state = { status: 'loading' };
  return { ...state, refreshing, refresh };
}
