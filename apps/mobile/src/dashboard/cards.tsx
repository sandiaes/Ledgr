import type { AssetRecord } from '@ledgr/client';
import type {
  DashboardView,
  Mover,
  PeriodReturn,
  ReconcileIssue,
  ReturnPeriod,
  SeriesRange,
  TwrFigure,
  XirrFigure,
} from '@ledgr/core';
import { SERIES_RANGES } from '@ledgr/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatDate } from '../format';
import { useRootNavigation } from '../navigation';
import { Amount } from '../ui/Amount';
import { ChartFrame } from '../ui/ChartFrame';
import { Chip } from '../ui/Chip';
import { FigureLine as Line } from '../ui/FigureLine';
import { typeLabel } from '../ui/labels';
import { ListRow } from '../ui/ListRow';
import { Banner } from '../ui/parts';
import { Section } from '../ui/Section';
import { SegmentedControl } from '../ui/SegmentedControl';
import { useSliceColors } from '../ui/sliceColors';
import { T } from '../ui/T';
import { radius, space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import { AllocationDonut } from './AllocationDonut';
import { CHART_HEIGHT, ValueChart } from './ValueChart';

export type AssetNames = ReadonlyMap<string, AssetRecord>;
const label = (assets: AssetNames, id: string) => {
  const a = assets.get(id);
  return a?.ticker || a?.name || 'Unknown asset';
};

/** "2 prices stale", "1 price pending", "CA factor 41 days old"; tap for the assets. */
export function Freshness({ view, assets }: { view: DashboardView; assets: AssetNames }) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const { stalePrices, pendingPrices, caFactor } = view.freshness;
  const notes: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (stalePrices.length > 0) notes.push(`${plural(stalePrices.length, 'price')} stale`);
  if (pendingPrices.length > 0) notes.push(`${plural(pendingPrices.length, 'price')} pending`);
  if (caFactor?.stale) notes.push(`CA factor ${caFactor.ageDays} days old`);
  if (notes.length === 0) return null;
  const year = view.today.slice(0, 4);
  return (
    <Pressable
      onPress={() => setOpen(!open)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={styles.notes}
    >
      <T variant="sub" tone="warning" style={styles.bold}>
        {notes.join(' · ')} {open ? '▴' : '▾'}
      </T>
      {open ? (
        <View style={styles.noteList}>
          {stalePrices.map((f) => (
            <T key={`s${f.assetId}`} variant="sub" tone="muted">
              {label(assets, f.assetId)}: last price {formatDate(f.asOf, year)}
            </T>
          ))}
          {pendingPrices.map((f) => (
            <T key={`p${f.assetId}`} variant="sub" tone="muted">
              {label(assets, f.assetId)}: no price yet, valued at its trade price
            </T>
          ))}
          {caFactor?.stale ? (
            <T variant="sub" tone="muted">
              Certificados: oldest factor from {formatDate(caFactor.asOf, year)}
            </T>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function GainSection({ view }: { view: DashboardView }) {
  const styles = useStyles(makeStyles);
  const g = view.gains;
  return (
    <Section title="Gain">
      <Line label="Total gain" strong>
        <Amount value={g.totalReturnEur} sign tone variant="headline" />
      </Line>
      <Line label="Realized" sub>
        <Amount value={g.realizedEur} sign />
      </Line>
      <Line label="Unrealized" sub>
        <Amount value={g.unrealizedEur} sign />
        <Amount kind="pct" value={view.unrealizedPct} sign variant="sub" style={styles.faintText} />
      </Line>
      <Line label="Income" sub>
        <Amount value={g.incomeNetEur} sign />
      </Line>
      <Line label="Other costs" sub>
        <Amount value={g.otherCostsEur.neg()} sign />
      </Line>
      <View style={styles.divider} />
      <Line label="Net invested">
        <Amount value={view.netInvestedEur} />
      </Line>
    </Section>
  );
}

const PERIODS: { value: ReturnPeriod; label: string }[] = [
  { value: 'sinceStart', label: 'Since start' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
];

const REASONS: Record<string, string> = {
  'snapshot-missing': 'snapshot missing',
  'no-flows': 'no transactions',
  'period-too-short': 'period too short',
};
const reason = (r: string) => REASONS[r] ?? 'cannot be computed';

function XirrValue({ f }: { f: XirrFigure }) {
  if (!f.ok) return <Failed why={f.reason} />;
  return (
    <>
      <Amount kind="pct" value={f.displayRate} sign tone variant="title2" />
      <T variant="caption" tone="muted">
        {f.annualized ? 'a year' : 'not annualized'}
      </T>
    </>
  );
}

function TwrValue({ f }: { f: TwrFigure }) {
  if (!f.ok) return <Failed why={f.reason} />;
  return (
    <>
      <Amount kind="pct" value={f.cumulative} sign tone variant="title2" />
      {f.annualized ? (
        <T variant="caption" tone="muted">
          <Amount kind="pct" value={f.annualized} sign variant="caption" /> a year
        </T>
      ) : (
        <T variant="caption" tone="muted">
          cumulative
        </T>
      )}
    </>
  );
}

function Failed({ why }: { why: string }) {
  return (
    <>
      <T variant="title2">—</T>
      <T variant="caption" tone="muted">
        {reason(why)}
      </T>
    </>
  );
}

export function ReturnsSection({ returns }: { returns: readonly PeriodReturn[] }) {
  const styles = useStyles(makeStyles);
  const [period, setPeriod] = useState<ReturnPeriod>('sinceStart');
  const navigation = useRootNavigation();
  const r = returns.find((x) => x.period === period);
  return (
    <Section
      title="Returns"
      action={<SegmentedControl compact options={PERIODS} value={period} onChange={setPeriod} />}
    >
      {r ? (
        <>
          <View style={styles.columns}>
            <View style={styles.column}>
              <T variant="caption" tone="muted">
                XIRR
              </T>
              <XirrValue f={r.xirr} />
            </View>
            <View style={styles.column}>
              <T variant="caption" tone="muted">
                TWR
              </T>
              <TwrValue f={r.twr} />
            </View>
          </View>
          {r.fromStart && period !== 'sinceStart' ? (
            <T variant="caption" tone="muted" style={styles.gap}>
              The portfolio started inside this period: since start.
            </T>
          ) : null}
        </>
      ) : null}
      <More label="Monthly and yearly returns" onPress={() => navigation.navigate('Performance')} />
    </Section>
  );
}

/**
 * The value vs net invested chart. Under it only the selected range's return: the market
 * gain in € and the time-weighted % (docs/kpis.md §4.1), not the changes in value and in
 * net invested.
 */
export function ChartSection({ view }: { view: DashboardView }) {
  const styles = useStyles(makeStyles);
  const [range, setRange] = useState<SeriesRange>('1Y');
  const s = view.series[range];
  const twr = s.periodReturn.twr;
  const first = s.chart[0];
  const last = s.chart[s.chart.length - 1];
  return (
    <Section title="Value vs net invested" testID="chart-section">
      <ChartFrame
        height={CHART_HEIGHT}
        empty={s.chart.length < 2}
        xLabels={first && last ? [formatDate(first.date), formatDate(last.date)] : undefined}
        controls={
          <SegmentedControl
            options={SERIES_RANGES.map((r) => ({ value: r, label: r }))}
            value={range}
            onChange={setRange}
          />
        }
        summary={
          <View style={styles.line} testID="period-return">
            <T variant="body">Return {range}</T>
            <View style={styles.lineValue}>
              <Amount value={s.periodReturn.marketGainEur} sign tone variant="headline" />
              <T variant="sub" tone="faint">
                ·
              </T>
              <Amount
                kind="pct"
                value={twr.ok ? twr.cumulative : null}
                sign
                tone
                variant="headline"
              />
            </View>
          </View>
        }
        legend={
          <>
            <View style={styles.legendItem}>
              <View style={styles.legendValue} />
              <T variant="caption" tone="muted">
                Value
              </T>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendInvested} />
              <T variant="caption" tone="muted">
                Net invested
              </T>
            </View>
          </>
        }
      >
        <ValueChart points={s.chart} />
      </ChartFrame>
    </Section>
  );
}

/** A "see more" link at the bottom of a section. */
function More(props: { label: string; onPress(): void }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={props.onPress} accessibilityRole="link" style={styles.more}>
      <T variant="sub" tone="accent">
        {props.label} ›
      </T>
    </Pressable>
  );
}

export function AllocationSection({ view }: { view: DashboardView }) {
  const styles = useStyles(makeStyles);
  const navigation = useRootNavigation();
  const { typeColor } = useSliceColors();
  if (view.allocation.length === 0) return null;
  return (
    <Section title="Allocation by type">
      <View style={styles.allocation}>
        <AllocationDonut slices={view.allocation} colorOf={typeColor} />
        <View style={styles.allocationLegend}>
          {view.allocation.map((s) => (
            <View key={s.key} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: typeColor(s.key) }]} />
              <T variant="sub" style={styles.legendLabel}>
                {typeLabel(s.key)}
              </T>
              <Amount kind="pct" value={s.weight} variant="sub" style={styles.legendPct} />
              <Amount value={s.valueEur} variant="caption" style={styles.legendAmount} />
            </View>
          ))}
        </View>
      </View>
      <More
        label="By broker, currency and asset"
        onPress={() => navigation.navigate('Allocation')}
      />
    </Section>
  );
}

type MoverBy = 'eur' | 'pct';

/**
 * One top mover. The selected unit is the main figure and the other sits under it: with €
 * selected the € change is the headline and the % is under it; with % selected it is the
 * other way round (docs/design.md §7.1). A position opened today has no % and shows "new".
 */
export function MoverRow(props: {
  mover: Mover;
  by: MoverBy;
  assets: AssetNames;
  last: boolean;
  onPress(): void;
}) {
  const { mover: m, by } = props;
  const eur = (variant: 'headline' | 'sub') => (
    <Amount value={m.changeEur} sign tone variant={variant} />
  );
  const pct = (variant: 'headline' | 'sub') =>
    m.openedToday ? (
      <T variant={variant} tone="muted">
        new
      </T>
    ) : (
      <Amount kind="pct" value={m.changePct} sign tone variant={variant} />
    );
  return (
    <ListRow
      testID="mover-row"
      title={label(props.assets, m.assetId)}
      subtitle={props.assets.get(m.assetId)?.name ?? ''}
      right={by === 'eur' ? eur('headline') : pct('headline')}
      rightSub={by === 'eur' ? pct('sub') : eur('sub')}
      onPress={props.onPress}
      last={props.last}
    />
  );
}

export function MoversSection({ view, assets }: { view: DashboardView; assets: AssetNames }) {
  const styles = useStyles(makeStyles);
  const [span, setSpan] = useState<'day' | 'total'>('day');
  const [by, setBy] = useState<MoverBy>('eur');
  const navigation = useRootNavigation();
  const lists = view.movers[by][span];
  const movers = [...lists.up, ...lists.down];
  return (
    <Section
      title="Top movers"
      action={
        <View style={styles.moverControls}>
          <SegmentedControl
            compact
            options={[
              { value: 'day', label: 'Day' },
              { value: 'total', label: 'Total' },
            ]}
            value={span}
            onChange={setSpan}
          />
          <View style={styles.units}>
            <Chip label="€" selected={by === 'eur'} onPress={() => setBy('eur')} />
            <Chip label="%" selected={by === 'pct'} onPress={() => setBy('pct')} />
          </View>
        </View>
      }
    >
      {movers.length === 0 ? (
        <T variant="sub" tone="muted">
          No changes to show.
        </T>
      ) : null}
      {movers.map((m, i) => (
        <MoverRow
          key={m.assetId}
          mover={m}
          by={by}
          assets={assets}
          last={i === movers.length - 1}
          onPress={() => navigation.navigate('PositionDetail', { assetId: m.assetId })}
        />
      ))}
    </Section>
  );
}

const CHECKS: Record<ReconcileIssue['check'], string> = {
  'capital-gain': 'value − net invested is not realized + unrealized',
  accounts: 'a position’s broker split does not add up',
  'value-now-value': 'the server’s value-now total differs (redeploy the functions)',
  'value-now-cost': 'the server’s value-now cost basis differs (redeploy the functions)',
};

/** Shown, never silently fixed (docs/app-plan.md §5). */
export function ReconcileBanner({ view }: { view: DashboardView }) {
  if (view.reconcile.ok) return null;
  const checks = [...new Set(view.reconcile.issues.map((i) => CHECKS[i.check]))];
  return <Banner tone="warning">Figures do not reconcile: {checks.join('; ')}.</Banner>;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    bold: { fontWeight: '600' },
    faintText: { color: colors.faint },
    notes: { marginHorizontal: space.lg, marginBottom: space.lg },
    noteList: { marginTop: space.xs, gap: 2 },
    line: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      paddingVertical: space.xs,
      gap: space.md,
    },
    lineValue: { flexDirection: 'row', gap: space.sm, alignItems: 'baseline' },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginVertical: space.sm,
    },
    columns: { flexDirection: 'row' },
    column: { flex: 1, gap: 2 },
    gap: { marginTop: space.sm },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    // The value line is solid and the net invested line dashed, as in the chart.
    legendValue: { width: 16, height: 2, backgroundColor: colors.value },
    legendInvested: {
      width: 16,
      height: 0,
      borderTopWidth: 2,
      borderStyle: 'dashed',
      borderColor: colors.invested,
    },
    allocation: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
    allocationLegend: { flex: 1, gap: space.sm },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    dot: { width: 8, height: 8, borderRadius: radius.pill },
    legendLabel: { flex: 1 },
    legendPct: { minWidth: 52, textAlign: 'right' },
    legendAmount: { color: colors.muted },
    moverControls: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    units: { flexDirection: 'row', gap: space.xs },
    more: { marginTop: space.sm, alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center' },
  });
