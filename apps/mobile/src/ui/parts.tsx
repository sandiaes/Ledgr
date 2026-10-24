import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch as RNSwitch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type SwitchProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { space, type Colors } from './theme';
import { useColors, useKeyboardAppearance, useStyles } from './ThemeProvider';

// The restyled controls (docs/design.md §6.7, §6.8) under their old names, so the screens
// U2 and U3 have not touched yet get them too.
export { Chip } from './Chip';
export { SegmentedControl as Segmented } from './SegmentedControl';

export function Card(props: {
  title?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.card, props.style]} testID={props.testID}>
      {props.title ? <Text style={styles.title}>{props.title}</Text> : null}
      {props.children}
    </View>
  );
}

/** A label on the left, figures on the right. */
export function Line(props: { label: string; children: ReactNode; strong?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, props.strong && styles.lineStrong]}>{props.label}</Text>
      <View style={styles.lineFigures}>{props.children}</View>
    </View>
  );
}

export function Banner(props: { tone: 'warning' | 'error'; children: ReactNode }) {
  const styles = useStyles(makeStyles);
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
  const styles = useStyles(makeStyles);
  const colors = useColors();
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
        <ActivityIndicator
          color={plain ? colors.accent : props.kind === 'danger' ? colors.onLoss : colors.onAccent}
          accessibilityLabel="Saving"
        />
      ) : (
        <Text
          style={[
            styles.buttonText,
            plain && styles.buttonTextPlain,
            props.kind === 'danger' && styles.buttonTextDanger,
          ]}
        >
          {props.label}
        </Text>
      )}
    </Pressable>
  );
}

/** A labeled text input with an optional hint and an inline error. */
export function Field(
  props: TextInputProps & { label: string; hint?: string; error?: ReactNode; testID?: string },
) {
  const styles = useStyles(makeStyles);
  const { label, hint, error, style, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Input
        accessibilityLabel={label}
        autoCorrect={false}
        style={[error ? styles.inputError : null, style]}
        {...input}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}

/** A text input in the theme's input colours, with the matching keyboard. */
export function Input(props: TextInputProps) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const keyboard = useKeyboardAppearance();
  return (
    <TextInput
      placeholderTextColor={colors.input.placeholder}
      keyboardAppearance={keyboard}
      selectionColor={colors.accent}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

/** A Switch in the theme's track and thumb colours. */
export function Switch(props: SwitchProps) {
  const { switch: sw } = useColors();
  return (
    <RNSwitch
      trackColor={{ false: sw.trackOff, true: sw.trackOn }}
      thumbColor={props.value ? sw.thumbOn : sw.thumbOff}
      {...props}
    />
  );
}

export function FieldError(props: { children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <Text style={styles.error} accessibilityRole="alert">
      {props.children}
    </Text>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: space.lg,
      marginHorizontal: space.lg,
      marginBottom: space.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    title: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: space.sm },
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
    buttonText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
    buttonTextPlain: { color: colors.accent },
    buttonTextDanger: { color: colors.onLoss },
    buttonDanger: { backgroundColor: colors.loss },
    disabled: { opacity: 0.5 },
    field: { marginBottom: space.md },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
    input: {
      borderWidth: 1,
      borderColor: colors.input.border,
      borderRadius: 8,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      fontSize: 16,
      color: colors.input.text,
      backgroundColor: colors.input.background,
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
