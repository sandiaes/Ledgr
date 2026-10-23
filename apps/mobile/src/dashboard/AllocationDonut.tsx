import type { AllocationSlice, Decimal } from '@ledgr/core';
import { PieChart } from 'react-native-gifted-charts';
import { colors } from '../ui/theme';

/** Decimal -> number for the arc sizes only. */
const pixels = (d: Decimal) => Number(d.toFixed(2));

export const typeColor = (key: string) =>
  (colors.types as Record<string, string>)[key] ?? colors.invested;

export function AllocationDonut({ slices }: { slices: readonly AllocationSlice[] }) {
  return (
    <PieChart
      donut
      radius={64}
      innerRadius={40}
      data={slices.map((s) => ({ value: pixels(s.valueEur), color: typeColor(s.key) }))}
    />
  );
}
