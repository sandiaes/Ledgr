// Detailed reports, written under import-data/reports/ (git-ignored). They contain
// financial values; the console never does (beyond totals).
//
// CSVs use the delimiter and decimal separator detected in the transactions file, plus a
// UTF-8 BOM, so the same Excel that exported the data opens them correctly.
import type { Decimal } from '@ledgr/core';
import { csvLine, type Delimiter } from './csv';
import type { FileSettings } from './inputs';
import type { ImportPlan } from './plan';
import type { Reconciliation } from './reconcile';

export interface ReportFile {
  name: string;
  content: string;
}

export interface ReportContext {
  mode: 'dry-run' | 'commit';
  generatedAt: string;
  projectRef: string | null;
  batchId: string | null;
  settings: FileSettings[];
  ratioMonth: string | null;
}

export function buildReports(
  plan: ImportPlan,
  rec: Reconciliation,
  ctx: ReportContext,
): ReportFile[] {
  const tx = ctx.settings.find((s) => s.file === 'transactions');
  const delimiter: Delimiter =
    tx?.delimiter === 'semicolon' ? ';' : tx?.delimiter === 'tab' ? '\t' : ',';
  const comma = tx?.decimal === ',';
  const n = (d: Decimal | null) =>
    d === null ? '' : comma ? d.toString().replace('.', ',') : d.toString();
  const csv = (name: string, header: string[], rows: string[][]): ReportFile => ({
    name,
    content: '\uFEFF' + [header, ...rows].map((r) => csvLine(r, delimiter)).join('\r\n') + '\r\n',
  });

  const files: ReportFile[] = [
    { name: 'summary.txt', content: summaryText(plan, rec, ctx) },
    {
      name: 'settings.json',
      content: JSON.stringify({ ...ctx, settings: ctx.settings }, null, 2) + '\n',
    },
    csv(
      'rejects.csv',
      ['file', 'line', 'checks', 'reasons', 'row as read'],
      plan.rejects.map((r) => [
        r.file,
        String(r.line),
        [...new Set(r.reasons.map((x) => x.code))].join(', '),
        r.reasons.map((x) => x.text).join(' | '),
        r.cells.join(' | '),
      ]),
    ),
    csv(
      'skips.csv',
      ['file', 'line', 'reason'],
      plan.skips.map((s) => [s.file, String(s.line), s.reason]),
    ),
    csv(
      'warnings.csv',
      ['file', 'line', 'warning'],
      plan.warnings.map((w) => [w.file, w.line === null ? '' : String(w.line), w.message]),
    ),
    csv(
      'duplicates.csv',
      ['key', 'lines', 'allowed'],
      plan.duplicates.map((d) => [d.key, d.lines.join(' '), d.allowed ? 'yes' : 'no']),
    ),
    csv(
      'rows.csv',
      [
        'line',
        'status',
        'account',
        'ticker',
        'asset_type',
        'transact_type',
        'units',
        'order_price',
        'order_value',
      ],
      plan.rows.map((r) => [
        String(r.line),
        r.status,
        r.account,
        r.ticker,
        r.assetType,
        r.transactType,
        n(r.units),
        n(r.price),
        n(r.value),
      ]),
    ),
    csv(
      'ca_subscriptions.csv',
      [
        'series',
        'month',
        'account',
        'transactions lines',
        'ca line',
        'units',
        'subscription',
        'factor',
        'factor status',
      ],
      plan.ca.map((c) => [
        c.series,
        c.month.slice(0, 7),
        c.account,
        c.lines.join(' '),
        c.caLine === null ? '' : String(c.caLine),
        n(c.units),
        c.status,
        n(c.factor),
        c.factorStatus,
      ]),
    ),
    csv(
      'reconciliation_positions.csv',
      [
        'account',
        'ticker',
        'asset_type',
        'units',
        'net_invested_eur (units x price)',
        'excel_order_value_eur',
        'difference',
      ],
      rec.positions.map((p) => [
        p.account,
        p.ticker,
        p.assetType,
        n(p.units),
        n(p.netInvestedEur),
        n(p.excelOrderValueEur),
        n(p.netInvestedEur.minus(p.excelOrderValueEur)),
      ]),
    ),
    csv(
      'reconciliation_types.csv',
      ['asset_type', 'net_invested_eur', 'excel_order_value_eur'],
      [
        ...rec.byType.map((t) => [t.assetType, n(t.netInvestedEur), n(t.excelOrderValueEur)]),
        ['TOTAL', n(rec.totals.netInvestedEur), n(rec.totals.excelOrderValueEur)],
      ],
    ),
    csv(
      'reconciliation_ca.csv',
      [
        'series',
        'subscription month',
        'units',
        'factor month',
        'factor',
        'value_eur (units x factor)',
        'valued by',
      ],
      [
        ...rec.ca.map((c) => [
          c.series,
          c.month.slice(0, 7),
          n(c.units),
          c.factorMonth?.slice(0, 7) ?? '',
          n(c.factor),
          n(c.valueEur),
          c.source,
        ]),
        ['TOTAL', '', '', '', '', n(rec.totals.caValueEur), ''],
      ],
    ),
  ];
  if (rec.holdingsDiff) {
    files.push(
      csv(
        'holdings_diff.csv',
        ['ticker', 'ledger_units', 'spreadsheet_units', 'difference', 'status'],
        rec.holdingsDiff.map((h) => [
          h.ticker,
          n(h.ledgerUnits),
          n(h.sheetUnits),
          n(h.difference),
          h.status,
        ]),
      ),
    );
  }
  if (plan.missingTickers.length > 0) {
    // Rows to paste into the mapping file: only what the data says; the rest is yours.
    files.push(
      csv(
        'asset_mapping.missing.csv',
        [
          'ticker',
          'asset_type',
          'name',
          'isin',
          'exchange',
          'currency',
          'price_symbol',
          'type_override',
        ],
        plan.missingTickers.map((t) => [t.ticker, t.types.join('|'), '', '', '', 'EUR', '', '']),
      ),
    );
  }
  return files;
}

