// Display only: rounding half-up to cents and to 2 decimals of a percent with
// Decimal.toFixed (docs/kpis.md §0). No arithmetic on the figures themselves.
import { Decimal, type IsoDate } from '@ledgr/core';

const MINUS = '−';
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function signed(text: string, negative: boolean, isZero: boolean, showPlus: boolean) {
  if (isZero) return text;
  return negative ? `${MINUS}${text}` : showPlus ? `+${text}` : text;
}

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

/** €1,234.56; with `sign`, +€1.00 / −€1.00. */
export function formatEur(value: Decimal, opts: { sign?: boolean } = {}): string {
  return formatAmount(value, 'EUR', opts);
}

/**
 * An amount in a currency with `dp` decimals (default 2): €1,234.56, $12.30, CHF 4.00. For
 * prices, unit costs and certificado factors.
 */
export function formatAmount(
  value: Decimal,
  currency: string,
  opts: { sign?: boolean; dp?: number } = {},
): string {
  const dp = opts.dp ?? 2;
  const [int = '0', frac = ''] = value.abs().toFixed(dp, Decimal.ROUND_HALF_UP).split('.');
  const zero = /^0$/.test(int) && /^0*$/.test(frac);
  const prefix = SYMBOLS[currency] ?? `${currency} `;
  const text = `${prefix}${group(int)}${frac ? `.${frac}` : ''}`;
  return signed(text, value.isNegative(), zero, opts.sign ?? false);
}

/** Units: up to 8 decimals, trailing zeros dropped (1,000 · 0.12345678 · 2.5). */
export function formatUnits(value: Decimal): string {
  const [int = '0', frac = ''] = value
    .abs()
    .toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
    .toFixed()
    .split('.');
  const text = frac ? `${group(int)}.${frac}` : group(int);
  return value.isNegative() && text !== '0' ? `${MINUS}${text}` : text;
}

/** A fraction as a percent: 0.0123 -> 1.23%; null -> "—". */
export function formatPct(value: Decimal | null, opts: { sign?: boolean } = {}): string {
  if (value === null) return '—';
  const text = value.times(100).abs().toFixed(2, Decimal.ROUND_HALF_UP);
  return signed(`${text}%`, value.isNegative(), /^0\.00$/.test(text), opts.sign ?? false);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-10-22 -> 22 Oct (with the year when it is not `thisYear`). */
export function formatDate(date: IsoDate, thisYear?: string): string {
  const [y, m, d] = date.split('-');
  const label = `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
  return thisYear && y !== thisYear ? `${label} ${y}` : label;
}

/** 2026-10 -> Oct 2026; 2026 -> 2026. */
export function formatPeriod(period: string): string {
  const [y, m] = period.split('-');
  return m ? `${MONTHS[Number(m) - 1] ?? m} ${y}` : (y ?? period);
}

/** A timestamp as local HH:MM. */
export function formatTime(ms: number): string {
  const t = new Date(ms);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/** A timestamp as local "23 Oct 05:25" (with the year when it is not `thisYear`). */
export function formatDateTime(ms: number, thisYear?: string): string {
  const t = new Date(ms);
  const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return `${formatDate(day, thisYear)} ${formatTime(ms)}`;
}
