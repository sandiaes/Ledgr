import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, space } from './theme';

export function Card(props: {
  title?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[styles.card, props.style]} testID={props.testID}>
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
  kind?: 'primary' | 'plain' | 'danger';
  /** Shows a spinner (and is disabled). */
  busy?: boolean;
  accessibilityLabel?: string;
}) {
  const plain = props.kind === 'plain';
  const disabled = props.disabled || props.busy;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, busy: !!props.busy }}
      style={[
        styles.button,
        plain && styles.buttonPlain,
        props.kind === 'danger' && styles.buttonDanger,
        disabled && styles.disabled,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color="#fff" accessibilityLabel="Saving" />
      ) : (
        <Text style={[styles.buttonText, plain && styles.buttonTextPlain]}>{props.label}</Text>
      )}
    </Pressable>
  );
}

/** A labeled text input with an optional hint and an inline error. */
export function Field(
  props: TextInputProps & { label: string; hint?: string; error?: ReactNode; testID?: string },
) {
  const { label, hint, error, style, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...input}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}

export function FieldError(props: { children: ReactNode }) {
  return (
    <Text style={styles.error} accessibilityRole="alert">
      {props.children}
    </Text>
  );
}

/** One selectable chip (a broker, an asset type, a filter value). */
export function Chip(props: {
  label: ReactNode;
  selected: boolean;
  onPress(): void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ selected: props.selected }}
      style={[styles.chip, styles.chipBordered, props.selected && styles.chipOn]}
    >
      {typeof props.label === 'string' ? (
        <Text style={[styles.chipText, props.selected && styles.chipTextOn]}>{props.label}</Text>
      ) : (
        props.label
      )}
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
  buttonDanger: { backgroundColor: colors.loss },
  disabled: { opacity: 0.5 },
  chipBordered: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  field: { marginBottom: space.md },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  inputError: { borderColor: colors.loss },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  error: { fontSize: 13, color: colors.loss, marginTop: 4 },
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
