import type { AllocationSlice, Decimal } from '@ledgr/core';
import { PieChart } from 'react-native-gifted-charts';
import { colors } from '../ui/theme';

/** Decimal -> number for the arc sizes only. */
const pixels = (d: Decimal) => Number(d.toFixed(2));

export const typeColor = (key: string) =>
  (colors.types as Record<string, string>)[key] ?? colors.invested;

/** Brokers, currencies, assets: by rank; past the palette, grey. */
export const rankColor = (_key: string, index: number) => colors.palette[index] ?? colors.invested;

export function AllocationDonut(props: {
  slices: readonly AllocationSlice[];
  colorOf?: (key: string, index: number) => string;
}) {
  const colorOf = props.colorOf ?? typeColor;
  return (
    <PieChart
      donut
      radius={64}
      innerRadius={40}
      data={props.slices.map((s, i) => ({ value: pixels(s.valueEur), color: colorOf(s.key, i) }))}
    />
  );
}
