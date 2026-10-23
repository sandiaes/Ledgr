// pnpm prices twr-check: which days drive the "Since start" TWR the app shows. Read-only.
// TWR multiplies one step per snapshot day, so a single day whose value does not match its
// rows (a wrong or stand-in price on the day of a large buy, a month-level imported row
// valued on the 1st) moves it a lot and is not undone later. The console gets percentages
// and counts only; the per-day list (dates, step %, row types, how the traded assets were
// valued) goes to twr-steps.csv. No amount is printed or written.
import { Decimal, periodReturns, twrSteps, type IsoDate, type TwrStep } from '@ledgr/core';
import type { JobsDb, StoredSnapshot } from '@ledgr/market';
import { csv, type ReportFile } from './report';

const pct = (d: Decimal) => {
  const text = d.times(100).toFixed(2);
  return `${text === '-0.00' ? '0.00' : text}%`;
};

/** How strongly a step moves the product: |ln(1 + r)|; a step to zero or below is total. */
function impact(s: TwrStep): Decimal {
  const growth = s.return.plus(1);
  return growth.gt(0) ? growth.ln().abs() : new Decimal(Infinity);
}

export async function twrCheck(
  db: JobsDb,
  top = 15,
): Promise<{ lines: string[]; file: ReportFile | null }> {
  const [transactions, assets, snapshots] = await Promise.all([
    db.loadTransactions(),
    db.loadAssets(),
    db.loadSnapshots(),
  ]);
  const last = snapshots[snapshots.length - 1];
  if (!last || transactions.length === 0) {
    return { lines: ['No snapshots or no transactions: nothing to check.'], file: null };
  }
  // T = the last snapshot day, valued by that snapshot: the app's figure up to that day.
  const input = { transactions, snapshots, today: last.date, valueTodayEur: last.valueEur };
  const since = periodReturns(input).find((r) => r.period === 'sinceStart');
  const steps = twrSteps(input, 'sinceStart');
  if (!since || !steps) {
    return {
      lines: ['TWR since start cannot be computed (no rows or a snapshot missing).'],
      file: null,
    };
  }

  const lines: string[] = [];
  const twr = since.twr.ok
    ? `${pct(since.twr.cumulative)}${since.twr.annualized ? ` (${pct(since.twr.annualized)} a year)` : ''}`
    : `— (${since.twr.reason})`;
  const xirr = since.xirr.ok ? pct(since.xirr.displayRate) : `— (${since.xirr.reason})`;
  lines.push(`Since start to ${last.date} (last snapshot): TWR ${twr}, XIRR ${xirr}.`);

  const ranked = [...steps].sort((a, b) => impact(b).comparedTo(impact(a)));
  const worst = ranked.slice(0, top);
  const product = (list: readonly TwrStep[]) =>
    list.reduce((g, s) => g.times(s.return.plus(1)), new Decimal(1));
  const big = steps.filter((s) => s.return.abs().gt('0.2')).length;
  lines.push(`${steps.length} daily steps; ${big} moved TWR by more than 20% in a single step.`);
  lines.push(
    `The ${worst.length} largest steps together multiply it by ${product(worst).toFixed(4)}; ` +
      `all the other steps by ${product(ranked.slice(top)).toFixed(4)}.`,
  );

  const label = new Map(assets.map((a) => [a.id, a.ticker || a.name]));
  const byDate = new Map<IsoDate, StoredSnapshot>(snapshots.map((s) => [s.date, s]));
  const rows = worst.map((s, i) => {
    const inStep = transactions.filter((t) => t.tradeDate > s.from && t.tradeDate <= s.date);
    const types = new Map<string, number>();
    for (const t of inStep) types.set(t.type, (types.get(t.type) ?? 0) + 1);
    const flags = new Map((byDate.get(s.date)?.flags ?? []).map((f) => [f.assetId, f]));
    const traded = [...new Set(inStep.map((t) => t.assetId).filter((a): a is string => !!a))];
    return [
      i + 1,
      s.from,
      s.date,
      pct(s.return),
      s.fromZero ? 'from zero' : pct(s.flowEur.div(s.startValueEur)),
      [...types].map(([t, n]) => `${t}:${n}`).join(' '),
      inStep.filter((t) => t.tradeDatePrecision === 'month').length,
      traded
        .map((id) => {
          const f = flags.get(id);
          const how = f ? `${f.source} ${f.asOf}${f.stale ? ' stale' : ''}` : 'not held';
          return `${label.get(id) ?? id} (${how})`;
        })
        .join('; '),
      [...flags.values()].filter((f) => f.stale).length,
    ];
  });
  return {
    lines,
    file: {
      name: 'twr-steps.csv',
      content: csv(
        [
          'rank',
          'from',
          'to',
          'step_return',
          'flow_vs_start_value',
          'rows',
          'month_level_rows',
          'traded_assets_valued_by',
          'stale_holdings',
        ],
        rows,
      ),
    },
  };
}
