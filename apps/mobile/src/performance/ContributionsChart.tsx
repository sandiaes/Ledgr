import type { CalendarReturn, Decimal } from '@ledgr/core';
import { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { formatPeriod } from '../format';
import { T } from '../ui/T';
import { space, type as textStyles, type Colors } from '../ui/theme';
import { useColors, useStyles } from '../ui/ThemeProvider';

/** Decimal -> number for bar heights only; no amount is drawn (axes hidden). */
const pixels = (d: Decimal | null) => (d ? Number(d.toFixed(2)) : 0);

/** The plot above the zero line, in dp; four rules divide it. */
const PLOT = 128;
const SECTIONS = 4;
/** One rule's height: the room a loss gets below the zero line when there is one. */
const STEP = PLOT / SECTIONS;
/** The x labels under the zero line (and under the losses). */
const LABELS = 32;
/** A pair of bars: bar, 2 dp, bar, then the gap to the next pair; wide enough for "Oct 2026". */
const BAR = 12;
const PAIR_GAP = 24;

const hasLoss = (periods: readonly CalendarReturn[]) =>
  periods.some(
    (p) => (p.contributionsEur?.isNegative() ?? false) || (p.marketGainEur?.isNegative() ?? false),
  );

/** The height a chart of these periods needs: give it to `ChartFrame`. */
export const contributionsChartHeight = (periods: readonly CalendarReturn[]) =>
  PLOT + LABELS + (hasLoss(periods) ? STEP : 0);

/**
 * Contributions (grey) and market gain (green / red) per month or year, oldest first, one
 * pair of bars per period with its label under it and four faint rules. Scrolls sideways,
 * starting at the newest period. No amount is drawn, so nothing needs masking.
 */
export function ContributionsChart({ periods }: { periods: readonly CalendarReturn[] }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const labelStyle = useMemo(() => ({ ...textStyles.caption, color: colors.faint }), [colors]);
  const data = useMemo(
    () =>
      [...periods].reverse().flatMap((p) => [
        {
          value: pixels(p.contributionsEur),
          frontColor: colors.contributions,
          spacing: 2,
          label: formatPeriod(p.period),
          labelWidth: BAR * 2 + PAIR_GAP,
          labelTextStyle: labelStyle,
        },
        {
          value: pixels(p.marketGainEur),
          frontColor: p.marketGainEur?.isNegative() ? colors.loss : colors.gain,
        },
      ]),
    [periods, colors, labelStyle],
  );
  const negative = useMemo(() => hasLoss(periods), [periods]);
  return (
    <BarChart
      data={data}
      barWidth={BAR}
      spacing={PAIR_GAP}
      width={Math.max(width - 2 * space.lg, 120)}
      height={PLOT}
      noOfSections={SECTIONS}
      noOfSectionsBelowXAxis={negative ? 1 : 0}
      hideYAxisText
      yAxisLabelWidth={0}
      yAxisThickness={0}
      rulesColor={colors.chart.axis}
      rulesType="dashed"
      dashWidth={4}
      dashGap={4}
      xAxisColor={colors.faint}
      xAxisThickness={1}
      scrollToEnd
      initialSpacing={space.sm}
      endSpacing={space.sm}
    />
  );
}

/** What the bars mean: grey contributions, green market gain, red market loss. */
export function ContributionsLegend() {
  const styles = useStyles(makeStyles);
  const items = [
    { label: 'Contributions', style: styles.contributions },
    { label: 'Market gain', style: styles.gain },
    { label: 'Market loss', style: styles.loss },
  ];
  return (
    <>
      {items.map((i) => (
        <View key={i.label} style={styles.item}>
          <View style={[styles.swatch, i.style]} />
          <T variant="caption" tone="muted">
            {i.label}
          </T>
        </View>
      ))}
    </>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    item: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    swatch: { width: 10, height: 10, borderRadius: 2 },
    contributions: { backgroundColor: colors.contributions },
    gain: { backgroundColor: colors.gain },
    loss: { backgroundColor: colors.loss },
  });
