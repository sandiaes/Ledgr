// Test-only helpers: the anonymized fixtures and regional-format variants of them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { csvLine, type Delimiter } from '../csv';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

export const fixtureText = (name: string) => readFileSync(`${root}fixtures/${name}`, 'utf8');
export const utf8 = (text: string) => new TextEncoder().encode(text);

/** fixtures/asset_mapping.csv with every blank filled ('-' or a test name): complete. */
export function completeMappingText(
  patch: Record<string, Partial<Record<string, string>>> = {},
): string {
  const [header, ...rows] = fixtureText('asset_mapping.csv')
    .trim()
    .split('\n')
    .map((l) => l.split(','));
  const cols = header as string[];
  const out = rows.map((r) => {
    const rec: Record<string, string> = Object.fromEntries(cols.map((c, i) => [c, r[i] ?? '']));
    for (const c of ['isin', 'exchange', 'price_symbol']) if (rec[c] === '') rec[c] = '-';
    if (rec.name === '') rec.name = `Test ${rec.ticker}`;
    return { ...rec, ...(patch[rec.ticker as string] ?? {}) };
  });
  return (
    [cols.join(','), ...out.map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n') + '\n'
  );
}

/** A fixture as header + rows of cells (the fixtures have no quoted cells). */
export function table(text: string): { header: string[]; rows: string[][] } {
  const [header, ...rows] = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(','));
  return { header: header as string[], rows };
}

/** Lines of a fixture with the given 1-based file lines replaced (null removes the line). */
export function editLines(
  text: string,
  edits: Record<number, string | null>,
  append: string[] = [],
): string {
  const lines = text.trim().split(/\r?\n/);
  const out = lines.flatMap((l, i) => {
    const e = edits[i + 1];
    return e === undefined ? [l] : e === null ? [] : [e];
  });
  return [...out, ...append].join('\n') + '\n';
}

export interface NumberStyle {
  decimal: '.' | ',';
  thousands?: string;
  parens?: boolean;
  euro?: boolean;
}

/** Writes a canonical decimal string ('-1234.5') in a regional style. */
export function formatNumber(canonical: string, style: NumberStyle): string {
  const negative = canonical.startsWith('-');
  const [int, frac] = canonical.replace('-', '').split('.') as [string, string | undefined];
  const grouped = style.thousands ? int.replace(/\B(?=(\d{3})+(?!\d))/g, style.thousands) : int;
  let s = frac === undefined ? grouped : `${grouped}${style.decimal}${frac}`;
  if (style.euro) s = `${s} €`;
  return negative ? (style.parens ? `(${s})` : `-${s}`) : s;
}

const PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const PT_ABBR = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];
const EN_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export type DateStyle =
  | 'dd/mm/yyyy'
  | 'dd-mm-yyyy'
  | 'd/m/yy'
  | 'mm/dd/yyyy'
  | 'pt-abbr'
  | 'en-abbr'
  | 'pt-full'
  | 'pt-long-day';

/** Writes an ISO date in a regional style (always on the 1st, like the spreadsheet). */
export function formatDate(iso: string, style: DateStyle): string {
  const [y, m, d] = iso.split('-') as [string, string, string];
  const mi = Number(m) - 1;
  switch (style) {
    case 'dd/mm/yyyy':
      return `${d}/${m}/${y}`;
    case 'dd-mm-yyyy':
      return `${d}-${m}-${y}`;
    case 'd/m/yy':
      return `${Number(d)}/${Number(m)}/${y.slice(2)}`;
    case 'mm/dd/yyyy':
      return `${m}/${d}/${y}`;
    case 'pt-abbr':
      return `${PT_ABBR[mi]}-${y.slice(2)}`;
    case 'en-abbr':
      return `${EN_ABBR[mi]}-${y.slice(2)}`;
    case 'pt-full':
      return `${PT[mi]} ${y}`;
    case 'pt-long-day':
      return `${Number(d)} de ${PT[mi]} de ${y}`;
  }
}

export interface VariantSpec {
  delimiter: Delimiter;
  numbers: NumberStyle;
  date: DateStyle | null;
  eol?: '\n' | '\r\n';
  bom?: boolean;
  encoding?: 'utf-8' | 'windows-1252';
  header?: (h: string) => string;
}

/** The same table written with other regional settings. */
export function variant(
  text: string,
  numericCols: string[],
  dateCols: string[],
  spec: VariantSpec,
): Uint8Array {
  const t = table(text);
  const ni = numericCols.map((c) => t.header.indexOf(c));
  const di = dateCols.map((c) => t.header.indexOf(c));
  const rows = t.rows.map((r) =>
    r.map((cell, i) =>
      ni.includes(i)
        ? formatNumber(cell, spec.numbers)
        : di.includes(i) && spec.date
          ? formatDate(cell, spec.date)
          : cell,
    ),
  );
  const header = spec.header ? t.header.map(spec.header) : t.header;
  const body =
    [header, ...rows].map((r) => csvLine(r, spec.delimiter)).join(spec.eol ?? '\n') +
    (spec.eol ?? '\n');
  const out = (spec.bom ? '\uFEFF' : '') + body;
  return spec.encoding === 'windows-1252' ? encode1252(out) : utf8(out);
}

/** Windows-1252 for the characters the tests use (ASCII, Latin-1, euro sign). */
export function encode1252(text: string): Uint8Array {
  return Uint8Array.from(
    [...text].map((ch) => {
      const c = ch.codePointAt(0) as number;
      if (c === 0x20ac) return 0x80;
      if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) return c;
      throw new Error(`no Windows-1252 byte for ${ch}`);
    }),
  );
}
