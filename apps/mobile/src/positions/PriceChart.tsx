import type { Decimal, PricePoint } from '@ledgr/core';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { formatDate } from '../format';
import { useMaskedText } from '../ui/Amount';
import { space, type Colors } from '../ui/theme';
import { useColors, useStyles } from '../ui/ThemeProvider';

/** Decimal -> number for pixel positions only; every label is formatted from the Decimal. */
const pixels = (d: Decimal) => Number(d.toPrecision(12));

/** One asset's closes for the selected range; touch to scrub (the price is masked when hidden). */
export function PriceChart(props: { points: readonly PricePoint[]; currency: string }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { points, currency } = props;
  const masked = useMaskedText();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 4 * space.lg - 8, 120);
  if (points.length < 2) {
    return <Text style={styles.empty}>Not enough prices for a chart in this range.</Text>;
  }
  return (
    <LineChart
      data={points.map((p) => ({ value: pixels(p.close) }))}
      color1={colors.value}
      thickness={2}
      hideDataPoints
      hideYAxisText
      yAxisLabelWidth={0}
      hideRules
      initialSpacing={0}
      endSpacing={0}
      adjustToWidth
      width={chartWidth}
      height={180}
      xAxisColor={colors.chart.axis}
      yAxisColor="transparent"
      pointerConfig={{
        pointerStripColor: colors.chart.pointer,
        pointerColor: colors.value,
        pointerLabelWidth: 120,
        pointerLabelHeight: 44,
        autoAdjustPointerLabelPosition: true,
        pointerLabelComponent: (_items: unknown, _secondary: unknown, index: number) => {
          const p = points[index];
          if (!p) return null;
          return (
            <View style={styles.label}>
              <Text style={styles.labelDate}>{formatDate(p.date)}</Text>
              <Text style={styles.labelValue}>{masked(p.close, { currency })}</Text>
            </View>
          );
        },
      }}
    />
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    empty: { color: colors.muted, paddingVertical: space.lg },
    label: {
      backgroundColor: colors.chart.tooltipBg,
      borderRadius: 6,
      padding: space.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.chart.tooltipBorder,
    },
    labelDate: { fontSize: 11, color: colors.muted },
    labelValue: { fontSize: 13, fontWeight: '600', color: colors.value },
  });
