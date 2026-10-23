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
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDate } from '../format';
import { Money, Pct } from '../ui/Money';
import { Banner, Card, Segmented } from '../ui/parts';
import { colors, space } from '../ui/theme';
import { AllocationDonut, typeColor } from './AllocationDonut';
import { ValueChart } from './ValueChart';

export type AssetNames = ReadonlyMap<string, AssetRecord>;
const label = (assets: AssetNames, id: string) => {
  const a = assets.get(id);
  return a?.ticker || a?.name || 'Unknown asset';
};

function Line(props: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, props.strong && styles.strong]}>{props.label}</Text>
      <View style={styles.lineValue}>{props.children}</View>
    </View>
  );
}

export function HeaderCard({ view, assets }: { view: DashboardView; assets: AssetNames }) {
  return (
    <Card>
      <Text style={styles.caption}>Total value</Text>
      <Money value={view.totalValueEur} style={styles.total} />
      <View style={styles.dayChange}>
        <Money value={view.dayChange.changeEur} sign colored style={styles.dayText} />
        <Pct value={view.dayChange.changePct} sign colored style={styles.dayText} />
        <Text style={styles.muted}> today</Text>
      </View>
      <Freshness view={view} assets={assets} />
    </Card>
  );
}

/** "2 prices stale", "1 price pending", "CA factor 41 days old"; tap for the assets. */
function Freshness({ view, assets }: { view: DashboardView; assets: AssetNames }) {
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
    <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" style={styles.notes}>
      <Text style={styles.warning}>
        {notes.join(' · ')} {open ? '▴' : '▾'}
      </Text>
      {open ? (
        <View style={styles.noteList}>
          {stalePrices.map((f) => (
            <Text key={`s${f.assetId}`} style={styles.muted}>
              {label(assets, f.assetId)}: last price {formatDate(f.asOf, year)}
            </Text>
          ))}
          {pendingPrices.map((f) => (
            <Text key={`p${f.assetId}`} style={styles.muted}>
              {label(assets, f.assetId)}: no price yet, valued at its trade price
            </Text>
          ))}
          {caFactor?.stale ? (
            <Text style={styles.muted}>
              Certificados: oldest factor from {formatDate(caFactor.asOf, year)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function GainCard({ view }: { view: DashboardView }) {
  const g = view.gains;
  return (
    <Card title="Gain">
      <Line label="Total gain" strong>
        <Money value={g.totalReturnEur} sign colored style={styles.strong} />
      </Line>
      <Line label="Realized">
        <Money value={g.realizedEur} sign />
      </Line>
      <Line label="Unrealized">
        <Money value={g.unrealizedEur} sign />
        <Pct value={view.unrealizedPct} sign style={styles.muted} />
      </Line>
      <Line label="Income">
        <Money value={g.incomeNetEur} sign />
      </Line>
      <Line label="Other costs">
        <Money value={g.otherCostsEur.neg()} sign />
      </Line>
      <View style={styles.divider} />
      <Line label="Net invested">
        <Money value={view.netInvestedEur} />
      </Line>
    </Card>
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
      <Pct value={f.displayRate} sign colored style={styles.figure} />
      {f.annualized ? (
        <Text style={styles.small}>a year</Text>
      ) : (
        <Text style={styles.small}>not annualized</Text>
      )}
    </>
  );
}

function TwrValue({ f }: { f: TwrFigure }) {
  if (!f.ok) return <Failed why={f.reason} />;
  return (
    <>
      <Pct value={f.cumulative} sign colored style={styles.figure} />
      {f.annualized ? (
        <Text style={styles.small}>
          <Pct value={f.annualized} sign style={styles.small} /> a year
        </Text>
      ) : (
        <Text style={styles.small}>cumulative</Text>
      )}
    </>
  );
}

function Failed({ why }: { why: string }) {
  return (
    <>
      <Text style={styles.figure}>—</Text>
      <Text style={styles.small}>{reason(why)}</Text>
    </>
  );
}

export function ReturnsCard({ returns }: { returns: readonly PeriodReturn[] }) {
  const [period, setPeriod] = useState<ReturnPeriod>('sinceStart');
  const r = returns.find((x) => x.period === period);
  return (
    <Card title="Returns">
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      {r ? (
        <>
          <View style={styles.columns}>
            <View style={styles.column}>
              <Text style={styles.caption}>XIRR</Text>
              <XirrValue f={r.xirr} />
            </View>
            <View style={styles.column}>
              <Text style={styles.caption}>TWR</Text>
              <TwrValue f={r.twr} />
            </View>
          </View>
          {r.fromStart && period !== 'sinceStart' ? (
            <Text style={styles.small}>The portfolio started inside this period: since start.</Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export function ChartCard({ view }: { view: DashboardView }) {
  const [range, setRange] = useState<SeriesRange>('1Y');
  const s = view.series[range];
  return (
    <Card title="Value and net invested">
      <Segmented
        options={SERIES_RANGES.map((r) => ({ value: r, label: r }))}
        value={range}
        onChange={setRange}
      />
      <ValueChart points={s.chart} />
      <View style={styles.legend}>
        <Text style={[styles.small, { color: colors.value }]}>● Value</Text>
        <Text style={[styles.small, { color: colors.invested }]}>● Net invested</Text>
      </View>
      <Line label="Value change">
        <Money value={s.valueChangeEur} sign colored />
      </Line>
      <Line label="Net invested change">
        <Money value={s.netInvestedChangeEur} sign />
      </Line>
    </Card>
  );
}

const TYPE_LABELS: Record<string, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  crypto: 'Crypto',
  certificado_aforro: 'Certificados',
};

export function AllocationCard({ view }: { view: DashboardView }) {
  if (view.allocation.length === 0) return null;
  return (
    <Card title="Allocation by type">
      <View style={styles.allocation}>
        <AllocationDonut slices={view.allocation} />
        <View style={styles.allocationLegend}>
          {view.allocation.map((s) => (
            <View key={s.key} style={styles.legendRow}>
              <Text style={[styles.dot, { color: typeColor(s.key) }]}>●</Text>
              <Text style={styles.legendLabel}>{TYPE_LABELS[s.key] ?? s.key}</Text>
              <Pct value={s.weight} style={styles.legendPct} />
              <Money value={s.valueEur} style={styles.small} />
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

export function MoversCard({ view, assets }: { view: DashboardView; assets: AssetNames }) {
  const [span, setSpan] = useState<'day' | 'total'>('day');
  const [by, setBy] = useState<'eur' | 'pct'>('eur');
  const lists = view.movers[by][span];
  const row = (m: Mover) => (
    <View key={m.assetId} style={styles.mover}>
      <View style={styles.moverName}>
        <Text style={styles.ticker}>{label(assets, m.assetId)}</Text>
        <Text style={styles.small} numberOfLines={1}>
          {assets.get(m.assetId)?.name ?? ''}
        </Text>
      </View>
      <Money value={m.changeEur} sign colored />
      {m.openedToday ? (
        <Text style={[styles.small, styles.moverPct]}>new</Text>
      ) : (
        <Pct value={m.changePct} sign colored style={styles.moverPct} />
      )}
    </View>
  );
  const none = lists.up.length === 0 && lists.down.length === 0;
  return (
    <Card title="Top movers">
      <View style={styles.moverTabs}>
        <Segmented
          options={[
            { value: 'day', label: 'Day' },
            { value: 'total', label: 'Total' },
          ]}
          value={span}
          onChange={setSpan}
        />
        <Segmented
          options={[
            { value: 'eur', label: '€' },
            { value: 'pct', label: '%' },
          ]}
          value={by}
          onChange={setBy}
        />
      </View>
      {none ? <Text style={styles.muted}>No changes to show.</Text> : null}
      {lists.up.map(row)}
      {lists.up.length > 0 && lists.down.length > 0 ? <View style={styles.divider} /> : null}
      {lists.down.map(row)}
    </Card>
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

const styles = StyleSheet.create({
  caption: { fontSize: 13, color: colors.muted },
  total: { fontSize: 32, fontWeight: '700', color: colors.text, marginVertical: space.xs },
  dayChange: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  dayText: { fontSize: 16, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13 },
  small: { color: colors.muted, fontSize: 12 },
  strong: { fontWeight: '700', fontSize: 16, color: colors.text },
  notes: { marginTop: space.sm },
  noteList: { marginTop: space.xs, gap: 2 },
  warning: { color: colors.warningText, fontSize: 13, fontWeight: '600' },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  lineLabel: { color: colors.text, fontSize: 14 },
  lineValue: { flexDirection: 'row', gap: space.sm, alignItems: 'baseline' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: space.sm,
  },
  columns: { flexDirection: 'row' },
  column: { flex: 1 },
  figure: { fontSize: 22, fontWeight: '700', color: colors.text },
  legend: { flexDirection: 'row', gap: space.lg, marginVertical: space.sm },
  allocation: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  allocationLegend: { flex: 1, gap: space.xs },
  legendRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  dot: { fontSize: 12 },
  legendLabel: { flex: 1, fontSize: 13, color: colors.text },
  legendPct: { fontSize: 13, color: colors.text, minWidth: 52, textAlign: 'right' },
  moverTabs: { flexDirection: 'row', justifyContent: 'space-between' },
  mover: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: space.sm },
  moverName: { flex: 1 },
  ticker: { fontSize: 14, fontWeight: '600', color: colors.text },
  moverPct: { minWidth: 64, textAlign: 'right', fontSize: 13 },
});
