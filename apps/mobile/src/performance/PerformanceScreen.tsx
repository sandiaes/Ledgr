import { buildPerformance, type CalendarReturn, type PerformanceView } from '@ledgr/core';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePortfolio } from '../data/usePortfolio';
import { formatPeriod } from '../format';
import { Badge } from '../positions/PositionRowView';
import { Money, Pct } from '../ui/Money';
import { Card, Line, Segmented } from '../ui/parts';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import { ContributionsChart } from './ContributionsChart';

type Unit = 'month' | 'year';

/** Monthly and yearly returns, contributions vs market gains, best / worst month (§kpis 5). */
export function PerformanceScreen() {
  const state = usePortfolio(buildPerformance);
  return (
    <PortfolioScreen state={state} what="performance">
      {(view) => <Performance view={view} />}
    </PortfolioScreen>
  );
}

function Performance({ view }: { view: PerformanceView }) {
  const styles = useStyles(makeStyles);
  const [unit, setUnit] = useState<Unit>('month');
  const periods = unit === 'month' ? view.months : view.years;
  if (view.months.length === 0) {
    return (
      <Card>
        <Text style={styles.muted}>No transactions yet.</Text>
      </Card>
    );
  }
  return (
    <>
      <Card title="Best and worst month">
        <Extreme label="Best" m={view.best} />
        <Extreme label="Worst" m={view.worst} />
        <Text style={styles.note}>Completed months only (time-weighted return).</Text>
      </Card>
      <Card title="Contributions vs market gains">
        <Segmented
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'year', label: 'Yearly' },
          ]}
          value={unit}
          onChange={setUnit}
        />
        <ContributionsChart periods={periods} />
      </Card>
      <Card title={unit === 'month' ? 'Monthly returns' : 'Yearly returns'}>
        {periods.map((p) => (
          <PeriodRow key={p.period} p={p} unit={unit} />
        ))}
      </Card>
    </>
  );
}

function Extreme({ label, m }: { label: string; m: CalendarReturn | null }) {
  return (
    <Line label={m ? `${label}: ${formatPeriod(m.period)}` : label}>
      <Pct value={m?.return ?? null} sign colored />
    </Line>
  );
}

function PeriodRow({ p, unit }: { p: CalendarReturn; unit: Unit }) {
  const styles = useStyles(makeStyles);
  const current = unit === 'month' ? 'MTD' : 'YTD';
  return (
    <View style={styles.period} testID="period-row">
      <View style={styles.head}>
        <View style={styles.title}>
          <Text style={styles.name}>{formatPeriod(p.period)}</Text>
          {p.current ? <Badge text={current} tone="muted" /> : null}
          {p.approximate ? <Badge text="approx." /> : null}
        </View>
        {p.return ? (
          <Pct value={p.return} sign colored style={styles.ret} />
        ) : (
          <Text style={styles.ret}>
            —{' '}
            <Text style={styles.muted}>
              {p.missing === 'snapshot-missing' ? 'snapshot missing' : 'cannot be computed'}
            </Text>
          </Text>
        )}
      </View>
      <View style={styles.figures}>
        <Text style={styles.muted}>contrib.</Text>
        <Money value={p.contributionsEur} sign style={styles.small} />
        <Text style={styles.muted}>· market</Text>
        <Money value={p.marketGainEur} sign colored style={styles.small} />
        <Text style={styles.muted}>· income</Text>
        <Money value={p.incomeEur} sign style={styles.small} />
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    period: {
      paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    title: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    name: { fontSize: 14, fontWeight: '600', color: colors.text },
    ret: { fontSize: 14, fontWeight: '600', color: colors.text },
    figures: { flexDirection: 'row', gap: 4, alignItems: 'baseline', flexWrap: 'wrap' },
    small: { fontSize: 12, color: colors.text },
    muted: { color: colors.muted, fontSize: 12, fontWeight: '400' },
    note: { color: colors.muted, fontSize: 11, marginTop: space.xs },
  });
