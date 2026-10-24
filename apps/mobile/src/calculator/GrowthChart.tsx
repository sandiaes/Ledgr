import type { Decimal, ProjectionRow } from '@ledgr/core';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { T } from '../ui/T';
import { space, type as typography, type Colors } from '../ui/theme';
import { useColors, useStyles } from '../ui/ThemeProvider';

/** Decimal -> number for bar heights only; no amount is drawn (axes hidden). */
const pixels = (d: Decimal) => Number(d.toFixed(2));

const label = (r: ProjectionRow) => (r.partYear ? `${r.years}y+${r.months % 12}m` : `${r.years}y`);

/**
 * Contributed and growth per year, stacked (docs/kpis.md §11.3). A bar is as tall as the
 * balance while growth is positive. With negative growth it is as tall as what was contributed:
 * the balance in the contributions colour and the loss on top. No axis labels, so nothing needs
 * masking when values are hidden.
 */
export function GrowthChart({ rows }: { rows: readonly ProjectionRow[] }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { width } = useWindowDimensions();
  if (rows.length === 0) return null;
  const stackData = rows.map((r) => ({
    label: label(r),
    labelTextStyle: styles.axis,
    stacks: r.growth.isNegative()
      ? [
          { value: pixels(r.balance), color: colors.contributions },
          { value: pixels(r.growth.neg()), color: colors.loss },
        ]
      : [
          { value: pixels(r.contributed), color: colors.contributions },
          { value: pixels(r.growth), color: colors.gain },
        ],
  }));
  return (
    <View testID="growth-chart">
      <BarChart
        stackData={stackData}
        barWidth={16}
        spacing={14}
        width={Math.max(width - 4 * space.lg - 8, 120)}
        height={180}
        hideYAxisText
        yAxisLabelWidth={0}
        hideRules
        xAxisColor={colors.chart.axis}
        yAxisColor="transparent"
        initialSpacing={4}
      />
      <View style={styles.legend}>
        <T variant="caption" style={{ color: colors.contributions }}>
          ■ Contributed
        </T>
        <T variant="caption" tone="gain">
          ■ Growth
        </T>
        <T variant="caption" tone="loss">
          ■ Loss
        </T>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    axis: { fontSize: typography.caption.fontSize, color: colors.faint },
    legend: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  });
