import type { Decimal, PricePoint } from '@ledgr/core';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { formatDate } from '../format';
import { useMaskedText } from '../ui/Amount';
import { ChartTooltip } from '../ui/ChartTooltip';
import { space } from '../ui/theme';
import { useColors } from '../ui/ThemeProvider';

/** Decimal -> number for pixel positions only; every label is formatted from the Decimal. */
const pixels = (d: Decimal) => Number(d.toPrecision(12));

export const PRICE_CHART_HEIGHT = 180;

/**
 * One asset's closes for the selected range (at most 300 points, thinned in core): the
 * price as the accent line over a faint area, a hairline baseline, no y labels or grid
 * (docs/design.md §6.9). Touch to scrub; the tooltip is masked when values are hidden.
 */
export function PriceChart(props: { points: readonly PricePoint[]; currency: string }) {
  const colors = useColors();
  const { points, currency } = props;
  const masked = useMaskedText();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 2 * space.lg, 120);
  const data = useMemo(() => points.map((p) => ({ value: pixels(p.close) })), [points]);
  const pointerConfig = useMemo(
    () => ({
      pointerStripColor: colors.chart.pointer,
      pointerColor: colors.value,
      pointerLabelWidth: 130,
      pointerLabelHeight: 56,
      autoAdjustPointerLabelPosition: true,
      pointerLabelComponent: (_items: unknown, _secondary: unknown, index: number) => {
        const p = points[index];
        if (!p) return null;
        return (
          <ChartTooltip
            date={formatDate(p.date)}
            lines={[{ text: masked(p.close, { currency }), tone: 'accent', strong: true }]}
          />
        );
      },
    }),
    [colors, points, currency, masked],
  );
  return (
    <LineChart
      data={data}
      color1={colors.value}
      thickness={2}
      areaChart
      startFillColor={colors.valueFill.color}
      endFillColor={colors.valueFill.color}
      startOpacity={colors.valueFill.startOpacity}
      endOpacity={colors.valueFill.endOpacity}
      hideDataPoints
      hideYAxisText
      yAxisLabelWidth={0}
      hideRules
      initialSpacing={0}
      endSpacing={0}
      adjustToWidth
      width={chartWidth}
      height={PRICE_CHART_HEIGHT}
      xAxisColor={colors.chart.axis}
      xAxisThickness={StyleSheet.hairlineWidth}
      yAxisColor="transparent"
      pointerConfig={pointerConfig}
    />
  );
}
