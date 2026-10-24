import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { T } from './T';
import { radius, space, type Colors } from './theme';
import { useStyles } from './ThemeProvider';
import { useReduceMotion } from './useReduceMotion';

/** The selection slides to the new segment in this long (docs/design.md §4). */
const SLIDE_MS = 160;
/** The track's padding, which the sliding highlight stays inside. */
const PADDING = 2;

/**
 * Mutually exclusive options in a pill track (ranges, periods, views, Appearance): the
 * selected segment is tinted `accentSoft` with a bold label, 36 dp tall with a 48 dp touch
 * area, equal widths (docs/design.md §6.7). The tint slides to a newly chosen segment, or
 * jumps with "Remove animations" on; until the track has been measured the selected segment
 * carries the tint itself.
 */
export function SegmentedControl<V extends string>(props: {
  options: readonly { value: NoInfer<V>; label: string; accessibilityLabel?: string }[];
  value: V;
  onChange(value: NoInfer<V>): void;
  accessibilityLabel?: string;
  /** No space below it (in a section's title row). */
  compact?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  const count = props.options.length;
  const index = Math.max(
    0,
    props.options.findIndex((o) => o.value === props.value),
  );
  const slot = count > 0 ? (width - 2 * PADDING) / count : 0;
  const position = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    if (reduceMotion || width === 0) {
      position.setValue(index);
      return;
    }
    const slide = Animated.timing(position, {
      toValue: index,
      duration: SLIDE_MS,
      useNativeDriver: true,
    });
    slide.start();
    return () => slide.stop();
  }, [index, width, reduceMotion, position]);

  const measured = width > 0 && slot > 0;
  return (
    <View
      style={[styles.track, props.compact && styles.compact]}
      accessibilityRole="tablist"
      accessibilityLabel={props.accessibilityLabel}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      {measured ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.highlight,
            {
              width: slot,
              transform: [{ translateX: Animated.multiply(position, slot) }],
            },
          ]}
        />
      ) : null}
      {props.options.map((o) => {
        const selected = o.value === props.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => props.onChange(o.value)}
            hitSlop={{ top: 6, bottom: 6 }}
            style={[styles.segment, selected && !measured && styles.selected]}
            accessibilityRole="tab"
            accessibilityLabel={o.accessibilityLabel}
            accessibilityState={{ selected }}
          >
            <T variant="sub" tone={selected ? 'text' : 'muted'} style={selected && styles.bold}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      backgroundColor: colors.pressed,
      borderRadius: radius.pill,
      padding: PADDING,
      marginBottom: space.sm,
    },
    segment: {
      flex: 1,
      height: 32,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.sm,
    },
    highlight: {
      position: 'absolute',
      top: PADDING,
      bottom: PADDING,
      left: PADDING,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    compact: { marginBottom: 0 },
    selected: { backgroundColor: colors.accentSoft },
    bold: { fontWeight: '600' },
  });
