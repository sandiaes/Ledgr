import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch as RNSwitch,
  TextInput,
  View,
  type SwitchProps,
  type TextInputProps,
} from 'react-native';
import { T } from './T';
import { radius, space, TOUCH_TARGET, type Colors } from './theme';
import { useColors, useKeyboardAppearance, useStyles } from './ThemeProvider';

// The restyled chip (docs/design.md §6.8) is exported from here too, next to the form parts.
export { Chip } from './Chip';

/** A label on the left, figures on the right. */
export function Line(props: { label: string; children: ReactNode; strong?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.line}>
      <T variant="body" style={[styles.lineLabel, props.strong && styles.lineStrong]}>
        {props.label}
      </T>
      <View style={styles.lineFigures}>{props.children}</View>
    </View>
  );
}

export function Banner(props: { tone: 'warning' | 'error'; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.banner, props.tone === 'error' ? styles.bannerError : null]}>
      <T variant="sub" tone="warning">
        {props.children}
      </T>
    </View>
  );
}

export function Button(props: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  /** `dangerText`: a text button in the loss colour (Delete on a detail screen). */
  kind?: 'primary' | 'plain' | 'danger' | 'dangerText';
  /** Shows a spinner (and is disabled). */
  busy?: boolean;
  accessibilityLabel?: string;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const plain = props.kind === 'plain' || props.kind === 'dangerText';
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
        <T
          variant="headline"
          tone={props.kind === 'dangerText' ? 'loss' : plain ? 'accent' : 'onAccent'}
          style={props.kind === 'danger' ? styles.buttonTextDanger : undefined}
        >
          {props.label}
        </T>
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
      <T variant="sub" style={styles.fieldLabel}>
        {label}
      </T>
      <Input
        accessibilityLabel={label}
        autoCorrect={false}
        style={[error ? styles.inputError : null, style]}
        {...input}
      />
      {hint ? (
        <T variant="caption" tone="muted" style={styles.hint}>
          {hint}
        </T>
      ) : null}
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
    <T variant="sub" tone="loss" style={styles.error} accessibilityRole="alert">
      {props.children}
    </T>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    banner: {
      backgroundColor: colors.warningBg,
      padding: space.md,
      borderRadius: radius.sm,
      marginHorizontal: space.lg,
      marginBottom: space.md,
    },
    bannerError: { backgroundColor: colors.errorBg },
    button: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      minHeight: TOUCH_TARGET,
      paddingVertical: space.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.md,
    },
    buttonPlain: { backgroundColor: 'transparent' },
    buttonTextDanger: { color: colors.onLoss },
    buttonDanger: { backgroundColor: colors.loss },
    disabled: { opacity: 0.5 },
    field: { marginBottom: space.md },
    fieldLabel: { fontWeight: '600', marginBottom: space.xs },
    input: {
      borderWidth: 1,
      borderColor: colors.input.border,
      borderRadius: radius.sm,
      minHeight: TOUCH_TARGET,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      fontSize: 16,
      color: colors.input.text,
      backgroundColor: colors.input.background,
    },
    inputError: { borderColor: colors.loss },
    hint: { marginTop: space.xs },
    error: { marginTop: space.xs },
    line: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      paddingVertical: space.xs,
    },
    lineLabel: { flexShrink: 1, marginRight: space.sm },
    lineStrong: { fontWeight: '700' },
    lineFigures: { flexDirection: 'row', gap: 4, alignItems: 'baseline', flexWrap: 'wrap' },
  });
