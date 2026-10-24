import type { AllocationSlice, Decimal } from '@ledgr/core';
import { useMemo, type ReactNode } from 'react';
import { PieChart } from 'react-native-gifted-charts';
import { useColors } from '../ui/ThemeProvider';

/** Decimal -> number for the arc sizes only. */
const pixels = (d: Decimal) => Number(d.toFixed(2));

/**
 * The donut: one arc per slice in the colour `colorOf` gives it (chart palette tokens), a
 * ground-coloured gap between arcs so neighbouring hues stay apart in dark mode. A larger
 * `radius` with a close `innerRadius` is a thinner ring; `center` goes in the hole.
 */
export function AllocationDonut(props: {
  slices: readonly AllocationSlice[];
  colorOf: (key: string, index: number) => string;
  radius?: number;
  innerRadius?: number;
  center?: ReactNode;
}) {
  const colors = useColors();
  const { colorOf, slices, center } = props;
  const data = useMemo(
    () => slices.map((s, i) => ({ value: pixels(s.valueEur), color: colorOf(s.key, i) })),
    [slices, colorOf],
  );
  return (
    <PieChart
      donut
      radius={props.radius ?? 64}
      innerRadius={props.innerRadius ?? 44}
      innerCircleColor={colors.background}
      backgroundColor={colors.background}
      strokeColor={colors.background}
      strokeWidth={2}
      centerLabelComponent={center ? () => center : undefined}
      data={data}
    />
  );
}
