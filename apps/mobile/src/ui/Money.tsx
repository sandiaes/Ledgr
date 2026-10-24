import type { Decimal } from '@ledgr/core';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { formatAmount, formatEur, formatPct, formatUnits } from '../format';
import { useHideValues } from '../settings/SettingsProvider';
import type { Colors } from './theme';
import { useColors } from './ThemeProvider';

/** What every amount shows while values are hidden. */
export const MASK = '••••';

const tone = (colors: Colors, value: Decimal | null) =>
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
  const colors = useColors();
  const text = hidden
    ? MASK
    : props.value === null
      ? '—'
      : formatEur(props.value, { sign: props.sign });
  const color = props.colored && !hidden ? tone(colors, props.value) : undefined;
  return (
    <Text style={[props.style, color ? { color } : null]} testID="money">
      {text}
    </Text>
  );
}

/** A price, unit cost or factor in its currency: masked like every amount. */
export function Amount(props: {
  value: Decimal | null;
  currency: string;
  /** Decimals (default 2; certificado factors use 5). */
  dp?: number;
  sign?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const [hidden] = useHideValues();
  const text = hidden
    ? MASK
    : props.value === null
      ? '—'
      : formatAmount(props.value, props.currency, { dp: props.dp, sign: props.sign });
  return (
    <Text style={props.style} testID="money">
      {text}
    </Text>
  );
}

/** A number of units (shares, coins, certificado units): masked like every amount. */
export function Units(props: { value: Decimal | null; style?: StyleProp<TextStyle> }) {
  const [hidden] = useHideValues();
  const text = hidden ? MASK : props.value === null ? '—' : formatUnits(props.value);
  return (
    <Text style={props.style} testID="units">
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
  const colors = useColors();
  const color = props.colored ? tone(colors, props.value) : undefined;
  return (
    <Text style={[props.style, color ? { color } : null]}>
      {formatPct(props.value, { sign: props.sign })}
    </Text>
  );
}
