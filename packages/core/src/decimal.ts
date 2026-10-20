import DecimalJs from 'decimal.js';

/**
 * The one Decimal constructor used by @ledgr/core.
 *
 * 50 significant digits comfortably covers numeric(38,18) operands and the products and
 * quotients formed from them. Banker's rounding avoids a systematic bias when a quotient
 * has to be rounded. Plain (non-exponential) toString for anything we will realistically see.
 *
 * Instances from other decimal.js constructors are accepted as inputs.
 */
export const Decimal = DecimalJs.clone({
  precision: 50,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -50,
  toExpPos: 50,
});
export type Decimal = DecimalJs;

/** Inputs we accept at API edges. JS numbers are deliberately not allowed. */
export type DecimalInput = Decimal | string;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

export function dec(value: DecimalInput): Decimal {
  const d = new Decimal(value);
  if (!d.isFinite()) {
    throw new RangeError(`Not a finite decimal: ${String(value)}`);
  }
  return d;
}

export function sum(values: Iterable<Decimal>): Decimal {
  let total = ZERO;
  for (const v of values) total = total.plus(v);
  return total;
}

/** a / b, or null when b is zero. */
export function safeDiv(a: Decimal, b: Decimal): Decimal | null {
  return b.isZero() ? null : a.div(b);
}
