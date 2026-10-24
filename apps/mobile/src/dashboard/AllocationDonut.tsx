import type { AllocationSlice, Decimal } from '@ledgr/core';
import { PieChart } from 'react-native-gifted-charts';
import { useColors } from '../ui/ThemeProvider';

/** Decimal -> number for the arc sizes only. */
const pixels = (d: Decimal) => Number(d.toFixed(2));

export function AllocationDonut(props: {
  slices: readonly AllocationSlice[];
  colorOf: (key: string, index: number) => string;
}) {
  const colors = useColors();
  const { colorOf } = props;
  return (
    <PieChart
      donut
      radius={64}
      innerRadius={44}
      innerCircleColor={colors.background}
      backgroundColor={colors.background}
      data={props.slices.map((s, i) => ({ value: pixels(s.valueEur), color: colorOf(s.key, i) }))}
    />
  );
}
