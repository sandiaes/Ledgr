import {
  ALLOCATION_DIMENSIONS,
  buildAllocation,
  type AllocationDimension,
  type AllocationSlice,
  type AllocationView,
} from '@ledgr/core';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AllocationDonut } from '../dashboard/AllocationDonut';
import { usePortfolio } from '../data/usePortfolio';
import { Amount } from '../ui/Amount';
import { ChartFrame } from '../ui/ChartFrame';
import { EmptyState } from '../ui/EmptyState';
import { FigureLine } from '../ui/FigureLine';
import { assetLabel, brokerLabel, typeLabel, useNames, type Names } from '../ui/labels';
import { ListRow } from '../ui/ListRow';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { Section } from '../ui/Section';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Skeleton, SkeletonRows } from '../ui/Skeleton';
import { useSliceColors } from '../ui/sliceColors';
import { T } from '../ui/T';
import { radius, space } from '../ui/theme';

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
    <PortfolioScreen state={state} what="allocation" skeleton={<AllocationSkeleton />}>
      {(view) => <Allocation view={view} names={names} />}
    </PortfolioScreen>
  );
}

/** The control, the ring and a few rows: the shape of the loaded screen. */
function AllocationSkeleton() {
  return (
    <View style={styles.skeleton}>
      <Skeleton height={36} radius={radius.pill} />
      <Skeleton width={128} height={128} radius={radius.pill} />
      <SkeletonRows n={4} />
    </View>
  );
}

/** The largest group: what the ring's centre says. */
const largest = (slices: readonly AllocationSlice[]) =>
  slices.reduce((a, b) => (b.weight.gt(a.weight) ? b : a));

function Allocation({ view, names }: { view: AllocationView; names: Names }) {
  const [dim, setDim] = useState<AllocationDimension>('assetType');
  const [top, setTop] = useState<'5' | '10'>('5');
  const slices = view.slices[dim];
  const { typeColor, rankColor } = useSliceColors();
  const colorOf = dim === 'assetType' ? typeColor : rankColor;
  const conc = top === '5' ? view.top5 : view.top10;
  if (slices.length === 0) {
    return <EmptyState title="No open positions" line="Add a buy with +" />;
  }
  const biggest = largest(slices);
  return (
    <>
      <Section>
        <SegmentedControl
          options={ALLOCATION_DIMENSIONS.map((d) => ({ value: d, label: DIMENSION_LABELS[d] }))}
          value={dim}
          onChange={setDim}
        />
        <ChartFrame height={DONUT_HEIGHT}>
          <View style={styles.donut}>
            <AllocationDonut
              slices={slices}
              colorOf={colorOf}
              radius={80}
              innerRadius={62}
              center={
                <View style={styles.center}>
                  <Amount kind="pct" value={biggest.weight} variant="title2" />
                  <T variant="caption" tone="muted" numberOfLines={1} style={styles.centerLabel}>
                    {groupLabel(names, dim, biggest.key)}
                  </T>
                </View>
              }
            />
          </View>
        </ChartFrame>
        {slices.map((s, i) => (
          <ListRow
            key={s.key}
            testID="allocation-row"
            leading={<View style={[styles.dot, { backgroundColor: colorOf(s.key, i) }]} />}
            title={groupLabel(names, dim, s.key)}
            right={<Amount kind="pct" value={s.weight} variant="headline" />}
            rightSub={<Amount value={s.valueEur} variant="sub" />}
          />
        ))}
        <ListRow
          title="Total"
          right={<Amount value={view.totalValueEur} variant="headline" />}
          last
        />
      </Section>
      <Section
        title="Concentration"
        action={
          <SegmentedControl
            compact
            options={[
              { value: '5', label: 'Top 5' },
              { value: '10', label: 'Top 10' },
            ]}
            value={top}
            onChange={setTop}
          />
        }
      >
        <FigureLine label={`${conc.top.length} largest positions`} strong>
          <Amount kind="pct" value={conc.topWeight} variant="headline" />
        </FigureLine>
        {conc.top.map((s, i) => (
          <ListRow
            key={s.key}
            title={assetLabel(names, s.key)}
            right={<Amount kind="pct" value={s.weight} variant="body" />}
            rightSub={<Amount value={s.valueEur} variant="sub" />}
            last={i === conc.top.length - 1}
          />
        ))}
      </Section>
    </>
  );
}

const DONUT_HEIGHT = 176;

const styles = StyleSheet.create({
  skeleton: { gap: space.lg, alignItems: 'stretch' },
  donut: { alignItems: 'center' },
  center: { alignItems: 'center', maxWidth: 96 },
  centerLabel: { textAlign: 'center' },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
});
