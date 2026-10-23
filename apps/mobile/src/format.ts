// Display only: rounding half-up to cents and to 2 decimals of a percent with
// Decimal.toFixed (docs/kpis.md §0). No arithmetic on the figures themselves.
import { Decimal, type IsoDate } from '@ledgr/core';

const MINUS = '−';
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function signed(text: string, negative: boolean, isZero: boolean, showPlus: boolean) {
  if (isZero) return text;
  return negative ? `${MINUS}${text}` : showPlus ? `+${text}` : text;
}

/** €1,234.56; with `sign`, +€1.00 / −€1.00. */
export function formatEur(value: Decimal, opts: { sign?: boolean } = {}): string {
  const [int = '0', frac = '00'] = value.abs().toFixed(2, Decimal.ROUND_HALF_UP).split('.');
  const zero = /^0$/.test(int) && /^0+$/.test(frac);
  return signed(`€${group(int)}.${frac}`, value.isNegative(), zero, opts.sign ?? false);
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

/** A timestamp as local HH:MM. */
export function formatTime(ms: number): string {
  const t = new Date(ms);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}
