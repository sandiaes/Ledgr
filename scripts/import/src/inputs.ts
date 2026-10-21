// Reads the input CSVs into typed records. Every non-blank row ends up either as a record
// or as a RowProblem with its reasons; nothing is dropped silently.
import type { IsoDate } from '@ledgr/core';
import {
  CsvFormatError,
  decodeBytes,
  describeDelimiter,
  detectDelimiter,
  mapHeaders,
  parseCsv,
  type ColumnSpec,
  type Delimiter,
  type Encoding,
} from './csv';
import { detectDateOrder, resolveDate, shapeDate, type DateOrder, type DateShape } from './dates';
import { detectDecimal, parseNumber, type DecimalSeparator, type Num } from './numbers';

export interface ReadOptions {
  delimiter?: Delimiter;
  decimal?: DecimalSeparator;
  dateOrder?: DateOrder;
  encoding?: Encoding;
}

/** Detected CSV settings of one file. Printed on every dry run; no financial values. */
export interface FileSettings {
  file: string;
  encoding: Encoding;
  bom: boolean;
  delimiter: string;
  decimal: DecimalSeparator | null;
  decimalReason: string;
  dateOrder: DateOrder | null;
  dateOrderReason: string;
  dateStyles: string[];
  /** Expected column -> header as found. */
  headers: Record<string, string>;
  ignoredColumns: string[];
}

export interface RowProblem {
  file: string;
  line: number;
  reasons: string[];
  cells: string[];
}

interface TableSpec<K extends string> {
  label: string;
  columns: readonly ColumnSpec<K>[];
  numeric: readonly K[];
  dates: readonly K[];
}

interface RawRow<K extends string> {
  line: number;
  cells: string[];
  get: (key: K) => string;
}

interface Table<K extends string> {
  settings: FileSettings;
  rows: RawRow<K>[];
  blankLines: number[];
  /** Rows that cannot be read at all (e.g. more cells than the header). */
  problems: RowProblem[];
  number: (row: RawRow<K>, key: K) => Num | null;
  date: (row: RawRow<K>, key: K) => { month: IsoDate; dayNotFirst: boolean } | null;
}

/** Thrown for problems with a whole file (format, header); rows get RowProblems instead. */
export { CsvFormatError };

function readTable<K extends string>(
  bytes: Uint8Array,
  spec: TableSpec<K>,
  opts: ReadOptions,
): Table<K> {
  const decoded = decodeBytes(bytes, opts.encoding);
  const text = decoded.text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text, spec.columns, spec.label, opts.delimiter);
  const [header, ...records] = parseCsv(text, delimiter);
  if (!header) throw new CsvFormatError(`${spec.label}: the file is empty`);
  const map = mapHeaders(header.cells, spec.columns, spec.label);

  const rows: RawRow<K>[] = [];
  const blankLines: number[] = [];
  const problems: RowProblem[] = [];
  for (const rec of records) {
    if (rec.cells.every((c) => c.trim() === '')) {
      blankLines.push(rec.line);
      continue;
    }
    if (rec.cells.slice(header.cells.length).some((c) => c.trim() !== '')) {
      problems.push({
        file: spec.label,
        line: rec.line,
        reasons: ['more cells than the header'],
        cells: rec.cells,
      });
      continue;
    }
    rows.push({
      line: rec.line,
      cells: rec.cells,
      get: (k) => (rec.cells[map.index[k]] ?? '').trim(),
    });
  }

  const label = (row: RawRow<K>, key: K) => `line ${row.line}, column "${map.found[key]}"`;
  const numberCells = rows.flatMap((r) =>
    spec.numeric.map((k) => ({ raw: r.get(k), where: label(r, k) })),
  );
  const decimal = detectDecimal(numberCells, spec.label, opts.decimal);

  const shapes = new Map<string, DateShape>();
  const styles = new Set<string>();
  for (const r of rows) {
    for (const k of spec.dates) {
      try {
        const s = shapeDate(r.get(k));
        if (s) {
          shapes.set(`${r.line}:${k}`, s);
          styles.add(
            s.kind === 'numeric' ? 'day/month/year' : s.kind === 'iso' ? 'ISO' : 'month name',
          );
        }
      } catch {
        // reported per row below
      }
    }
  }
  const order = detectDateOrder(
    rows.flatMap((r) =>
      spec.dates.flatMap((k) => {
        const s = shapes.get(`${r.line}:${k}`);
        return s ? [{ shape: s, where: label(r, k) }] : [];
      }),
    ),
    spec.label,
    opts.dateOrder,
  );

  return {
    settings: {
      file: spec.label,
      encoding: decoded.encoding,
      bom: decoded.bom,
      delimiter: describeDelimiter(delimiter),
      decimal: decimal.decimal,
      decimalReason: decimal.reason,
      dateOrder: order.order,
      dateOrderReason: order.reason,
      dateStyles: [...styles].sort(),
      headers: map.found,
      ignoredColumns: map.extra,
    },
    rows,
    blankLines,
    problems,
    number: (row, key) => parseNumber(row.get(key), decimal.decimal),
    date: (row, key) => {
      const s = shapes.get(`${row.line}:${key}`) ?? shapeDate(row.get(key));
      return s ? resolveDate(s, order.order) : null;
    },
  };
}

