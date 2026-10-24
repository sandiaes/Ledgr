import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, type DimensionValue } from 'react-native';
import { radius as radii, space, type Colors } from './theme';
import { useStyles } from './ThemeProvider';
import { useReduceMotion } from './useReduceMotion';

/**
 * A block standing in for content while it loads: `pressed` pulsing to `skeleton` (an
 * opacity loop on the native driver; still when "Remove animations" is on). Screen
 * skeletons mirror the final layout, so content swaps in without a shift.
 */
export function Skeleton(props: {
  width?: DimensionValue;
  height: number;
  radius?: number;
  testID?: string;
}) {
  const styles = useStyles(makeStyles);
  const reduce = useReduceMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  const box = {
    width: props.width ?? '100%',
    height: props.height,
    borderRadius: props.radius ?? radii.sm,
  } as const;
  return (
    <View
      style={[styles.base, box]}
      testID={props.testID ?? 'skeleton'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.highlight, { opacity: pulse }]} />
    </View>
  );
}

/** `n` list rows: a title and a subtitle on the left, a figure on the right. */
export function SkeletonRows({ n = 6 }: { n?: number }) {
  return (
    <View testID="skeleton-rows">
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={rowStyle}>
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width="40%" height={16} />
            <Skeleton width="60%" height={12} />
          </View>
          <Skeleton width={72} height={16} />
        </View>
      ))}
    </View>
  );
}

/** A chart-sized block with a range control under it. */
export function SkeletonChart({ height = 180 }: { height?: number }) {
  return (
    <View testID="skeleton-chart" style={{ gap: space.md }}>
      <Skeleton height={height} radius={radii.md} />
      <Skeleton height={32} radius={radii.pill} />
    </View>
  );
}

const rowStyle = {
  minHeight: 56,
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: space.md,
  gap: space.md,
} as const;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    base: { backgroundColor: colors.pressed, overflow: 'hidden' },
    highlight: { backgroundColor: colors.skeleton },
  });
