// Low-level CSV handling: bytes -> text, delimiter detection, RFC 4180 parsing, headers.

export type Encoding = 'utf-8' | 'windows-1252';
export type Delimiter = ',' | ';' | '\t';

export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t'];

export class CsvFormatError extends Error {
  override name = 'CsvFormatError';
}

export interface Decoded {
  text: string;
  encoding: Encoding;
  bom: boolean;
}

/**
 * UTF-8 with or without BOM, or Windows-1252. Without a BOM, bytes that are not valid
 * UTF-8 are read as Windows-1252 (what Excel's plain "CSV" writes on Portuguese Windows).
 */
export function decodeBytes(bytes: Uint8Array, forced?: Encoding): Decoded {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new CsvFormatError(
      'File is UTF-16 ("Unicode Text"). Save it from Excel as "CSV UTF-8" or "CSV" instead.',
    );
  }
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (bom) {
    if (forced === 'windows-1252') {
      throw new CsvFormatError(
        'File starts with a UTF-8 BOM but --encoding windows-1252 was given',
      );
    }
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8', bom };
  }
  if (forced === 'windows-1252') return { text: decodeWindows1252(bytes), encoding: forced, bom };
  if (forced)
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: forced, bom };
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'utf-8',
      bom,
    };
  } catch {
    return { text: decodeWindows1252(bytes), encoding: 'windows-1252', bom };
  }
}

// 0x80-0x9F of Windows-1252 (the rest is Latin-1). Done by hand: Node's own
// TextDecoder('windows-1252') decodes these bytes as Latin-1 control characters.
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
  0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
  0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

export function decodeWindows1252(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes)
    out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b - 0x80] as number) : b);
  return out;
}

export interface CsvRecord {
  /** 1-based physical line the record starts on (the header is line 1). */
  line: number;
  cells: string[];
}

/** RFC 4180: quoted fields, "" escapes, CRLF / LF / CR line ends, newlines inside quotes. */
export function parseCsv(text: string, delimiter: Delimiter): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    records.push({ line: recordLine, cells });
    cells = [];
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++;
        cell += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      cell += ch;
    }
    i++;
  }
  if (quoted)
    throw new CsvFormatError(`Unclosed quote in the record starting on line ${recordLine}`);
  if (cell !== '' || cells.length > 0) endRecord();
  return records;
}

/** Case-insensitive, ignoring whitespace (incl. non-breaking) and accents; strips a BOM. */
export function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s\u00a0\u202f]+/g, '');
}

export interface ColumnSpec<K extends string> {
  key: K;
  /** The header as documented, e.g. 'Transact Type'. */
  label: string;
}

export interface HeaderMap<K extends string> {
  index: Record<K, number>;
  /** Header cells as found in the file, by key. */
  found: Record<K, string>;
  extra: string[];
}

export function mapHeaders<K extends string>(
  header: readonly string[],
  spec: readonly ColumnSpec<K>[],
  fileLabel: string,
): HeaderMap<K> {
  const normalized = header.map(normalizeHeader);
  const index = {} as Record<K, number>;
  const found = {} as Record<K, string>;
  const missing: string[] = [];
  for (const col of spec) {
    const want = normalizeHeader(col.label);
    const hits = normalized.flatMap((h, i) => (h === want ? [i] : []));
    if (hits.length > 1) {
      throw new CsvFormatError(`${fileLabel}: column "${col.label}" appears ${hits.length} times`);
    }
    if (hits.length === 0) missing.push(col.label);
    else {
      index[col.key] = hits[0] as number;
      found[col.key] = (header[hits[0] as number] as string).replace(/^\uFEFF/, '');
    }
  }
  if (missing.length > 0) {
    throw new CsvFormatError(
      `${fileLabel}: missing column(s) ${missing.map((m) => `"${m}"`).join(', ')}. ` +
        `Found: ${header.map((h) => `"${h.replace(/^\uFEFF/, '')}"`).join(', ')}`,
    );
  }
  const used = new Set(Object.values(index) as number[]);
  const extra = header.filter((h, i) => !used.has(i) && h.trim() !== '');
  return { index, found, extra };
}

/**
 * The delimiter for which the first record contains every expected header. Commas,
 * semicolons and tabs are tried; `forced` skips detection but is still checked.
 */
export function detectDelimiter(
  text: string,
  spec: readonly ColumnSpec<string>[],
  fileLabel: string,
  forced?: Delimiter,
): Delimiter {
  const candidates = forced ? [forced] : DELIMITERS;
  const matching = candidates.filter((d) => {
    const first = parseCsv(firstRecordText(text), d)[0];
    if (!first) return false;
    const headers = new Set(first.cells.map(normalizeHeader));
    return spec.every((col) => headers.has(normalizeHeader(col.label)));
  });
  if (matching.length === 1) return matching[0] as Delimiter;
  if (matching.length === 0) {
    throw new CsvFormatError(
      `${fileLabel}: could not find the expected header (${spec.map((c) => c.label).join(', ')}) ` +
        (forced
          ? `with delimiter ${describeDelimiter(forced)}.`
          : 'with comma, semicolon or tab as the delimiter. Use --delimiter.'),
    );
  }
  throw new CsvFormatError(`${fileLabel}: the delimiter is ambiguous. Use --delimiter.`);
}

function firstRecordText(text: string): string {
  const end = text.search(/\r|\n/);
  return end === -1 ? text : text.slice(0, end);
}

export function describeDelimiter(d: Delimiter): string {
  return d === '\t' ? 'tab' : d === ';' ? 'semicolon' : 'comma';
}

/** One CSV line for reports: quotes cells that contain the delimiter, quotes or newlines. */
export function csvLine(cells: readonly string[], delimiter: Delimiter): string {
  return cells
    .map((c) => (c.includes(delimiter) || /["\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
    .join(delimiter);
}