/** Collects per-cell errors so a row reports all its problems at once. */
function cellReader<K extends string>(table: Table<K>, row: RawRow<K>, reasons: string[]) {
  const name = (k: K) => table.settings.headers[k] ?? k;
  return {
    text(k: K): string {
      const v = row.get(k);
      if (v === '') reasons.push(`${name(k)} is blank`);
      return v;
    },
    number(k: K): Num | null {
      try {
        const n = table.number(row, k);
        if (!n) reasons.push(`${name(k)} is blank`);
        return n;
      } catch (e) {
        reasons.push(`${name(k)} ${(e as Error).message}`);
        return null;
      }
    },
    date(k: K) {
      try {
        const d = table.date(row, k);
        if (!d) reasons.push(`${name(k)} is blank`);
        return d;
      } catch (e) {
        reasons.push(`${name(k)} ${(e as Error).message}`);
        return null;
      }
    },
  };
}

const TOTAL_ROW = /\b(sub)?(total|totais)\b|\bsoma\b|\bsum\b/i;

function problem(file: string, line: number, cells: string[], reasons: string[]): RowProblem {
  // A row that fails to parse and says "total" anywhere is reported as a total row.
  return {
    file,
    line,
    cells,
    reasons: cells.some((c) => TOTAL_ROW.test(c))
      ? ['looks like a total row', ...reasons]
      : reasons,
  };
}

// ---------------------------------------------------------------------------
// Transactions table
// ---------------------------------------------------------------------------

type TxKey = 'month' | 'type' | 'transactType' | 'ticker' | 'units' | 'price' | 'value' | 'broker';

export const TRANSACTIONS_COLUMNS: readonly ColumnSpec<TxKey>[] = [
  { key: 'month', label: 'Month' },
  { key: 'type', label: 'Type' },
  { key: 'transactType', label: 'Transact Type' },
  { key: 'ticker', label: 'Ticker/Type' },
  { key: 'units', label: 'Units' },
  { key: 'price', label: 'Order Price' },
  { key: 'value', label: 'Order Value' },
  { key: 'broker', label: 'Broker' },
];

/** One transactions-table row as written (Units signed as in the Excel). */
export interface TxRecord {
  line: number;
  month: IsoDate;
  dayNotFirst: boolean;
  type: string;
  transactType: string;
  /** Upper-cased. */
  ticker: string;
  units: Num;
  price: Num;
  value: Num;
  broker: string;
  cells: string[];
}

export interface Parsed<R> {
  settings: FileSettings;
  records: R[];
  blankLines: number[];
  problems: RowProblem[];
}

export function readTransactions(bytes: Uint8Array, opts: ReadOptions = {}): Parsed<TxRecord> {
  const file = 'transactions';
  const table = readTable(
    bytes,
    {
      label: file,
      columns: TRANSACTIONS_COLUMNS,
      numeric: ['units', 'price', 'value'],
      dates: ['month'],
    },
    opts,
  );
  const records: TxRecord[] = [];
  const problems = [...table.problems];
  for (const row of table.rows) {
    const reasons: string[] = [];
    const c = cellReader(table, row, reasons);
    const date = c.date('month');
    const rec = {
      type: c.text('type'),
      transactType: c.text('transactType'),
      ticker: c.text('ticker').toUpperCase(),
      units: c.number('units'),
      price: c.number('price'),
      value: c.number('value'),
      broker: c.text('broker'),
    };
    if (reasons.length > 0 || !date || !rec.units || !rec.price || !rec.value) {
      problems.push(problem(file, row.line, row.cells, reasons));
      continue;
    }
    records.push({
      ...rec,
      units: rec.units,
      price: rec.price,
      value: rec.value,
      line: row.line,
      month: date.month,
      dayNotFirst: date.dayNotFirst,
      cells: row.cells,
    });
  }
  return { settings: table.settings, records, blankLines: table.blankLines, problems };
}

// ---------------------------------------------------------------------------
// Certificados de aforro table
// ---------------------------------------------------------------------------

type CaKey = 'series' | 'date' | 'units' | 'ratio';

