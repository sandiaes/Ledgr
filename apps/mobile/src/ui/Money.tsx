import type { Decimal } from '@ledgr/core';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { formatEur, formatPct } from '../format';
import { useHideValues } from '../settings/SettingsProvider';
import { colors } from './theme';

/** What every amount shows while values are hidden. */
export const MASK = '••••';

const tone = (value: Decimal | null) =>
  !value || value.isZero() ? undefined : value.isNegative() ? colors.loss : colors.gain;

/**
 * Every amount on screen goes through here, so "hide values" masks all of them. "—" when
 * the amount is unknown.
 */
export function Money(props: {
  value: Decimal | null;
  /** +€ / −€. */
  sign?: boolean;
  /** Green / red by sign (not while hidden). */
  colored?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const [hidden] = useHideValues();
  const text = hidden
    ? MASK
    : props.value === null
      ? '—'
      : formatEur(props.value, { sign: props.sign });
  const color = props.colored && !hidden ? tone(props.value) : undefined;
  return (
    <Text style={[props.style, color ? { color } : null]} testID="money">
      {text}
    </Text>
  );
}

/** A percentage: shown even while values are hidden (it reveals no amount). */
export function Pct(props: {
  value: Decimal | null;
  sign?: boolean;
  colored?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const color = props.colored ? tone(props.value) : undefined;
  return (
    <Text style={[props.style, color ? { color } : null]}>
      {formatPct(props.value, { sign: props.sign })}
    </Text>
  );
}
