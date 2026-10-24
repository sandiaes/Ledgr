import type { IsoDate, PortfolioUnvalued, ScopedView } from '@ledgr/core';
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { PortfolioResult, PortfolioState } from '../data/usePortfolio';
import { formatDate, formatTime } from '../format';
import { ErrorState } from './EmptyState';
import { Banner } from './parts';
import { NothingInScope, ScopeNote } from './Scope';
import { SkeletonRows } from './Skeleton';
import { T } from './T';
import { space } from './theme';
import { useColors } from './ThemeProvider';

type Ready<V> = Extract<PortfolioState<V>, { status: 'ready' }>;
type Valued<V> = Exclude<V, PortfolioUnvalued>;

/**
 * The frame of every screen built from the portfolio: pull to refresh, loading, an error in
 * place (a code, never an amount), "as of" with the price date, the "no FX rate" case in
 * which no figure is shown, and the asset scope: "Excluding certificados" while they are
 * left out, and an empty state when nothing else is held.
 */
export function PortfolioScreen<V extends { status: string; today: IsoDate }>(props: {
  state: PortfolioResult<V>;
  /** "positions", "allocation"... for the error message. */
  what: string;
  children: (view: Valued<V>, ready: Ready<V>) => ReactNode;
}) {
  const colors = useColors();
  const { state } = props;
  const refresh = (
    <RefreshControl
      refreshing={state.refreshing}
      onRefresh={() => void state.refresh()}
      colors={[colors.accent]}
      progressBackgroundColor={colors.raised}
    />
  );
  let body: ReactNode;
  if (state.status === 'loading') {
    body = (
      <View style={styles.pad} testID="portfolio-loading">
        <SkeletonRows n={6} />
      </View>
    );
  } else if (state.status === 'error') {
    body = <ErrorState title={`Could not load the ${props.what}`} code={state.code} />;
  } else {
    const view = state.view;
    const year = view.today.slice(0, 4);
    if (view.status === 'unvalued') {
      const u = view as unknown as PortfolioUnvalued;
      body = (
        <Banner tone="warning">
          No exchange rate for {u.currencies.join(', ')} on {formatDate(u.date, year)}: the figures
          cannot be shown until the next rate is stored.
        </Banner>
      );
    } else {
      const newest = (view as { newestPriceDate?: IsoDate | null }).newestPriceDate;
      const scoped = view as unknown as Partial<ScopedView>;
      body = (
        <>
          <T variant="caption" tone="faint" style={styles.asOf}>
            as of {formatTime(state.asOf)}
            {newest ? ` · prices ${formatDate(newest, year)}` : ''}
            {state.liveUnavailable ? ' · live prices unavailable' : ''}
          </T>
          <ScopeNote excludeTypes={scoped.excludeTypes} />
          {scoped.emptyInScope ? (
            <NothingInScope />
          ) : (
            props.children(view as Valued<V>, state as Ready<V>)
          )}
        </>
      );
    }
  }
  return (
    <ScrollView
      refreshControl={refresh}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View>{body}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.md, paddingBottom: space.xl },
  pad: { paddingHorizontal: space.lg },
  asOf: { marginHorizontal: space.lg, marginBottom: space.sm },
});
