import type { CalendarReturn, Decimal } from '@ledgr/core';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { formatPeriod } from '../format';
import { colors, space } from '../ui/theme';

/** Decimal -> number for bar heights only; no amount is drawn (axes hidden). */
const pixels = (d: Decimal | null) => (d ? Number(d.toFixed(2)) : 0);

/**
 * Contributions (grey) and market gain (green / red) per month or year, oldest first. No
 * axis labels, so nothing needs masking when values are hidden.
 */
export function ContributionsChart({ periods }: { periods: readonly CalendarReturn[] }) {
  const { width } = useWindowDimensions();
  const rows = [...periods].reverse();
  if (rows.length === 0) return <Text style={styles.empty}>No history yet.</Text>;
  const data = rows.flatMap((p) => [
    {
      value: pixels(p.contributionsEur),
      frontColor: colors.contributions,
      spacing: 2,
      label: formatPeriod(p.period),
      labelWidth: 52,
      labelTextStyle: styles.axis,
    },
    {
      value: pixels(p.marketGainEur),
      frontColor: p.marketGainEur?.isNegative() ? colors.loss : colors.gain,
    },
  ]);
  const negative = data.some((d) => d.value < 0);
  return (
    <View>
      <BarChart
        data={data}
        barWidth={10}
        spacing={14}
        width={Math.max(width - 4 * space.lg - 8, 120)}
        height={160}
        hideYAxisText
        yAxisLabelWidth={0}
        hideRules
        xAxisColor={colors.border}
        yAxisColor="transparent"
        noOfSectionsBelowXAxis={negative ? 2 : 0}
        scrollToEnd
        initialSpacing={4}
      />
      <View style={styles.legend}>
        <Text style={[styles.small, { color: colors.contributions }]}>■ Contributions</Text>
        <Text style={[styles.small, { color: colors.gain }]}>■ Market gain</Text>
        <Text style={[styles.small, { color: colors.loss }]}>■ Market loss</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, paddingVertical: space.lg },
  axis: { fontSize: 9, color: colors.muted },
  legend: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  small: { fontSize: 12 },
});
