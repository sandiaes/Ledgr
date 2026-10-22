// Commands (see docs/prices.md):
//   resolve [--commit]   find each asset's provider symbol; --commit writes the resolved ones
//   backfill [options]   FX, prices and snapshots from the first trade, then the sanity report
//   report               the sanity report only (read-only)
//
// Writes need the project reference typed back. Console output is counts and totals only;
// per-asset detail goes to the report folder (git-ignored).
import { addDays, type IsoDate } from '@ledgr/core';
import {
  createProviders,
  resolveSymbols,
  runFx,
  runPrices,
  runRecorded,
  runSnapshots,
  type Fetch,
  type JobContext,
  type JobRunRecord,
  type JobsDb,
  type Sleep,
} from '@ledgr/market';
import { parseDotEnv, validatePricesEnv, type PricesEnv } from './env';
import { buildSanity, issuesReport, symbolsReport, type ReportFile } from './report';

export interface CliDeps {
  envPath: string;
  reportsRoot: string;
  /** File contents, or null when the file does not exist. */
  readText(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  openDb(env: PricesEnv): JobsDb;
  checkUser(env: PricesEnv): Promise<void>;
  fetch: Fetch;
  sleep: Sleep;
  ask(question: string): Promise<string>;
  print(line: string): void;
  now(): Date;
}

export class ArgError extends Error {
  override name = 'ArgError';
}

type Command = 'resolve' | 'backfill' | 'report';
const JOBS = ['fx', 'prices', 'snapshots'] as const;
type Job = (typeof JOBS)[number];

export interface Args {
  command: Command;
  commit: boolean;
  refetch: boolean;
  from: IsoDate | null;
  to: IsoDate | null;
  only: Set<Job>;
}

export const USAGE = `Usage (from the repository root):
  pnpm prices resolve [--commit]
  pnpm prices backfill [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--only fx,prices,snapshots] [--refetch]
  pnpm prices report [--to YYYY-MM-DD]

  resolve    proposes a price symbol per asset (OpenFIGI + provider); --commit writes them
  backfill   ECB rates, prices and daily snapshots from your first trade (default) to yesterday
  report     value-to-cost per position, flagging possible split or currency problems
  --from     backfill only from this date      --to      last day (default yesterday)
  --only     run only some steps               --refetch fetch price ranges already stored`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function parseArgs(argv: readonly string[]): Args {
  let command: Command | null = null;
  const args: Args = {
    command: 'report',
    commit: false,
    refetch: false,
    from: null,
    to: null,
    only: new Set(JOBS),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--') continue;
    if (!a.startsWith('--')) {
      if (command) throw new ArgError(`Unexpected argument "${a}"`);
      if (a !== 'resolve' && a !== 'backfill' && a !== 'report')
        throw new ArgError(`Unknown command "${a}"`);
      command = a;
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (name === 'commit' || name === 'refetch') {
      if (inline !== undefined) throw new ArgError(`--${name} takes no value`);
      args[name] = true;
      continue;
    }
    if (name !== 'from' && name !== 'to' && name !== 'only')
      throw new ArgError(`Unknown option --${name}`);
    const v = inline ?? argv[++i];
    if (v === undefined || v.startsWith('--')) throw new ArgError(`--${name} needs a value`);
    if (name === 'only') {
      const list = v.split(',').map((s) => s.trim());
      if (list.some((s) => !(JOBS as readonly string[]).includes(s))) {
        throw new ArgError(`--only takes ${JOBS.join(', ')}`);
      }
      args.only = new Set(list as Job[]);
    } else {
      if (!ISO.test(v)) throw new ArgError(`--${name} must be YYYY-MM-DD`);
      args[name] = v;
    }
  }
  if (!command) throw new ArgError('Give a command: resolve, backfill or report');
  args.command = command;
  if (args.commit && command !== 'resolve') throw new ArgError('--commit is for resolve only');
  if (args.from && args.to && args.from > args.to) throw new ArgError('--from is after --to');
  return args;
}

function stamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
}

function describeCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([k, v]) => v !== 0 || k === 'rows' || k === 'written')
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
}

