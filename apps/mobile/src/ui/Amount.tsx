import type { Decimal } from '@ledgr/core';
import { useCallback } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { formatAmount, formatPct, formatUnits } from '../format';
import { useHideValues } from '../settings/SettingsProvider';
import { type as textStyles, type TextVariant } from './theme';
import { useColors } from './ThemeProvider';

/** What every amount, unit count and percentage shows while privacy is on. */
export const MASK = '•••••';

/** What an amount is: money in a currency (EUR by default), a number of units, or a percent. */
export interface AmountFormat {
  kind?: 'money' | 'units' | 'pct';
  /** Money only; every currency but EUR shows by its code. */
  currency?: string;
  /** Decimals of a money amount (default 2; certificado factors use 5). */
  dp?: number;
  /** Always show + for a gain (a loss always shows −). */
  sign?: boolean;
}

function format(value: Decimal | null, f: AmountFormat): string {
  if (f.kind === 'pct') return formatPct(value, { sign: f.sign });
  if (value === null) return '—';
  if (f.kind === 'units') return formatUnits(value);
  return formatAmount(value, f.currency ?? 'EUR', { dp: f.dp, sign: f.sign });
}

/**
 * The text of an amount for the few places that need a string (a chart tooltip, an
 * accessibility label): masked with the same switch as `Amount`.
 */
export function useMaskedText(): (value: Decimal | null, f?: AmountFormat) => string {
  const [hidden] = useHideValues();
  // Stable while the switch does not change, so a chart's tooltip config can be memoized.
  return useCallback((value, f = {}) => (hidden ? MASK : format(value, f)), [hidden]);
}

/**
 * Every amount, unit count and percentage on screen goes through here, so the one privacy
 * switch masks all of them (docs/design.md §6.4, decision D2). Masked, the sign and the
 * gain/loss colour are dropped too, so nothing about the figure leaks. "—" when unknown.
 */
export function Amount(
  props: AmountFormat & {
    value: Decimal | null;
    /** Green for a gain and red for a loss (never while masked). */
    tone?: boolean;
    /** A step of the type scale; left out, size and colour come from the surrounding text. */
    variant?: TextVariant;
    style?: StyleProp<TextStyle>;
    numberOfLines?: number;
    /** Caps Android font scaling (the slim header uses 1.3). */
    maxFontSizeMultiplier?: number;
  },
) {
  const [hidden] = useHideValues();
  const colors = useColors();
  const { value } = props;
  const text = hidden ? MASK : format(value, props);
  const signTone =
    props.tone && !hidden && value && !value.isZero()
      ? value.isNegative()
        ? 'loss'
        : 'gain'
      : null;
  return (
    <Text
      style={[
        // Without a variant the amount takes size and colour from the text around it.
        props.variant ? [textStyles[props.variant], { color: colors.text }] : null,
        { fontVariant: ['tabular-nums'] },
        signTone ? { color: colors[signTone] } : null,
        props.style,
      ]}
      numberOfLines={props.numberOfLines}
      maxFontSizeMultiplier={props.maxFontSizeMultiplier}
      testID={props.kind === 'units' ? 'units' : props.kind === 'pct' ? 'pct' : 'money'}
      accessibilityLabel={hidden ? 'hidden' : undefined}
    >
      {text}
    </Text>
  );
}
