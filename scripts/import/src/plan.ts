// Validates every row and turns the inputs into a commit payload. Pure: no I/O.
//
// A plan with any reject (or fatal problem) must not be committed. Rows already in the
// database (same import_row_hash) are skipped, so re-running never duplicates anything.
import { Decimal, type AssetType, type IsoDate } from '@ledgr/core';
import {
  BROKERS,
  CA_UNIT_PRICE,
  FACTOR_SOURCE,
  IMPORT_SOURCE,
  ORDER_CURRENCY,
  TRANSACT_TYPES,
  TYPES,
  type TransactType,
} from './config';
import type { CommitPayload, ExistingState } from './db';
import { caSubscriptionHash, duplicateKey, rowHash, rowKey } from './hash';
import type { CaRecord, Parsed, RowProblem, TxRecord } from './inputs';
import type { AssetMapping } from './mapping';

export interface Reason {
  /** Category, counted on the console (never carries values). */
  code: string;
  /** Detail for the report file. */
  text: string;
}

export interface Reject {
  file: string;
  line: number;
  reasons: Reason[];
  cells: string[];
}

export interface Skip {
  file: string;
  line: number;
  reason: string;
}

export interface Warning {
  file: string;
  line: number | null;
  message: string;
}

/** A transactions row that passed every check (to be inserted or already imported). */
export interface PlannedRow {
  line: number;
  account: string;
  ticker: string;
  assetType: AssetType;
  transactType: TransactType;
  /** Signed as in the Excel (sells negative). */
  units: Decimal;
  price: Decimal;
  /** Order Value as in the Excel (sells negative). */
  value: Decimal;
  status: 'insert' | 'skip';
}

/** One CA subscription: a (series, month) group of transactions rows. */
export interface PlannedCa {
  series: string;
  month: IsoDate;
  account: string;
  lines: number[];
  units: Decimal;
  caLine: number | null;
  factor: Decimal | null;
  status: 'insert' | 'skip';
  factorStatus: 'insert' | 'skip' | 'none';
}

export interface FileCounts {
  read: number;
  insert: number;
  skip: number;
  reject: number;
}

export interface ImportPlan {
  /** Problems with the run as a whole (e.g. a file already imported). */
  fatal: string[];
  rejects: Reject[];
  skips: Skip[];
  warnings: Warning[];
  rows: PlannedRow[];
  ca: PlannedCa[];
  duplicates: { key: string; lines: number[]; allowed: boolean }[];
  /** Tickers missing from the mapping file, with the types the data shows. */
  missingTickers: { ticker: string; types: AssetType[] }[];
  counts: { transactions: FileCounts; ca: FileCounts | null };
  payload: CommitPayload;
}

export interface PlanInput {
  transactions: Parsed<TxRecord>;
  ca: Parsed<CaRecord> | null;
  mapping: Map<string, AssetMapping>;
  /** Mapping-file rows that could not be read at all. */
  mappingProblems?: RowProblem[];
  allowedDuplicates: ReadonlySet<string>;
  /** --ratio-month as the 1st of the month; required with a CA file. */
  ratioMonth: IsoDate | null;
  files: { transactionsSha256: string; caSha256: string | null };
  settings: Record<string, unknown>;
  state: ExistingState;
  newId: () => string;
}

const half = (decimals: number) => new Decimal(10).pow(-decimals).div(2);

