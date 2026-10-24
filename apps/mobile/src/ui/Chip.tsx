import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { T } from './T';
import { radius, space, type Colors } from './theme';
import { useStyles } from './ThemeProvider';

/**
 * A filter or a small toggle (€/%, asset and broker filters): an outline, `accentSoft` when
 * selected; 32 dp tall with a 48 dp touch area (docs/design.md §6.8).
 */
export function Chip(props: {
  label: ReactNode;
  selected: boolean;
  onPress(): void;
  accessibilityLabel?: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={props.onPress}
      hitSlop={{ top: 8, bottom: 8 }}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ selected: props.selected }}
      style={[styles.chip, props.selected && styles.selected]}
    >
      {typeof props.label === 'string' ? (
        <T variant="sub" tone={props.selected ? 'text' : 'muted'}>
          {props.label}
        </T>
      ) : (
        props.label
      )}
    </Pressable>
  );
}

/** A small non-interactive tag ("stale", "price pending", "approx.", "month only"). */
export function Badge(props: { label: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.badge}>
      <T variant="caption" tone="muted">
        {props.label}
      </T>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    chip: {
      minHeight: 32,
      paddingHorizontal: space.md,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selected: { backgroundColor: colors.accentSoft, borderColor: colors.accentSoft },
    badge: {
      alignSelf: 'flex-start',
      paddingHorizontal: space.sm,
      paddingVertical: 1,
      borderRadius: radius.pill,
      backgroundColor: colors.pressed,
    },
  });
