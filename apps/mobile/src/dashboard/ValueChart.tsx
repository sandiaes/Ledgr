import type { Decimal, ValueSnapshot } from '@ledgr/core';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { formatDate, formatEur } from '../format';
import { useHideValues } from '../settings/SettingsProvider';
import { MASK } from '../ui/Money';
import { colors, space } from '../ui/theme';

/** Decimal -> number for pixel positions only; every label is formatted from the Decimal. */
const pixels = (d: Decimal) => Number(d.toFixed(2));

/** Value (blue) and net invested (grey) for the selected range; touch to scrub. */
export function ValueChart({ points }: { points: readonly ValueSnapshot[] }) {
  const [hidden] = useHideValues();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 4 * space.lg - 8, 120);
  if (points.length < 2) {
    return <Text style={styles.empty}>Not enough history for a chart yet.</Text>;
  }
  return (
    <LineChart
      data={points.map((p) => ({ value: pixels(p.valueEur) }))}
      data2={points.map((p) => ({ value: pixels(p.netInvestedEur) }))}
      color1={colors.value}
      color2={colors.invested}
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
      xAxisColor={colors.border}
      yAxisColor="transparent"
      pointerConfig={{
        pointerStripColor: colors.muted,
        pointerColor: colors.value,
        pointerLabelWidth: 150,
        pointerLabelHeight: 60,
        autoAdjustPointerLabelPosition: true,
        pointerLabelComponent: (_items: unknown, _secondary: unknown, index: number) => {
          const p = points[index];
          if (!p) return null;
          return (
            <View style={styles.label}>
              <Text style={styles.labelDate}>{formatDate(p.date)}</Text>
              <Text style={styles.labelValue}>{hidden ? MASK : formatEur(p.valueEur)}</Text>
              <Text style={styles.labelInvested}>
                invested {hidden ? MASK : formatEur(p.netInvestedEur)}
              </Text>
            </View>
          );
        },
      }}
    />
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, paddingVertical: space.lg },
  label: {
    backgroundColor: colors.card,
    borderRadius: 6,
    padding: space.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  labelDate: { fontSize: 11, color: colors.muted },
  labelValue: { fontSize: 13, fontWeight: '600', color: colors.value },
  labelInvested: { fontSize: 11, color: colors.muted },
});
