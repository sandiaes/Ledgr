import { useMemo, useRef, type ComponentRef } from 'react';
import { useScrollToTop } from '@react-navigation/native';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { formatDate, formatTime } from '../format';
import { usePortfolioSummary } from '../header/PortfolioSummary';
import { EmptyState, ErrorState } from '../ui/EmptyState';
import { Banner } from '../ui/parts';
import { IncludeCertificadosSwitch, NothingInScope, ScopeNote } from '../ui/Scope';
import { SkeletonChart, SkeletonRows } from '../ui/Skeleton';
import { T } from '../ui/T';
import { space } from '../ui/theme';
import { useColors } from '../ui/ThemeProvider';
import {
  AllocationSection,
  ChartSection,
  Freshness,
  GainSection,
  MoversSection,
  ReconcileBanner,
  ReturnsSection,
  type AssetNames,
} from './cards';

export function DashboardScreen() {
  const colors = useColors();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useScrollToTop(scroll);
  const state = usePortfolioSummary();
  const assets: AssetNames = useMemo(
    () => new Map(state.status === 'ready' ? state.ledger.assets.map((a) => [a.id, a]) : []),
    [state],
  );

  const refresh = (
    <RefreshControl
      refreshing={state.refreshing}
      onRefresh={() => void state.refresh()}
      colors={[colors.accent]}
      progressBackgroundColor={colors.raised}
    />
  );
  let body;
  if (state.status === 'loading') {
    body = (
      <View style={styles.pad} testID="dashboard-loading">
        <SkeletonRows n={5} />
        <View style={styles.gap} />
        <SkeletonChart />
      </View>
    );
  } else if (state.status === 'error') {
    body = <ErrorState title="Could not load the dashboard" code={state.code} />;
  } else {
    const { view } = state;
    const year = view.today.slice(0, 4);
    const prices =
      view.status === 'ok' && view.freshness.newestPriceDate
        ? ` · prices ${formatDate(view.freshness.newestPriceDate, year)}`
        : '';
    body = (
      <>
        <T variant="caption" tone="faint" style={styles.asOf}>
          as of {formatTime(state.asOf)}
          {prices}
          {state.liveUnavailable ? ' · live prices unavailable' : ''}
        </T>
        {view.status === 'ok' ? <ScopeNote excludeTypes={view.excludeTypes} /> : null}
        {view.status === 'unvalued' ? (
          <Banner tone="warning">
            No exchange rate for {view.currencies.join(', ')} on {formatDate(view.date, year)}: the
            totals cannot be shown until the next rate is stored.
          </Banner>
        ) : view.empty ? (
          <EmptyState title="No transactions yet" line="Add your first one with +" />
        ) : view.emptyInScope ? (
          <NothingInScope />
        ) : (
          <>
            <ReconcileBanner view={view} />
            <Freshness view={view} assets={assets} />
            <GainSection view={view} />
            <ReturnsSection returns={view.returns} />
            <ChartSection view={view} />
            <AllocationSection view={view} />
            <MoversSection view={view} assets={assets} />
          </>
        )}
      </>
    );
  }
  return (
    <ScrollView ref={scroll} refreshControl={refresh} contentContainerStyle={styles.content}>
      <IncludeCertificadosSwitch />
      <View>{body}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.md, paddingBottom: space.xl },
  pad: { paddingHorizontal: space.lg, paddingTop: space.md },
  gap: { height: space.xl },
  asOf: { marginHorizontal: space.lg, marginBottom: space.sm },
});
