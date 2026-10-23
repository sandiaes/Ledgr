import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, space } from './theme';

export function Card(props: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.card, props.style]}>
      {props.title ? <Text style={styles.title}>{props.title}</Text> : null}
      {props.children}
    </View>
  );
}

/** A row of mutually exclusive chips (ranges, periods, tabs). */
export function Segmented<T extends string>(props: {
  options: readonly { value: NoInfer<T>; label: string }[];
  value: T;
  onChange(value: NoInfer<T>): void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {props.options.map((o) => {
        const selected = o.value === props.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => props.onChange(o.value)}
            style={[styles.chip, selected && styles.chipOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.chipText, selected && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A label on the left, figures on the right. */
export function Line(props: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, props.strong && styles.lineStrong]}>{props.label}</Text>
      <View style={styles.lineFigures}>{props.children}</View>
    </View>
  );
}

export function Banner(props: { tone: 'warning' | 'error'; children: ReactNode }) {
  return (
    <View style={[styles.banner, props.tone === 'error' ? styles.bannerError : null]}>
      <Text style={styles.bannerText}>{props.children}</Text>
    </View>
  );
}

export function Button(props: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  kind?: 'primary' | 'plain';
}) {
  const plain = props.kind === 'plain';
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      style={[styles.button, plain && styles.buttonPlain, props.disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, plain && styles.buttonTextPlain]}>{props.label}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: space.lg,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: space.sm },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.background,
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: { fontSize: 13, color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  banner: {
    backgroundColor: colors.warningBg,
    padding: space.md,
    borderRadius: 8,
    marginHorizontal: space.lg,
    marginBottom: space.md,
  },
  bannerError: { backgroundColor: colors.errorBg },
  bannerText: { color: colors.warningText, fontSize: 13 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.md,
  },
  buttonPlain: { backgroundColor: 'transparent' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  buttonTextPlain: { color: colors.accent },
  disabled: { opacity: 0.5 },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 3,
  },
  lineLabel: { color: colors.text, fontSize: 14, flexShrink: 1, marginRight: space.sm },
  lineStrong: { fontWeight: '700' },
  lineFigures: { flexDirection: 'row', gap: 4, alignItems: 'baseline', flexWrap: 'wrap' },
});