export function planImport(input: PlanInput): ImportPlan {
  const { transactions: tx, ca, mapping, state } = input;
  const fatal: string[] = [];
  const warnings: Warning[] = [];
  const skips: Skip[] = [];
  const rejects = new Map<string, Reject>();
  const reject = (file: string, line: number, cells: string[], code: string, text: string) => {
    const k = `${file}:${line}`;
    const r = rejects.get(k) ?? { file, line, cells, reasons: [] };
    r.reasons.push({ code, text });
    rejects.set(k, r);
  };
  const isRejected = (file: string, line: number) => rejects.has(`${file}:${line}`);

  // --- whole-run checks -----------------------------------------------------
  for (const b of state.batches) {
    if (b.transactionsFileSha256 === input.files.transactionsSha256) {
      fatal.push(`The transactions file was already imported (batch ${b.id}, ${b.createdAt}).`);
    }
    if (input.files.caSha256 && b.caFileSha256 === input.files.caSha256) {
      fatal.push(`The CA file was already imported (batch ${b.id}, ${b.createdAt}).`);
    }
  }
  if (ca && !input.ratioMonth) fatal.push('A CA file needs --ratio-month YYYY-MM.');

  // --- unreadable and blank rows ---------------------------------------------
  for (const parsed of [tx, ca]) {
    if (!parsed) continue;
    for (const p of parsed.problems) {
      const code = p.reasons[0] === 'looks like a total row' ? 'total row' : 'unreadable row';
      for (const text of p.reasons) reject(p.file, p.line, p.cells, code, text);
    }
    for (const line of parsed.blankLines) {
      skips.push({ file: parsed.settings.file, line, reason: 'empty row' });
    }
  }
  for (const p of input.mappingProblems ?? []) {
    for (const text of p.reasons) reject('mapping', p.line, p.cells, 'mapping file', text);
  }

  // --- per-row checks --------------------------------------------------------
  const observed = new Map<string, Set<AssetType>>();
  for (const r of tx.records) {
    const t = TYPES[normalizeToken(r.type)];
    if (t) observed.set(r.ticker, (observed.get(r.ticker) ?? new Set()).add(t));
  }
  const usedTickers = new Set(tx.records.map((r) => r.ticker));
  for (const m of mapping.values()) {
    if (m.problems.length === 0) continue;
    if (usedTickers.has(m.ticker)) {
      for (const p of m.problems)
        reject('mapping', m.line, [m.ticker], 'incomplete mapping', `${m.ticker}: ${p}`);
    } else {
      warnings.push({
        file: 'mapping',
        line: m.line,
        message: `${m.ticker} is not used by any row and is incomplete`,
      });
    }
  }
  for (const m of mapping.values()) {
    if (!usedTickers.has(m.ticker)) {
      warnings.push({
        file: 'mapping',
        line: m.line,
        message: `${m.ticker} is not used by any row`,
      });
    }
  }

  interface Valid {
    r: TxRecord;
    tt: TransactType;
    account: { name: string; accountType: (typeof BROKERS)[string]['accountType'] };
    m: AssetMapping;
    assetType: AssetType;
  }
  const checked: Valid[] = [];
  let previousMonth: IsoDate | null = null;
  for (const r of tx.records) {
    const bad = (code: string, text: string) => reject('transactions', r.line, r.cells, code, text);
    if (previousMonth && r.month < previousMonth) {
      warnings.push({
        file: 'transactions',
        line: r.line,
        message: `month ${r.month.slice(0, 7)} comes after a row of ${previousMonth.slice(0, 7)} (dates decide the order; no action needed)`,
      });
    }
    previousMonth = r.month;
    if (r.dayNotFirst) {
      warnings.push({
        file: 'transactions',
        line: r.line,
        message: 'date has a day other than the 1st; imported as the 1st of its month',
      });
    }

    const rowType = TYPES[normalizeToken(r.type)];
    if (!rowType) bad('unknown type', `unknown Type "${r.type}" (known: Stocks, ETFs, Crypto, CA)`);
    const tt = r.transactType.toLowerCase() as TransactType;
    if (!TRANSACT_TYPES.includes(tt))
      bad('unknown transact type', `unknown Transact Type "${r.transactType}" (known: Buy, Sell)`);
    const account = BROKERS[normalizeToken(r.broker)];
    if (!account)
      bad(
        'unmapped broker',
        `broker "${r.broker}" is not mapped (known: ${Object.values(BROKERS)
          .map((b) => b.name)
          .join(', ')})`,
      );

    const m = mapping.get(r.ticker);
    if (!m) bad('unknown ticker', `ticker ${r.ticker} is not in the mapping file`);
    else if (m.problems.length > 0)
      bad('incomplete mapping', `the mapping row for ${r.ticker} is incomplete`);
    else if (!m.override) {
      const types = [...(observed.get(r.ticker) ?? [])].sort();
      if (types.length > 1) {
        bad(
          'type conflict',
          `ticker ${r.ticker} appears as ${types.join(' and ')}: set type_override in the mapping file`,
        );
      } else if (rowType && rowType !== m.assetType) {
        bad(
          'type conflict',
          `Type "${r.type}" does not match the mapping's asset_type ${m.assetType}: fix one or set type_override`,
        );
      }
    } else if (rowType && rowType !== m.override) {
      warnings.push({
        file: 'transactions',
        line: r.line,
        message: `imported as ${m.override} (type_override); the row says ${r.type}`,
      });
    }
    const assetType = m?.assetType ?? null;

    const units = r.units.value;
    const value = r.value.value;
    if (units.isZero()) bad('sign mismatch', 'Units is 0');
    else if (tt === 'buy' && units.isNegative()) bad('sign mismatch', 'Buy with negative Units');
    else if (tt === 'sell' && !units.isNegative())
      bad('sign mismatch', 'Sell with positive Units (sells are negative in the Excel)');
    if (tt === 'buy' && !value.gt(0))
      bad('sign mismatch', 'Buy with an Order Value that is not positive');
    if (tt === 'sell' && !value.lt(0))
      bad('sign mismatch', 'Sell with an Order Value that is not negative');
    if (!r.price.value.gt(0)) bad('price', 'Order Price must be > 0');
    else {
      // Order Value = Units x Order Price, up to the rounding of the numbers as written.
      const diff = value.minus(units.times(r.price.value)).abs();
      const tolerance = half(r.value.decimals).plus(units.abs().times(half(r.price.decimals)));
      if (diff.gt(tolerance)) {
        bad(
          'value mismatch',
          `Order Value differs from Units x Order Price by ${diff.toString()} (rounding allows ${tolerance.toString()})`,
        );
      }
    }
    if (assetType === 'certificado_aforro') {
      if (tt === 'sell') bad('ca', 'CA sells (redemptions) are not supported yet');
      if (!r.price.value.eq(CA_UNIT_PRICE)) bad('ca', 'CA Order Price must be 1');
    }
    if (rowType && account && m && assetType && TRANSACT_TYPES.includes(tt)) {
      checked.push({ r, tt, account, m, assetType });
    }
  }

  // --- exact duplicates ------------------------------------------------------
  const byKey = new Map<string, TxRecord[]>();
  for (const r of tx.records) byKey.set(rowKey(r), [...(byKey.get(rowKey(r)) ?? []), r]);
  const occurrence = new Map<number, number>();
  const duplicates: ImportPlan['duplicates'] = [];
  for (const group of byKey.values()) {
    group.forEach((r, i) => occurrence.set(r.line, i + 1));
    if (group.length < 2) continue;
    const key = duplicateKey(group[0] as TxRecord);
    const allowed = input.allowedDuplicates.has(key);
    const lines = group.map((r) => r.line);
    duplicates.push({ key, lines, allowed });
    if (!allowed) {
      for (const r of group) {
        reject(
          'transactions',
          r.line,
          r.cells,
          'duplicate',
          `identical to line(s) ${lines.filter((l) => l !== r.line).join(', ')}; if these are separate real orders, add ${key} to allowed-duplicates.txt`,
        );
      }
    }
  }

  // --- sells vs holdings, per account, in (month, file order) --------------------
  const held = new Map<string, Decimal>();
  const ordered = checked
    .filter((v) => !isRejected('transactions', v.r.line) && v.assetType !== 'certificado_aforro')
    .sort((a, b) => (a.r.month < b.r.month ? -1 : a.r.month > b.r.month ? 1 : a.r.line - b.r.line));
  for (const v of ordered) {
    const k = `${v.account.name}|${v.r.ticker}`;
    const before = held.get(k) ?? new Decimal(0);
    const after = before.plus(v.r.units.value);
    if (after.isNegative()) {
      reject(
        'transactions',
        v.r.line,
        v.r.cells,
        'sell exceeds holdings',
        `sells ${v.r.units.value.neg().toString()} ${v.r.ticker} but ${v.account.name} holds ${before.toString()} at that point (earlier months, then file order)`,
      );
    } else held.set(k, after);
  }

  // --- certificados: group by (series, month), match the CA file -----------------
  interface Group {
    series: string;
    month: IsoDate;
    rows: Valid[];
    units: Decimal;
    caRecord: CaRecord | null;
  }
  const groups = new Map<string, Group>();
  for (const v of checked) {
    if (v.assetType !== 'certificado_aforro' || isRejected('transactions', v.r.line)) continue;
    const k = `${v.r.ticker}|${v.r.month}`;
    const g = groups.get(k) ?? {
      series: v.r.ticker,
      month: v.r.month,
      rows: [],
      units: new Decimal(0),
      caRecord: null,
    };
    g.rows.push(v);
    g.units = g.units.plus(v.r.units.value);
    groups.set(k, g);
  }
  const rejectGroup = (g: Group, code: string, text: string) => {
    for (const v of g.rows) reject('transactions', v.r.line, v.r.cells, code, text);
  };
  for (const g of groups.values()) {
    if (new Set(g.rows.map((v) => v.account.name)).size > 1) {
      rejectGroup(
        g,
        'ca',
        `CA rows of ${g.series} ${g.month.slice(0, 7)} are at more than one broker`,
      );
    }
  }
  if (ca) {
    const caByKey = new Map<string, CaRecord[]>();
    for (const c of ca.records)
      caByKey.set(`${c.series}|${c.month}`, [...(caByKey.get(`${c.series}|${c.month}`) ?? []), c]);
    for (const [k, list] of caByKey) {
      const label = `${list[0]!.series} ${list[0]!.month.slice(0, 7)}`;
      if (list.length > 1) {
        for (const c of list)
          reject('ca', c.line, c.cells, 'ca', `the CA file lists ${label} more than once`);
        continue;
      }
      const c = list[0] as CaRecord;
      const g = groups.get(k);
      if (c.dayNotFirst)
        warnings.push({
          file: 'ca',
          line: c.line,
          message: 'date has a day other than the 1st; matched by month',
        });
      if (!g) {
        reject('ca', c.line, c.cells, 'ca', `no CA rows for ${label} in the transactions file`);
        continue;
      }
      if (!c.units.value.eq(g.units)) {
        const text = `CA file units for ${label} (${c.units.value.toString()}) differ from the transactions file total (${g.units.toString()})`;
        reject('ca', c.line, c.cells, 'ca', text);
        rejectGroup(g, 'ca', text);
        continue;
      }
      if (!c.ratio.value.gt(0)) {
        reject('ca', c.line, c.cells, 'ca', 'Ratio must be > 0');
        continue;
      }
      if (input.ratioMonth && input.ratioMonth < c.month) {
        reject(
          'ca',
          c.line,
          c.cells,
          'ca',
          `--ratio-month is before the subscription month ${c.month.slice(0, 7)}`,
        );
        continue;
      }
      g.caRecord = c;
    }
  }

  // --- existing state and idempotency -----------------------------------------
  const hashes = new Map(state.importedTransactions.map((t) => [t.importRowHash, t]));
  const subByTx = new Map(state.caSubscriptions.map((s) => [s.transactionId, s.id]));
  const factorByKey = new Map(
    state.caFactors.map((f) => [`${f.subscriptionId}|${f.month}`, f.factor]),
  );

  for (const g of groups.values()) {
    if (g.caRecord || g.rows.some((v) => isRejected('transactions', v.r.line))) continue;
    if (!hashes.has(caSubscriptionHash(g.series, g.month))) {
      rejectGroup(
        g,
        'ca',
        ca
          ? `no Ratio for ${g.series} ${g.month.slice(0, 7)} in the CA file`
          : `subscription ${g.series} ${g.month.slice(0, 7)} is new: pass --ca with the CA table`,
      );
    }
  }

  // Payload, built lazily so only referenced accounts, assets and series are created.
  const payload: CommitPayload = {
    source: IMPORT_SOURCE,
    transactions_file_sha256: input.files.transactionsSha256,
    ca_file_sha256: ca ? input.files.caSha256 : null,
    ca_ratio_month: ca ? input.ratioMonth : null,
    settings: input.settings,
    accounts: [],
    assets: [],
    ca_series: [],
    transactions: [],
    ca_subscriptions: [],
    ca_factors: [],
  };
  const accountIds = new Map(state.accounts.map((a) => [a.name.toLowerCase(), a.id]));
  const assetIds = new Map(
    state.assets.map((a) => [`${a.ticker?.toUpperCase()}|${a.assetType}`, a.id]),
  );
  const takenIsins = new Map(
    state.assets.filter((a) => a.isin).map((a) => [a.isin as string, a.ticker]),
  );
  const seriesIds = new Map(state.caSeries.map((s) => [s.code.toUpperCase(), s.id]));
  const accountId = (a: Valid['account']) => {
    let id = accountIds.get(a.name.toLowerCase());
    if (!id) {
      id = input.newId();
      accountIds.set(a.name.toLowerCase(), id);
      payload.accounts.push({ id, name: a.name, account_type: a.accountType });
    }
    return id;
  };
  const assetId = (m: AssetMapping, type: AssetType) => {
    let id = assetIds.get(`${m.ticker}|${type}`);
    if (!id) {
      id = input.newId();
      assetIds.set(`${m.ticker}|${type}`, id);
      payload.assets.push({
        id,
        name: m.name,
        asset_type: type,
        isin: m.isin,
        ticker: m.ticker,
        exchange: m.exchange,
        trading_currency: m.currency,
        price_source: m.priceSource,
        price_source_id: m.priceSourceId,
      });
    }
    return id;
  };
  const seriesId = (code: string) => {
    let id = seriesIds.get(code);
    if (!id) {
      id = input.newId();
      seriesIds.set(code, id);
      payload.ca_series.push({ id, code, name: `Série ${code}` });
    }
    return id;
  };
  const isinClash = (v: Valid) =>
    v.m.isin !== null &&
    !assetIds.has(`${v.m.ticker}|${v.assetType}`) &&
    takenIsins.has(v.m.isin) &&
    takenIsins.get(v.m.isin) !== v.m.ticker;

  // Inserts in file order: a CA subscription sits at its first row.
  type Entry = { line: number; run: () => void };
  const entries: Entry[] = [];
  const rows: PlannedRow[] = [];
  const planned: PlannedCa[] = [];
  let seq = 0;

  for (const v of checked) {
    if (v.assetType === 'certificado_aforro' || isRejected('transactions', v.r.line)) continue;
    if (isinClash(v)) {
      reject(
        'transactions',
        v.r.line,
        v.r.cells,
        'isin conflict',
        `ISIN of ${v.m.ticker} is already used by ${takenIsins.get(v.m.isin as string)} in the database`,
      );
      continue;
    }
    const hash = rowHash(v.r, occurrence.get(v.r.line) ?? 1);
    const status = hashes.has(hash) ? 'skip' : 'insert';
    rows.push({
      line: v.r.line,
      account: v.account.name,
      ticker: v.r.ticker,
      assetType: v.assetType,
      transactType: v.tt,
      units: v.r.units.value,
      price: v.r.price.value,
      value: v.r.value.value,
      status,
    });
    if (status === 'skip') {
      skips.push({ file: 'transactions', line: v.r.line, reason: 'already imported' });
      continue;
    }
    entries.push({
      line: v.r.line,
      run: () =>
        payload.transactions.push({
          id: input.newId(),
          seq: ++seq,
          account_id: accountId(v.account),
          asset_id: assetId(v.m, v.assetType),
          type: v.tt,
          trade_date: v.r.month,
          trade_date_precision: 'month',
          quantity: v.r.units.value.abs().toString(),
          unit_price: v.r.price.value.toString(),
          currency: ORDER_CURRENCY,
          fx_rate_to_eur: '1',
          import_row_hash: hash,
          notes: null,
        }),
    });
  }

  for (const g of groups.values()) {
    if (g.rows.some((v) => isRejected('transactions', v.r.line))) {
      if (g.caRecord)
        reject(
          'ca',
          g.caRecord.line,
          g.caRecord.cells,
          'ca',
          `transactions rows of ${g.series} ${g.month.slice(0, 7)} were rejected`,
        );
      continue;
    }
    const first = g.rows[0] as Valid;
    const lines = g.rows.map((v) => v.r.line);
    const hash = caSubscriptionHash(g.series, g.month);
    const existing = hashes.get(hash);
    const ratio = g.caRecord?.ratio.value ?? null;
    const plannedCa: PlannedCa = {
      series: g.series,
      month: g.month,
      account: first.account.name,
      lines,
      units: g.units,
      caLine: g.caRecord?.line ?? null,
      factor: ratio,
      status: existing ? 'skip' : 'insert',
      factorStatus: ratio ? 'insert' : 'none',
    };

    if (existing) {
      if (!new Decimal(existing.quantity).eq(g.units)) {
        rejectGroup(
          g,
          'already imported differently',
          `subscription ${g.series} ${g.month.slice(0, 7)} was imported with ${existing.quantity} units, the file now has ${g.units.toString()}`,
        );
        if (g.caRecord)
          reject(
            'ca',
            g.caRecord.line,
            g.caRecord.cells,
            'already imported differently',
            'its subscription was imported with other units',
          );
        continue;
      }
      for (const line of lines)
        skips.push({ file: 'transactions', line, reason: 'already imported' });
      const subId = subByTx.get(existing.id);
      if (g.caRecord && ratio && subId) {
        const recorded = factorByKey.get(`${subId}|${input.ratioMonth}`);
        if (recorded !== undefined) {
          if (new Decimal(recorded).eq(ratio)) {
            plannedCa.factorStatus = 'skip';
            skips.push({ file: 'ca', line: g.caRecord.line, reason: 'factor already recorded' });
          } else {
            reject(
              'ca',
              g.caRecord.line,
              g.caRecord.cells,
              'factor conflict',
              `a different factor (${recorded}) is already recorded for ${input.ratioMonth?.slice(0, 7)}; factors are never overwritten`,
            );
            continue;
          }
        } else {
          const caLine = g.caRecord.line;
          entries.push({
            line: caLine,
            run: () =>
              payload.ca_factors.push({
                subscription_id: subId,
                month: input.ratioMonth as IsoDate,
                factor: ratio.toString(),
                source: FACTOR_SOURCE,
                notes: null,
              }),
          });
        }
      }
      planned.push(plannedCa);
      continue;
    }

    planned.push(plannedCa);
    entries.push({
      line: first.r.line,
      run: () => {
        const txId = input.newId();
        const subId = input.newId();
        payload.transactions.push({
          id: txId,
          seq: ++seq,
          account_id: accountId(first.account),
          asset_id: assetId(first.m, 'certificado_aforro'),
          type: 'subscription',
          trade_date: g.month,
          trade_date_precision: 'month',
          quantity: g.units.toString(),
          unit_price: CA_UNIT_PRICE,
          currency: ORDER_CURRENCY,
          fx_rate_to_eur: '1',
          import_row_hash: hash,
          notes: lines.length > 1 ? `${lines.length} spreadsheet rows` : null,
        });
        payload.ca_subscriptions.push({
          id: subId,
          series_id: seriesId(g.series),
          transaction_id: txId,
        });
        if (ratio) {
          payload.ca_factors.push({
            subscription_id: subId,
            month: input.ratioMonth as IsoDate,
            factor: ratio.toString(),
            source: FACTOR_SOURCE,
            notes: null,
          });
        }
      },
    });
  }

  entries.sort((a, b) => a.line - b.line);
  for (const e of entries) e.run();

  // --- counts ----------------------------------------------------------------
  const rejectList = [...rejects.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
  const count = (file: string, read: number): FileCounts => {
    const reject = rejectList.filter((r) => r.file === file).length;
    const skip = skips.filter((s) => s.file === file).length;
    return { read, insert: read - reject - skip, skip, reject };
  };
  const missingTickers = [...usedTickers]
    .filter((t) => !mapping.has(t))
    .sort()
    .map((ticker) => ({ ticker, types: [...(observed.get(ticker) ?? [])].sort() }));

  return {
    fatal,
    rejects: rejectList,
    skips: skips.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    warnings,
    rows,
    ca: planned,
    duplicates,
    missingTickers,
    counts: {
      transactions: count(
        'transactions',
        tx.records.length + tx.problems.length + tx.blankLines.length,
      ),
      ca: ca ? count('ca', ca.records.length + ca.problems.length + ca.blankLines.length) : null,
    },
    payload,
  };
}

/** A plan may be committed only with no fatal problem and no reject. */
export function canCommit(plan: ImportPlan): boolean {
  return plan.fatal.length === 0 && plan.rejects.length === 0;
}

function normalizeToken(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}
