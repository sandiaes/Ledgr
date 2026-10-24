import type { DashboardView, Decimal, IsoDate } from '@ledgr/core';
import { createContext, useContext, type ReactNode } from 'react';
import { useDashboard } from '../data/usePortfolio';

type Summary = ReturnType<typeof useDashboard>;

const PortfolioSummaryContext = createContext<Summary | null>(null);

/**
 * The Dashboard view, built once for the whole app (docs/design.md §6.1): the header and the
 * Dashboard both read it, so the core build runs once per change of data, not twice.
 */
export function PortfolioSummaryProvider({ children }: { children: ReactNode }) {
  const summary = useDashboard();
  return (
    <PortfolioSummaryContext.Provider value={summary}>{children}</PortfolioSummaryContext.Provider>
  );
}

export function usePortfolioSummary(): Summary {
  const summary = useContext(PortfolioSummaryContext);
  if (!summary) throw new Error('PortfolioSummaryProvider missing');
  return summary;
}

/** What the header shows, from the summary. */
export type HeaderFigures =
  | { status: 'loading' }
  | { status: 'error'; code: string }
  /** A holding has no FX rate: no figure at all, and the reason. */
  | { status: 'unvalued'; currencies: string[]; date: IsoDate; today: IsoDate }
  | {
      status: 'ready';
      today: IsoDate;
      asOf: number;
      excludeTypes: DashboardView['excludeTypes'];
      /** Portfolio value, V(T). */
      valueEur: Decimal;
      /** Today's result: day change € and % (docs/kpis.md §2). */
      dayEur: Decimal;
      dayPct: Decimal | null;
      /** Total result: total gain G (docs/kpis.md §1) and the TWR Since start (decision D1). */
      totalEur: Decimal;
      totalPct: Decimal | null;
    };

export function useHeaderFigures(): HeaderFigures {
  const state = usePortfolioSummary();
  if (state.status === 'loading') return { status: 'loading' };
  if (state.status === 'error') return { status: 'error', code: state.code };
  const { view } = state;
  if (view.status === 'unvalued') {
    return {
      status: 'unvalued',
      currencies: view.currencies,
      date: view.date,
      today: view.today,
    };
  }
  const sinceStart = view.returns.find((r) => r.period === 'sinceStart');
  return {
    status: 'ready',
    today: view.today,
    asOf: state.asOf,
    excludeTypes: view.excludeTypes,
    valueEur: view.totalValueEur,
    dayEur: view.dayChange.changeEur,
    dayPct: view.dayChange.changePct,
    totalEur: view.gains.totalReturnEur,
    totalPct: sinceStart?.twr.ok ? sinceStart.twr.cumulative : null,
  };
}
