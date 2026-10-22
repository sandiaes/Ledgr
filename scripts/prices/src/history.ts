// Daily close history from a file you saved yourself, for listings whose provider only
// gives recent days (Alpha Vantage's free key: the latest 100). Reads:
//   * a table copied from a price-history web page and pasted into a text file
//     (tab-separated, dates like "Oct 21, 2026", numbers like "1,234.56"), or
//   * a CSV with a Date column and a Close column (comma or semicolon; ISO dates), or
//   * a price-history export with "Date" and "Price" columns and dates like 10/22/2026
//     (Investing.com style).
// "Close" is used (else "Price"), never "Adj Close" (dividend-adjusted). Slash dates are
// read as month/day or day/month only when the file itself proves which (a part above
// 12). Rows without a price (dividend or split lines, "-") are skipped and counted.
// Nothing is guessed: an unreadable date or price, or the same date twice, rejects the
// file.
import { assertIsoDate, dec, type IsoDate } from '@ledgr/core';

export class HistoryFileError extends Error {
  override name = 'HistoryFileError';
}

export interface HistoryRow {
  date: IsoDate;
  /** The close as written, normalised to a plain decimal string. */
  close: string;
}

export interface ParsedHistory {
  rows: HistoryRow[];
  /** Lines that carry no price (dividends, splits, blank prices). */
  skipped: number;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** month/day or day/month for the whole file, from slash dates where a part exceeds 12. */
function slashOrder(cells: readonly string[]): 'mdy' | 'dmy' | null {
  let mdy = false;
  let dmy = false;
  for (const c of cells) {
    const m = SLASH_DATE.exec(c.trim());
    if (!m) continue;
    if (Number(m[2]) > 12) mdy = true;
    if (Number(m[1]) > 12) dmy = true;
  }
  if (mdy && dmy)
    throw new HistoryFileError('slash dates are written both month/day and day/month');
  return mdy ? 'mdy' : dmy ? 'dmy' : null;
}

function parseDate(cell: string, line: number, order: 'mdy' | 'dmy' | null): IsoDate {
  const s = cell.trim();
  const slash = SLASH_DATE.exec(s);
  if (slash) {
    if (!order) {
      throw new HistoryFileError(
        'slash dates where no day is above 12: month/day or day/month cannot be told apart',
      );
    }
    const [month, day] = order === 'mdy' ? [slash[1], slash[2]] : [slash[2], slash[1]];
    const iso = `${slash[3]}-${(month as string).padStart(2, '0')}-${(day as string).padStart(2, '0')}`;
    try {
      assertIsoDate(iso);
    } catch {
      throw new HistoryFileError(`line ${line}: date "${s}" does not exist`);
    }
    return iso;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    assertIsoDate(s);
    return s;
  }
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec(s);
  const month = m ? MONTHS.indexOf((m[1] as string).toLowerCase()) + 1 : 0;
  if (!m || month === 0) {
    throw new HistoryFileError(
      `line ${line}: date "${s}" is not like "Oct 21, 2026", 10/21/2026 or 2026-10-21`,
    );
  }
  const iso = `${m[3]}-${String(month).padStart(2, '0')}-${(m[2] as string).padStart(2, '0')}`;
  try {
    assertIsoDate(iso);
  } catch {
    throw new HistoryFileError(`line ${line}: date "${s}" does not exist`);
  }
  return iso;
}

/** "1,234.56" / "1234.56" (or "1234,56" with decimal comma) -> "1234.56"; null for no price. */
function parsePrice(cell: string, decimalComma: boolean): string | null {
  let s = cell.trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'null') return null;
  s = decimalComma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

export function parseHistory(text: string): ParsedHistory {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l, i) => ({ text: l, line: i + 1 }))
    .filter((l) => l.text.trim() !== '');
  if (lines.length < 2) throw new HistoryFileError('the file has no data rows');
  const head = (lines[0] as { text: string }).text;
  const delimiter = head.includes('\t') ? '\t' : head.includes(';') ? ';' : ',';
  // Semicolon files come from a decimal-comma locale.
  const decimalComma = delimiter === ';';
  const split = (l: string) => splitLine(l, delimiter);
  const header = split(head).map((h) => h.toLowerCase());
  const dateCol = header.findIndex((h) => h.startsWith('date'));
  const closeAt = header.findIndex((h) => h.startsWith('close'));
  const closeCol = closeAt >= 0 ? closeAt : header.findIndex((h) => h === 'price');
  if (dateCol < 0 || closeCol < 0) {
    throw new HistoryFileError(
      'the first line must name a "Date" and a "Close" (or "Price") column',
    );
  }
  const order = slashOrder(lines.slice(1).map((l) => split(l.text)[dateCol] ?? ''));

  const rows: HistoryRow[] = [];
  const seen = new Set<IsoDate>();
  let skipped = 0;
  for (const { text: l, line } of lines.slice(1)) {
    const cells = split(l);
    const date = parseDate(cells[dateCol] ?? '', line, order);
    const close =
      cells.length > closeCol ? parsePrice(cells[closeCol] as string, decimalComma) : null;
    if (close === null || !dec(close).gt(0)) {
      skipped++;
      continue;
    }
    if (seen.has(date)) throw new HistoryFileError(`line ${line}: ${date} appears twice`);
    seen.add(date);
    rows.push({ date, close: dec(close).toString() });
  }
  if (rows.length === 0) throw new HistoryFileError('no row has a readable close');
  return { rows: rows.sort((a, b) => (a.date < b.date ? -1 : 1)), skipped };
}

/** Cells of one line; double-quoted cells may contain the delimiter ("1,072.48"). */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}
