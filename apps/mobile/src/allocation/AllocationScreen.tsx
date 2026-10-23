import {
  ALLOCATION_DIMENSIONS,
  buildAllocation,
  type AllocationDimension,
  type AllocationView,
} from '@ledgr/core';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AllocationDonut, rankColor, typeColor } from '../dashboard/AllocationDonut';
import { usePortfolio } from '../data/usePortfolio';
import { assetLabel, brokerLabel, typeLabel, useNames, type Names } from '../ui/labels';
import { Money, Pct } from '../ui/Money';
import { Card, Segmented } from '../ui/parts';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { colors, space } from '../ui/theme';

const DIMENSION_LABELS: Record<AllocationDimension, string> = {
  assetType: 'Type',
  account: 'Broker',
  currency: 'Currency',
  asset: 'Asset',
};

const groupLabel = (names: Names, dim: AllocationDimension, key: string) =>
  dim === 'assetType'
    ? typeLabel(key)
    : dim === 'account'
      ? brokerLabel(names, key)
      : dim === 'asset'
        ? assetLabel(names, key)
        : key;

/** By type, broker, listing currency and asset (docs/kpis.md §6), and top 5 / 10. */
export function AllocationScreen() {
  const state = usePortfolio(buildAllocation);
  const names = useNames(state.status === 'ready' ? state.ledger : null);
  return (
    <PortfolioScreen state={state} what="allocation">
      {(view) => <Allocation view={view} names={names} />}
    </PortfolioScreen>
  );
}

function Allocation({ view, names }: { view: AllocationView; names: Names }) {
  const [dim, setDim] = useState<AllocationDimension>('assetType');
  const [top, setTop] = useState<'5' | '10'>('5');
  const slices = view.slices[dim];
  const colorOf = dim === 'assetType' ? typeColor : rankColor;
  const conc = top === '5' ? view.top5 : view.top10;
  if (slices.length === 0) {
    return (
      <Card>
        <Text style={styles.muted}>No open positions.</Text>
      </Card>
    );
  }
  return (
    <>
      <Card>
        <Segmented
          options={ALLOCATION_DIMENSIONS.map((d) => ({ value: d, label: DIMENSION_LABELS[d] }))}
          value={dim}
          onChange={setDim}
        />
        <View style={styles.donut}>
          <AllocationDonut slices={slices} colorOf={colorOf} />
        </View>
        {slices.map((s, i) => (
          <View key={s.key} style={styles.row} testID="allocation-row">
            <Text style={[styles.dot, { color: colorOf(s.key, i) }]}>●</Text>
            <Text style={styles.label} numberOfLines={1}>
              {groupLabel(names, dim, s.key)}
            </Text>
            <Pct value={s.weight} style={styles.pct} />
            <Money value={s.valueEur} style={styles.value} />
          </View>
        ))}
        <View style={[styles.row, styles.totalRow]}>
          <Text style={[styles.label, styles.strong]}>Total</Text>
          <Money value={view.totalValueEur} style={[styles.value, styles.strong]} />
        </View>
      </Card>
      <Card title="Concentration">
        <Segmented
          options={[
            { value: '5', label: 'Top 5' },
            { value: '10', label: 'Top 10' },
          ]}
          value={top}
          onChange={setTop}
        />
        <View style={styles.row}>
          <Text style={[styles.label, styles.strong]}>{conc.top.length} largest positions</Text>
          <Pct value={conc.topWeight} style={[styles.pct, styles.strong]} />
        </View>
        {conc.top.map((s) => (
          <View key={s.key} style={styles.row}>
            <Text style={styles.label} numberOfLines={1}>
              {assetLabel(names, s.key)}
            </Text>
            <Pct value={s.weight} style={styles.pct} />
            <Money value={s.valueEur} style={styles.value} />
          </View>
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  donut: { alignItems: 'center', marginVertical: space.md },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs, paddingVertical: 4 },
  totalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: space.xs,
  },
  dot: { fontSize: 12 },
  label: { flex: 1, fontSize: 14, color: colors.text },
  pct: { fontSize: 13, color: colors.text, minWidth: 60, textAlign: 'right' },
  value: { fontSize: 13, color: colors.muted, minWidth: 96, textAlign: 'right' },
  strong: { fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
});
