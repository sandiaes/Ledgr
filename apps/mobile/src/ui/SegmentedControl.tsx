import { Pressable, StyleSheet, View } from 'react-native';
import { T } from './T';
import { radius, space, type Colors } from './theme';
import { useStyles } from './ThemeProvider';

/**
 * Mutually exclusive options in a pill track (ranges, periods, views, Appearance): the
 * selected segment is tinted `accentSoft` with a bold label, 36 dp tall with a 48 dp touch
 * area, equal widths (docs/design.md §6.7).
 */
export function SegmentedControl<V extends string>(props: {
  options: readonly { value: NoInfer<V>; label: string }[];
  value: V;
  onChange(value: NoInfer<V>): void;
  accessibilityLabel?: string;
  /** No space below it (in a section's title row). */
  compact?: boolean;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View
      style={[styles.track, props.compact && styles.compact]}
      accessibilityRole="tablist"
      accessibilityLabel={props.accessibilityLabel}
    >
      {props.options.map((o) => {
        const selected = o.value === props.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => props.onChange(o.value)}
            hitSlop={{ top: 6, bottom: 6 }}
            style={[styles.segment, selected && styles.selected]}
            accessibilityRole="tab"
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
      padding: 2,
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
    compact: { marginBottom: 0 },
    selected: { backgroundColor: colors.accentSoft },
    bold: { fontWeight: '600' },
  });
