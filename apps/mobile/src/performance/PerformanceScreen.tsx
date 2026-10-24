import { buildPerformance, type CalendarReturn, type PerformanceView } from '@ledgr/core';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePortfolio } from '../data/usePortfolio';
import { formatPeriod } from '../format';
import { Badge } from '../positions/PositionRowView';
import { Amount } from '../ui/Amount';
import { ChartFrame } from '../ui/ChartFrame';
import { EmptyState } from '../ui/EmptyState';
import { FigureLine } from '../ui/FigureLine';
import { ListRow } from '../ui/ListRow';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { Section } from '../ui/Section';
import { SegmentedControl } from '../ui/SegmentedControl';
import { SkeletonChart, SkeletonRows } from '../ui/Skeleton';
import { T } from '../ui/T';
import { space } from '../ui/theme';
import {
  ContributionsChart,
  ContributionsLegend,
  contributionsChartHeight,
} from './ContributionsChart';

type Unit = 'month' | 'year';

/** Monthly and yearly returns, contributions vs market gains, best / worst month (§kpis 5). */
export function PerformanceScreen() {
  const state = usePortfolio(buildPerformance);
  return (
    <PortfolioScreen
      state={state}
      what="performance"
      skeleton={
        <View style={styles.skeleton}>
          <SkeletonChart height={160} />
          <SkeletonRows n={5} />
        </View>
      }
    >
      {(view) => <Performance view={view} />}
    </PortfolioScreen>
  );
}

function Performance({ view }: { view: PerformanceView }) {
  const [unit, setUnit] = useState<Unit>('month');
  const periods = unit === 'month' ? view.months : view.years;
  if (view.months.length === 0) {
    return <EmptyState title="No transactions yet" line="Add your first one with +" />;
  }
  return (
    <>
      <Section>
        <SegmentedControl
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'year', label: 'Yearly' },
          ]}
          value={unit}
          onChange={setUnit}
        />
      </Section>
      <Section title="Contributions vs market gains">
        <ChartFrame
          height={contributionsChartHeight(periods)}
          empty={periods.length === 0}
          emptyText="No history yet"
          legend={<ContributionsLegend />}
        >
          <ContributionsChart periods={periods} />
        </ChartFrame>
      </Section>
      <Section title="Best and worst month">
        <Extreme label="Best" m={view.best} />
        <Extreme label="Worst" m={view.worst} />
        <T variant="caption" tone="faint" style={styles.note}>
          Completed months only (time-weighted return).
        </T>
      </Section>
      <Section title={unit === 'month' ? 'Monthly returns' : 'Yearly returns'}>
        {periods.map((p, i) => (
          <PeriodRow key={p.period} p={p} unit={unit} last={i === periods.length - 1} />
        ))}
      </Section>
    </>
  );
}

function Extreme({ label, m }: { label: string; m: CalendarReturn | null }) {
  return (
    <FigureLine label={m ? `${label}: ${formatPeriod(m.period)}` : label}>
      <Amount kind="pct" value={m?.return ?? null} sign tone />
    </FigureLine>
  );
}

const REASONS: Record<string, string> = {
  'snapshot-missing': 'snapshot missing',
};

/**
 * One month or year: the return on the right, the badges ("MTD" / "YTD", "approx.") by the
 * name, and contributions, market gain and income in a line under it.
 */
function PeriodRow({ p, unit, last }: { p: CalendarReturn; unit: Unit; last: boolean }) {
  const current = unit === 'month' ? 'MTD' : 'YTD';
  return (
    <ListRow
      testID="period-row"
      last={last}
      title={
        <View style={styles.title}>
          <T variant="headline">{formatPeriod(p.period)}</T>
          {p.current ? <Badge text={current} tone="muted" /> : null}
          {p.approximate ? <Badge text="approx." /> : null}
        </View>
      }
      right={
        p.return ? (
          <Amount kind="pct" value={p.return} sign tone variant="headline" />
        ) : (
          <T variant="headline">—</T>
        )
      }
      rightSub={p.return ? undefined : (REASONS[p.missing ?? ''] ?? 'cannot be computed')}
      footer={
        <T variant="caption" tone="muted">
          contrib. <Amount value={p.contributionsEur} sign />
          {' · market '}
          <Amount value={p.marketGainEur} sign tone />
          {' · income '}
          <Amount value={p.incomeEur} sign />
        </T>
      }
    />
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: space.xl },
  title: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  note: { marginTop: space.xs },
});
