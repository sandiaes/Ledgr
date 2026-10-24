import type { Decimal, ValueSnapshot } from '@ledgr/core';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { formatDate } from '../format';
import { useMaskedText } from '../ui/Amount';
import { ChartTooltip } from '../ui/ChartTooltip';
import { space } from '../ui/theme';
import { useColors } from '../ui/ThemeProvider';

/** Decimal -> number for pixel positions only; every label is formatted from the Decimal. */
const pixels = (d: Decimal) => Number(d.toFixed(2));

export const CHART_HEIGHT = 180;

/**
 * Value (accent line over a faint area) and net invested (dashed grey) for the selected
 * range; touch to scrub. No axis labels or grid: a hairline baseline only (docs/design.md
 * §6.9). The tooltip is masked with the same switch as every amount.
 */
export function ValueChart({ points }: { points: readonly ValueSnapshot[] }) {
  const colors = useColors();
  const masked = useMaskedText();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 2 * space.lg, 120);
  const data = useMemo(() => points.map((p) => ({ value: pixels(p.valueEur) })), [points]);
  const data2 = useMemo(() => points.map((p) => ({ value: pixels(p.netInvestedEur) })), [points]);
  const pointerConfig = useMemo(
    () => ({
      pointerStripColor: colors.chart.pointer,
      pointerColor: colors.value,
      pointerLabelWidth: 150,
      pointerLabelHeight: 64,
      autoAdjustPointerLabelPosition: true,
      pointerLabelComponent: (_items: unknown, _secondary: unknown, index: number) => {
        const p = points[index];
        if (!p) return null;
        return (
          <ChartTooltip
            date={formatDate(p.date)}
            lines={[
              { text: masked(p.valueEur), tone: 'accent', strong: true },
              { text: `invested ${masked(p.netInvestedEur)}` },
            ]}
          />
        );
      },
    }),
    [colors, points, masked],
  );
  return (
    <LineChart
      data={data}
      data2={data2}
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
      pointerConfig={pointerConfig}
    />
  );
}