export async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    deps.print(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }

  const text = await deps.readText(deps.envPath);
  if (text === null) {
    deps.print(
      `No ${deps.envPath}. Copy scripts/prices/.env.example to scripts/prices/.env and fill it in (see docs/prices.md).`,
    );
    return 1;
  }
  let env: PricesEnv;
  try {
    env = validatePricesEnv(parseDotEnv(text), deps.envPath);
  } catch (e) {
    deps.print((e as Error).message);
    return 1;
  }

  const db = deps.openDb(env);
  await deps.checkUser(env);
  const now = deps.now();
  const today: IsoDate = now.toISOString().slice(0, 10);
  const to = args.to ?? addDays(today, -1);
  const http = { fetch: deps.fetch, sleep: deps.sleep };
  const providers = createProviders(
    http,
    { tiingo: env.tiingoKey ?? undefined, alphavantage: env.alphaVantageKey ?? undefined },
    () => today,
  );
  const ctx: JobContext = {
    db,
    http,
    providers,
    today,
    trigger: 'script',
    staleAfterDays: env.staleAfterDays,
    caMaxAgeDays: env.caMaxAgeDays,
    now: deps.now,
  };
  const dir = `${deps.reportsRoot}/${stamp(now)}-${args.command}`;
  const save = async (files: ReportFile[]) => {
    await deps.mkdir(dir);
    for (const f of files) await deps.writeFile(`${dir}/${f.name}`, f.content);
    deps.print(`Reports: ${dir}`);
  };
  const confirm = async (what: string) => {
    deps.print(`Target Supabase project: ${env.projectRef}`);
    deps.print(what);
    const answer = (await deps.ask('Type the project reference to continue: ')).trim();
    if (answer !== env.projectRef) {
      deps.print('Cancelled. Nothing was written.');
      return false;
    }
    return true;
  };

  if (args.command === 'resolve') {
    const assets = await db.loadAssets();
    const res = await resolveSymbols(assets, {
      http,
      providers,
      openFigiKey: env.openFigiKey ?? undefined,
    });
    const count = (s: string) => res.filter((r) => r.status === s).length;
    deps.print(
      `Symbols: ${count('resolved')} resolved, ${count('unchanged')} unchanged, ${count('unresolved')} unresolved, ${count('skipped')} skipped (certificados).`,
    );
    deps.print(`Warnings: ${res.filter((r) => r.warnings.length > 0).length}.`);
    await save([symbolsReport(assets, res)]);
    const resolved = res.filter((r) => r.status === 'resolved');
    if (!args.commit) {
      deps.print('Dry run: nothing written. Review symbols.csv, then run again with --commit.');
      return count('unresolved') > 0 ? 1 : 0;
    }
    if (resolved.length === 0) {
      deps.print('Nothing to write.');
      return count('unresolved') > 0 ? 1 : 0;
    }
    if (!(await confirm(`Writes price_source / price_source_id for ${resolved.length} assets.`)))
      return 1;
    await runRecorded(ctx, 'resolve', async () => {
      for (const r of resolved)
        await db.setPriceSymbol(r.assetId, r.source as string, r.symbol as string);
      return {
        status: count('unresolved') > 0 ? 'partial' : 'ok',
        counts: { written: resolved.length, unresolved: count('unresolved') },
        issues: res
          .filter((r) => r.status === 'unresolved')
          .map((r) => ({ code: 'unresolved', assetId: r.assetId })),
      };
    });
    deps.print(`Wrote ${resolved.length} price symbols.`);
    return count('unresolved') > 0 ? 1 : 0;
  }

  const runs: JobRunRecord[] = [];
  if (args.command === 'backfill') {
    const steps = JOBS.filter((j) => args.only.has(j));
    if (
      !(await confirm(
        `Backfill ${steps.join(', ')} ${args.from ? `from ${args.from}` : 'from your first trade'} to ${to}.`,
      ))
    ) {
      return 1;
    }
    const from = args.from ?? undefined;
    if (args.only.has('fx'))
      runs.push(await runRecorded(ctx, 'fx', () => runFx(ctx, { from, to: today })));
    if (args.only.has('prices')) {
      runs.push(
        await runRecorded(ctx, 'prices', () =>
          runPrices(ctx, { mode: 'backfill', from, to, refetch: args.refetch }),
        ),
      );
    }
    if (args.only.has('snapshots')) {
      // From the first trade unless --from is given (runSnapshots clamps to the first trade).
      runs.push(
        await runRecorded(ctx, 'snapshots', () =>
          runSnapshots(ctx, { from: from ?? '2000-01-01', to }),
        ),
      );
    }
    for (const r of runs)
      deps.print(`${r.job}: ${r.status}; ${describeCounts(r.counts)}; issues ${r.issues.length}`);
  }

  const assets = await db.loadAssets();
  const { report, file } = await buildSanity(db, to);
  deps.print(
    `Sanity on ${to}: ${report.rows.length} positions, value ${report.totalValueEur.toFixed(2)} EUR, ` +
      `cost ${report.totalCostBasisEur.toFixed(2)} EUR, ${report.outliers} to check (ratio > 5x or < 0.2x), ${report.unvalued} without a price.`,
  );
  await save(runs.length > 0 ? [file, issuesReport(assets, runs)] : [file]);
  const failed = runs.some((r) => r.status !== 'ok');
  return failed || report.outliers > 0 || report.unvalued > 0 ? 1 : 0;
}
