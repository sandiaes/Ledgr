import type { Decimal, ValueSnapshot } from '@ledgr/core';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { formatDate } from '../format';
import { useMaskedText } from '../ui/Amount';
import { T } from '../ui/T';
import { radius, space, type Colors } from '../ui/theme';
import { useColors, useStyles } from '../ui/ThemeProvider';

/** Decimal -> number for pixel positions only; every label is formatted from the Decimal. */
const pixels = (d: Decimal) => Number(d.toFixed(2));

export const CHART_HEIGHT = 180;

/**
 * Value (accent line over a faint area) and net invested (dashed grey) for the selected
 * range; touch to scrub. No axis labels or grid: a hairline baseline only (docs/design.md
 * §6.9). The tooltip is masked with the same switch as every amount.
 */
export function ValueChart({ points }: { points: readonly ValueSnapshot[] }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const masked = useMaskedText();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 2 * space.lg, 120);
  return (
    <LineChart
      data={points.map((p) => ({ value: pixels(p.valueEur) }))}
      data2={points.map((p) => ({ value: pixels(p.netInvestedEur) }))}
      color1={colors.value}
      color2={colors.invested}
      thickness={2}
      thickness2={1.5}
      strokeDashArray2={[6, 4]}
      areaChart1
      startFillColor1={colors.valueFill.color}
      endFillColor1={colors.valueFill.color}
      startOpacity1={colors.valueFill.startOpacity}
      endOpacity1={colors.valueFill.endOpacity}
      hideDataPoints
      hideYAxisText
      yAxisLabelWidth={0}
      hideRules
      initialSpacing={0}
      endSpacing={0}
      adjustToWidth
      width={chartWidth}
      height={CHART_HEIGHT}
      xAxisColor={colors.chart.axis}
      xAxisThickness={StyleSheet.hairlineWidth}
      yAxisColor="transparent"
      pointerConfig={{
        pointerStripColor: colors.chart.pointer,
        pointerColor: colors.value,
        pointerLabelWidth: 150,
        pointerLabelHeight: 64,
        autoAdjustPointerLabelPosition: true,
        pointerLabelComponent: (_items: unknown, _secondary: unknown, index: number) => {
          const p = points[index];
          if (!p) return null;
          return (
            <View style={styles.label}>
              <T variant="caption" tone="muted">
                {formatDate(p.date)}
              </T>
              <T variant="sub" tone="accent" figure style={styles.value}>
                {masked(p.valueEur)}
              </T>
              <T variant="caption" tone="muted" figure>
                invested {masked(p.netInvestedEur)}
              </T>
            </View>
          );
        },
      }}
    />
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    label: {
      backgroundColor: colors.chart.tooltipBg,
      borderRadius: radius.sm,
      padding: space.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.chart.tooltipBorder,
    },
    value: { fontWeight: '600' },
  });
