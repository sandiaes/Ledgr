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

/**
 * A small non-interactive tag ("stale", "price pending", "approx.", "month only"): quiet by
 * default; `danger` (a certificado factor over 35 days old) and `warning` tint it.
 */
export function Badge(props: { label: string; tone?: 'muted' | 'warning' | 'danger' }) {
  const styles = useStyles(makeStyles);
  const tone = props.tone ?? 'muted';
  return (
    <View
      style={[
        styles.badge,
        tone === 'warning' && styles.warning,
        tone === 'danger' && styles.danger,
      ]}
    >
      <T
        variant="caption"
        tone={tone === 'muted' ? 'muted' : tone === 'danger' ? 'loss' : 'warning'}
      >
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
    warning: { backgroundColor: colors.warningBg },
    danger: { backgroundColor: colors.lossSoft },
  });