export const CA_COLUMNS: readonly ColumnSpec<CaKey>[] = [
  { key: 'series', label: 'Type' },
  { key: 'date', label: 'Order Date' },
  { key: 'units', label: 'Units' },
  { key: 'ratio', label: 'Ratio' },
];

export interface CaRecord {
  line: number;
  /** Upper-cased series code, e.g. 'E'. */
  series: string;
  month: IsoDate;
  dayNotFirst: boolean;
  /** Euros subscribed. */
  units: Num;
  /** The subscription's current factor. */
  ratio: Num;
  cells: string[];
}

export function readCa(bytes: Uint8Array, opts: ReadOptions = {}): Parsed<CaRecord> {
  const file = 'ca';
  const table = readTable(
    bytes,
    { label: file, columns: CA_COLUMNS, numeric: ['units', 'ratio'], dates: ['date'] },
    opts,
  );
  const records: CaRecord[] = [];
  const problems = [...table.problems];
  for (const row of table.rows) {
    const reasons: string[] = [];
    const c = cellReader(table, row, reasons);
    const series = c.text('series').toUpperCase();
    const date = c.date('date');
    const units = c.number('units');
    const ratio = c.number('ratio');
    if (reasons.length > 0 || !date || !units || !ratio) {
      problems.push(problem(file, row.line, row.cells, reasons));
      continue;
    }
    records.push({
      line: row.line,
      series,
      month: date.month,
      dayNotFirst: date.dayNotFirst,
      units,
      ratio,
      cells: row.cells,
    });
  }
  return { settings: table.settings, records, blankLines: table.blankLines, problems };
}

// ---------------------------------------------------------------------------
// Asset mapping file (one row per ticker) and the optional holdings file
// ---------------------------------------------------------------------------

type MapKey =
  | 'ticker'
  | 'assetType'
  | 'name'
  | 'isin'
  | 'exchange'
  | 'currency'
  | 'priceSymbol'
  | 'typeOverride';

export const MAPPING_COLUMNS: readonly ColumnSpec<MapKey>[] = [
  { key: 'ticker', label: 'ticker' },
  { key: 'assetType', label: 'asset_type' },
  { key: 'name', label: 'name' },
  { key: 'isin', label: 'isin' },
  { key: 'exchange', label: 'exchange' },
  { key: 'currency', label: 'currency' },
  { key: 'priceSymbol', label: 'price_symbol' },
  { key: 'typeOverride', label: 'type_override' },
];

export interface MappingRecord {
  line: number;
  ticker: string;
  assetType: string;
  name: string;
  isin: string;
  exchange: string;
  currency: string;
  priceSymbol: string;
  typeOverride: string;
}

export function readMappingFile(bytes: Uint8Array): Parsed<MappingRecord> {
  const table = readTable(
    bytes,
    { label: 'mapping', columns: MAPPING_COLUMNS, numeric: [], dates: [] },
    {},
  );
  return {
    settings: table.settings,
    records: table.rows.map((r) => ({
      line: r.line,
      ticker: r.get('ticker').toUpperCase(),
      assetType: r.get('assetType').toLowerCase(),
      name: r.get('name'),
      isin: r.get('isin').toUpperCase(),
      exchange: r.get('exchange'),
      currency: r.get('currency').toUpperCase(),
      priceSymbol: r.get('priceSymbol'),
      typeOverride: r.get('typeOverride').toLowerCase(),
    })),
    blankLines: table.blankLines,
    problems: table.problems,
  };
}

type HoldKey = 'ticker' | 'units';

export interface HoldingRecord {
  line: number;
  ticker: string;
  units: Num;
}

export function readHoldings(bytes: Uint8Array): Parsed<HoldingRecord> {
  const file = 'holdings';
  const table = readTable(
    bytes,
    {
      label: file,
      columns: [
        { key: 'ticker', label: 'ticker' },
        { key: 'units', label: 'units' },
      ] as ColumnSpec<HoldKey>[],
      numeric: ['units'],
      dates: [],
    },
    {},
  );
  const records: HoldingRecord[] = [];
  const problems = [...table.problems];
  for (const row of table.rows) {
    const reasons: string[] = [];
    const c = cellReader(table, row, reasons);
    const ticker = c.text('ticker').toUpperCase();
    const units = c.number('units');
    if (reasons.length > 0 || !units) problems.push(problem(file, row.line, row.cells, reasons));
    else records.push({ line: row.line, ticker, units });
  }
  return { settings: table.settings, records, blankLines: table.blankLines, problems };
}

/** allowed-duplicates.txt: one duplicate key per line; '#' starts a comment. */
export function readAllowedDuplicates(text: string): Set<string> {
  return new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*/, '').trim().toLowerCase())
      .filter((l) => l !== ''),
  );
}
