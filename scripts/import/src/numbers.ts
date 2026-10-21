// Number cells as Excel exports them: dot or comma decimals, thousands separators (dot,
// comma, space, non-breaking space), -x or (x) negatives, a euro sign or "EUR".
// The decimal separator is decided once per file from the data, never guessed per cell.
import { Decimal } from '@ledgr/core';

export type DecimalSeparator = '.' | ',';

export class NumberFormatError extends Error {
  override name = 'NumberFormatError';
}

/** A parsed number and how many decimals it was written with (for rounding tolerances). */
export interface Num {
  value: Decimal;
  decimals: number;
}

interface Shape {
  negative: boolean;
  /** Digits, separators and single spaces only (sign, parentheses, euro sign removed). */
  text: string;
  /** `text` without spaces. */
  body: string;
}

/** Strips sign, parentheses and the euro sign; null for a blank cell. */
function shape(raw: string): Shape | null {
  let s = raw.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  if (s === '') return null;
  if (/[$£¥]|USD|GBP/i.test(s)) {
    throw new NumberFormatError('has a non-euro currency symbol');
  }
  s = s.replace(/€|\bEUR\b/gi, '').trim();
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = (paren[1] as string).trim();
  }
  const sign = /^([+\-\u2212]) ?(.*)$/.exec(s);
  if (sign) {
    if (negative) throw new NumberFormatError('has both parentheses and a sign');
    negative = sign[1] !== '+';
    s = sign[2] as string;
  }
  const body = s.replace(/ /g, '');
  if (!/^[0-9.,]+$/.test(body) || !/[0-9]/.test(body)) {
    throw new NumberFormatError('is not a number');
  }
  return { negative, text: s, body };
}

/**
 * What a cell says about the decimal separator: '.' or ',' when it can only be read one
 * way, 'ambiguous' when it could be either (e.g. "1,234"), null when it has no separator.
 */
export function decimalEvidence(raw: string): DecimalSeparator | 'ambiguous' | null {
  const s = shape(raw);
  if (!s) return null;
  const dots = count(s.body, '.');
  const commas = count(s.body, ',');
  if (dots > 0 && commas > 0) return s.body.lastIndexOf('.') > s.body.lastIndexOf(',') ? '.' : ',';
  if (dots + commas === 0) return null;
  const sep: DecimalSeparator = dots > 0 ? '.' : ',';
  const other: DecimalSeparator = sep === '.' ? ',' : '.';
  if (dots + commas > 1) return other; // repeated: a thousands separator
  const [int, frac] = s.body.split(sep) as [string, string];
  // Only "d,ddd" / "dd,ddd" / "ddd,ddd" with a non-zero lead could be a thousands group.
  if (frac.length !== 3 || int.length === 0 || int.length > 3 || int.startsWith('0')) return sep;
  return 'ambiguous';
}

/** Parses one cell with a known decimal separator. Null for a blank cell. */
export function parseNumber(raw: string, decimal: DecimalSeparator | null): Num | null {
  const s = shape(raw);
  if (!s) return null;
  if (decimal === null && /[.,]/.test(s.body)) {
    throw new NumberFormatError('needs a known decimal separator');
  }
  const thousands = decimal === ',' ? '.' : ',';
  if (decimal !== null && count(s.text, decimal) > 1) {
    throw new NumberFormatError(`has more than one "${decimal}"`);
  }
  const at = decimal === null ? -1 : s.text.indexOf(decimal);
  const intText = at === -1 ? s.text : s.text.slice(0, at);
  const frac = at === -1 ? '' : s.text.slice(at + 1);
  if (!/^[0-9]*$/.test(frac)) throw new NumberFormatError('has separators after the decimals');
  // Thousands groups (separator or space): 1-3 digits first, then exactly 3 each.
  const groups = intText.split(thousands === '.' ? /[. ]/ : /[, ]/);
  if (groups.length > 1 && !groups.every((g, i) => (i === 0 ? /^\d{1,3}$/ : /^\d{3}$/).test(g))) {
    throw new NumberFormatError('has misplaced thousands separators');
  }
  const int = groups.join('');
  if (int === '' && frac === '') throw new NumberFormatError('is not a number');
  const value = new Decimal(`${s.negative ? '-' : ''}${int || '0'}${frac ? `.${frac}` : ''}`);
  return { value, decimals: frac.length };
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

export interface DecimalDetection {
  decimal: DecimalSeparator | null;
  /** How it was decided, for the printed settings. */
  reason: string;
}

/**
 * One decimal separator for all the number cells of a file. Fails when cells disagree, or
 * when some cell is ambiguous and no cell settles it, unless `forced`.
 */
export function detectDecimal(
  cells: readonly { raw: string; where: string }[],
  fileLabel: string,
  forced?: DecimalSeparator,
): DecimalDetection {
  const seen: Record<DecimalSeparator, string | undefined> = { '.': undefined, ',': undefined };
  let ambiguous: string | undefined;
  for (const { raw, where } of cells) {
    let ev: ReturnType<typeof decimalEvidence>;
    try {
      ev = decimalEvidence(raw);
    } catch {
      continue; // reported per row later
    }
    if (ev === 'ambiguous') ambiguous ??= where;
    else if (ev) seen[ev] ??= where;
  }
  if (forced) {
    const other: DecimalSeparator = forced === '.' ? ',' : '.';
    if (seen[other]) {
      throw new NumberFormatError(
        `${fileLabel}: --decimal "${forced}" was given, but ${seen[other]} can only be read with "${other}"`,
      );
    }
    return { decimal: forced, reason: 'given with --decimal' };
  }
  if (seen['.'] && seen[',']) {
    throw new NumberFormatError(
      `${fileLabel}: mixed decimal separators: ${seen['.']} uses "." and ${seen[',']} uses ",". ` +
        'Fix the export or use --decimal.',
    );
  }
  const decimal = seen['.'] ? '.' : seen[','] ? ',' : null;
  if (decimal) return { decimal, reason: `detected from ${seen[decimal]}` };
  if (ambiguous) {
    throw new NumberFormatError(
      `${fileLabel}: cannot tell whether "." or "," is the decimal separator (e.g. ${ambiguous}). ` +
        'Use --decimal . or --decimal ,',
    );
  }
  return { decimal: null, reason: 'no decimals in the file' };
}