export function describeSettings(s: FileSettings): string[] {
  return [
    `  ${s.file}: encoding ${s.encoding}${s.bom ? ' (with BOM)' : ''}, delimiter ${s.delimiter}, ` +
      `decimal ${s.decimal ? `"${s.decimal}"` : 'none seen'} (${s.decimalReason})`,
    ...(s.dateStyles.length > 0
      ? [
          `    dates: ${s.dateStyles.join(', ')}${s.dateOrder ? `, ${s.dateOrder === 'dmy' ? 'day first' : 'month first'} (${s.dateOrderReason})` : ''}`,
        ]
      : []),
    ...(s.ignoredColumns.length > 0 ? [`    ignored columns: ${s.ignoredColumns.join(', ')}`] : []),
  ];
}

function summaryText(plan: ImportPlan, rec: Reconciliation, ctx: ReportContext): string {
  const lines = [
    `Ledgr spreadsheet import: ${ctx.mode}`,
    `Generated: ${ctx.generatedAt}`,
    `Project: ${ctx.projectRef ?? 'offline (no database checked)'}`,
    ...(ctx.batchId ? [`Batch: ${ctx.batchId}`] : []),
    `Ratio month: ${ctx.ratioMonth?.slice(0, 7) ?? '-'}`,
    '',
    'Detected CSV settings',
    ...ctx.settings.flatMap(describeSettings),
    '',
    ...countLines(plan),
    '',
    'Totals (accepted rows: inserted now or already imported)',
    `  net invested (units x order price): ${rec.totals.netInvestedEur.toFixed(2)} EUR`,
    `  Excel order value:                  ${rec.totals.excelOrderValueEur.toFixed(2)} EUR`,
    `  CA value (units x factor):          ${rec.totals.caValueEur.toFixed(2)} EUR`,
    '',
    'Order prices are taken as EUR with fx_rate 1; fees are recorded as 0; no tax logic.',
    ...(plan.fatal.length > 0 ? ['', 'Blocking problems', ...plan.fatal.map((f) => `  ${f}`)] : []),
  ];
  return lines.join('\n') + '\n';
}

export function countLines(plan: ImportPlan): string[] {
  const c = plan.counts;
  const p = plan.payload;
  const mappingRejects = plan.rejects.filter((r) => r.file === 'mapping').length;
  const byCode = new Map<string, number>();
  for (const r of plan.rejects)
    for (const code of new Set(r.reasons.map((x) => x.code)))
      byCode.set(code, (byCode.get(code) ?? 0) + 1);
  return [
    'Rows',
    `  transactions file: ${c.transactions.read} read, ${c.transactions.insert} to insert, ${c.transactions.skip} skip, ${c.transactions.reject} reject`,
    ...(c.ca
      ? [
          `  CA file:           ${c.ca.read} read, ${c.ca.insert} to insert, ${c.ca.skip} skip, ${c.ca.reject} reject`,
        ]
      : []),
    ...(mappingRejects > 0 ? [`  mapping file:      ${mappingRejects} row(s) rejected`] : []),
    ...(byCode.size > 0
      ? ['  rejected rows by check:', ...[...byCode].sort().map(([code, k]) => `    ${code}: ${k}`)]
      : []),
    `  warnings: ${plan.warnings.length}`,
    'Database rows to insert',
    `  transactions ${p.transactions.length}, accounts ${p.accounts.length}, assets ${p.assets.length}, ` +
      `ca_series ${p.ca_series.length}, ca_subscriptions ${p.ca_subscriptions.length}, ca_factors ${p.ca_factors.length}`,
  ];
}
