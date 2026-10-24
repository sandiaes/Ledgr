// Display only, in pt-PT style: `.` between thousands (from 4 digits), `,` for decimals,
// the currency after the amount (docs/design.md §6.4, decision D3). Rounding half-up with
// Decimal.toFixed (docs/kpis.md §0); never Intl and never a JS number, so Hermes' locale data
// cannot change a figure. No arithmetic on the figures themselves.
//
// Components must not import the amount formatters (formatEur, formatAmount, formatUnits,
// formatPct) directly: every amount goes through `ui/Amount.tsx`, so privacy can mask it.
// `noRawAmounts.test.ts` enforces that.
import { Decimal, type IsoDate } from '@ledgr/core';

const MINUS = '−';
/** Between an amount and its currency: never wraps onto its own line. */
const NBSP = '\u00A0';
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function signed(text: string, negative: boolean, isZero: boolean, showPlus: boolean) {
  if (isZero) return text;
  return negative ? `${MINUS}${text}` : showPlus ? `+${text}` : text;
}

/** 14.250,50 €; with `sign`, +85,10 € / −85,10 €. */
export function formatEur(value: Decimal, opts: { sign?: boolean } = {}): string {
  return formatAmount(value, 'EUR', opts);
}

/**
 * An amount in a currency with `dp` decimals (default 2): 1.234,56 €, 12,30 USD, 4,00 CHF
 * (every currency but the euro by its code). For prices, unit costs and certificado factors.
 */
export function formatAmount(
  value: Decimal,
  currency: string,
  opts: { sign?: boolean; dp?: number } = {},
): string {
  const dp = opts.dp ?? 2;
  const [int = '0', frac = ''] = value.abs().toFixed(dp, Decimal.ROUND_HALF_UP).split('.');
  const zero = /^0$/.test(int) && /^0*$/.test(frac);
  const symbol = currency === 'EUR' ? '€' : currency;
  const text = `${group(int)}${frac ? `,${frac}` : ''}${NBSP}${symbol}`;
  return signed(text, value.isNegative(), zero, opts.sign ?? false);
}

/** Units: up to 8 decimals, trailing zeros dropped (1.000 · 0,12345678 · 2,5). */
export function formatUnits(value: Decimal): string {
  const [int = '0', frac = ''] = value
    .abs()
    .toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
    .toFixed()
    .split('.');
  const text = frac ? `${group(int)},${frac}` : group(int);
  return value.isNegative() && text !== '0' ? `${MINUS}${text}` : text;
}

/** A fraction as a percent: 0.0123 -> 1,23%; null -> "—". */
export function formatPct(value: Decimal | null, opts: { sign?: boolean } = {}): string {
  if (value === null) return '—';
  const text = value.times(100).abs().toFixed(2, Decimal.ROUND_HALF_UP).replace('.', ',');
  return signed(`${text}%`, value.isNegative(), /^0,00$/.test(text), opts.sign ?? false);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 2026-10-24 -> 24/10 within `thisYear`, else 24/10/2026 (also when `thisYear` is not
 * given). Numeric order only: month names elsewhere stay English.
 */
export function formatDate(date: IsoDate, thisYear?: string): string {
  const [y = '', m = '', d = ''] = date.split('-');
  const day = `${d.padStart(2, '0')}/${m.padStart(2, '0')}`;
  return thisYear && y === thisYear ? day : `${day}/${y}`;
}

/** 2026-10 -> Oct 2026; 2026 -> 2026. */
export function formatPeriod(period: string): string {
  const [y, m] = period.split('-');
  return m ? `${MONTHS[Number(m) - 1] ?? m} ${y}` : (y ?? period);
}

/** A timestamp as local HH:MM (24 hours). */
export function formatTime(ms: number): string {
  const t = new Date(ms);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/** A timestamp as local "23/10 05:25" (with the year when it is not `thisYear`). */
export function formatDateTime(ms: number, thisYear?: string): string {
  const t = new Date(ms);
  const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return `${formatDate(day, thisYear)} ${formatTime(ms)}`;
}

/** Decimals of a unit price: 6 under 1 € so a cheap coin's price is not rounded away, else 2. */
export const unitPriceDp = (price: Decimal): number => (price.lt(1) ? 6 : 2);
