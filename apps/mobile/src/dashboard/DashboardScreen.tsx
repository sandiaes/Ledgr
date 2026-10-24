import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDashboard } from '../data/usePortfolio';
import { formatDate, formatTime } from '../format';
import { Money } from '../ui/Money';
import { Banner, Card } from '../ui/parts';
import { IncludeCertificadosSwitch, NothingInScope, ScopeNote } from '../ui/Scope';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import {
  AllocationCard,
  ChartCard,
  GainCard,
  HeaderCard,
  MoversCard,
  ReconcileBanner,
  ReturnsCard,
  type AssetNames,
} from './cards';

export function DashboardScreen() {
  const styles = useStyles(makeStyles);
  const state = useDashboard();
  const assets: AssetNames = useMemo(
    () => new Map(state.status === 'ready' ? state.ledger.assets.map((a) => [a.id, a]) : []),
    [state],
  );

  const refresh = (
    <RefreshControl refreshing={state.refreshing} onRefresh={() => void state.refresh()} />
  );
  let body;
  if (state.status === 'loading') {
    body = <Text style={styles.status}>Loading…</Text>;
  } else if (state.status === 'error') {
    body = (
      <Banner tone="error">Could not load the dashboard ({state.code}). Pull down to retry.</Banner>
    );
  } else {
    const { view } = state;
    const year = view.today.slice(0, 4);
    const prices =
      view.status === 'ok' && view.freshness.newestPriceDate
        ? ` · prices ${formatDate(view.freshness.newestPriceDate, year)}`
        : '';
    body = (
      <>
        <Text style={styles.asOf}>
          as of {formatTime(state.asOf)}
          {prices}
          {state.liveUnavailable ? ' · live prices unavailable' : ''}
        </Text>
        {view.status === 'ok' ? <ScopeNote excludeTypes={view.excludeTypes} /> : null}
        {view.status === 'unvalued' ? (
          <>
            <Card>
              <Text style={styles.caption}>Total value</Text>
              <Money value={null} style={styles.total} />
            </Card>
            <Banner tone="warning">
              No exchange rate for {view.currencies.join(', ')} on {formatDate(view.date, year)}:
              the totals cannot be shown until the next rate is stored.
            </Banner>
          </>
        ) : view.empty ? (
          <Card>
            <Text style={styles.caption}>No transactions yet.</Text>
          </Card>
        ) : view.emptyInScope ? (
          <NothingInScope />
        ) : (
          <>
            <ReconcileBanner view={view} />
            <HeaderCard view={view} assets={assets} />
            <GainCard view={view} />
            <ReturnsCard returns={view.returns} />
            <ChartCard view={view} />
            <AllocationCard view={view} />
            <MoversCard view={view} assets={assets} />
          </>
        )}
      </>
    );
  }
  return (
    <ScrollView refreshControl={refresh} contentContainerStyle={styles.content}>
      <IncludeCertificadosSwitch />
      <View>{body}</View>
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    content: { paddingTop: space.md, paddingBottom: space.xl },
    status: { textAlign: 'center', color: colors.muted, marginTop: space.xl },
    asOf: { color: colors.muted, fontSize: 12, marginHorizontal: space.lg, marginBottom: space.sm },
    caption: { fontSize: 13, color: colors.muted },
    total: { fontSize: 32, fontWeight: '700', color: colors.text, marginVertical: space.xs },
  });
