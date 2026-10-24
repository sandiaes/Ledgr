// What the owner types into the app's forms, turned into exact decimals. Pure.
import { Decimal } from './decimal';

/** numeric(38,18): at most 20 digits before the decimal point and 18 after it. */
export const MAX_INTEGER_DIGITS = 20;
export const MAX_DECIMALS = 18;

export type DecimalInputProblem =
  /** Nothing typed. */
  | 'empty'
  /** Not a plain number: letters, exponents, a sign other than a leading minus, spaces. */
  | 'not_a_number'
  /** Both `,` and `.`, or more than one of them: thousands separators are not accepted. */
  | 'separators'
  /** More than 18 decimals (the database would round them). */
  | 'too_many_decimals'
  /** More than 20 digits before the decimal point. */
  | 'too_large';

export type ParsedDecimal =
  { ok: true; value: Decimal } | { ok: false; problem: DecimalInputProblem };

const PLAIN = /^-?(\d+([.,]\d*)?|[.,]\d+)$/;

/**
 * User text -> Decimal. `1,5` and `1.5` are both one and a half (one separator, either
 * kind, is the decimal point); `1.234,5`, `1,234.5`, `1 234`, `1e3`, `+1` and `0x10` are
 * refused rather than guessed. Leading and trailing spaces are ignored. A leading minus is
 * parsed (so the form can say "must be more than 0" instead of "not a number").
 */
export function parseDecimalInput(text: string): ParsedDecimal {
  const s = text.trim();
  if (s === '') return { ok: false, problem: 'empty' };
  const separators = s.match(/[.,]/g)?.length ?? 0;
  if (separators > 1) return { ok: false, problem: 'separators' };
  if (!PLAIN.test(s)) return { ok: false, problem: 'not_a_number' };
  const normalized = s.replace(',', '.');
  const [int = '', frac = ''] = normalized.replace('-', '').split('.');
  if (frac.length > MAX_DECIMALS) return { ok: false, problem: 'too_many_decimals' };
  if (int.replace(/^0+/, '').length > MAX_INTEGER_DIGITS)
    return { ok: false, problem: 'too_large' };
  const value = new Decimal(normalized.endsWith('.') ? normalized.slice(0, -1) : normalized);
  // "-0" is zero, not negative zero.
  return { ok: true, value: value.isZero() ? new Decimal(0) : value };
}

/**
 * The unit price stored for a trade entered as a total: total / quantity, rounded half-even
 * to 18 decimals (numeric(38,18)). 100 / 3 -> 33.333333333333333333.
 */
export function unitPriceFromTotal(total: Decimal, quantity: Decimal): Decimal {
  if (!quantity.gt(0)) throw new RangeError('quantity must be > 0');
  return total.div(quantity).toDecimalPlaces(MAX_DECIMALS, Decimal.ROUND_HALF_EVEN);
}
