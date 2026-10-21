// Commands:
//   dry-run (default)   validate everything, write reports, change nothing
//   commit --commit     the same, then write to Supabase after a typed confirmation
//   undo --batch <id>   remove exactly the rows of one import batch, after confirmation
//
// Console output is counts, settings and totals only; row details go to the reports.
import type { IsoDate } from '@ledgr/core';
import { type Delimiter, type Encoding } from './csv';
import { parseMonthArg, type DateOrder } from './dates';
import { EMPTY_STATE, type ImportDb } from './db';
import { validateEnv, parseDotEnv, type ImportEnv } from './env';
import { sha256Hex } from './hash';
import {
  readAllowedDuplicates,
  readCa,
  readHoldings,
  readMappingFile,
  readTransactions,
  type FileSettings,
  type ReadOptions,
} from './inputs';
import { buildMapping } from './mapping';
import type { DecimalSeparator } from './numbers';
import { canCommit, planImport, type ImportPlan } from './plan';
import { reconcile } from './reconcile';
import { buildReports, countLines, describeSettings } from './report';

export interface CliDeps {
  /** Resolves a path given on the command line (relative to the current directory). */
  resolveArg(path: string): string;
  /** Resolves a default path (relative to the repository root). */
  resolveDefault(path: string): string;
  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  openDb(env: ImportEnv): ImportDb;
  ask(question: string): Promise<string>;
  print(line: string): void;
  now(): Date;
  newId(): string;
}

class ArgError extends Error {
  override name = 'ArgError';
}

interface Args {
  command: 'dry-run' | 'commit' | 'undo';
  commitFlag: boolean;
  values: Map<string, string>;
  flags: Set<string>;
}

const VALUE_OPTIONS = new Set([
  'transactions',
  'ca',
  'mapping',
  'ratio-month',
  'holdings',
  'allowed-duplicates',
  'reports',
  'delimiter',
  'decimal',
  'date-format',
  'encoding',
  'batch',
  'env',
]);
const FLAG_OPTIONS = new Set(['commit', 'offline', 'help']);

export const USAGE = `Usage (from the repository root):
  pnpm importer [dry-run] --ca <file> --ratio-month YYYY-MM [options]
  pnpm importer commit --commit --ca <file> --ratio-month YYYY-MM [options]
  pnpm importer undo --batch <batch id>

Files (defaults under import-data/):
  --transactions <file>        transactions table CSV   (import-data/transactions.csv)
  --mapping <file>             asset mapping CSV        (import-data/asset_mapping.csv)
  --ca <file>                  certificados table CSV   (needs --ratio-month)
  --ratio-month YYYY-MM        month the CA Ratio values are the factors for
  --holdings <file>            optional: ticker,units from your spreadsheet, to diff against
  --allowed-duplicates <file>  duplicate keys you confirmed (import-data/allowed-duplicates.txt)
  --reports <dir>              where reports go         (import-data/reports)
CSV format of the transactions and CA files (normally detected):
  --delimiter comma|semicolon|tab   --decimal .|,   --date-format dmy|mdy
  --encoding utf-8|windows-1252
Other:
  --offline   dry-run without reading the database (no "already imported" checks)`;

export function parseArgs(argv: readonly string[]): Args {
  let command: Args['command'] | null = null;
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--') continue;
    if (!a.startsWith('--')) {
      if (command) throw new ArgError(`Unexpected argument "${a}"`);
      if (a !== 'dry-run' && a !== 'commit' && a !== 'undo')
        throw new ArgError(`Unknown command "${a}"`);
      command = a;
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (FLAG_OPTIONS.has(name)) {
      if (inline !== undefined) throw new ArgError(`--${name} takes no value`);
      flags.add(name);
    } else if (VALUE_OPTIONS.has(name)) {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith('--')) throw new ArgError(`--${name} needs a value`);
      values.set(name, v);
    } else {
      throw new ArgError(`Unknown option --${name}`);
    }
  }
  const commitFlag = flags.has('commit');
  return { command: command ?? (commitFlag ? 'commit' : 'dry-run'), commitFlag, values, flags };
}

function readOptions(args: Args): ReadOptions {
  const opts: ReadOptions = {};
  const d = args.values.get('delimiter');
  if (d !== undefined) {
    const map: Record<string, Delimiter> = {
      comma: ',',
      ',': ',',
      semicolon: ';',
      ';': ';',
      tab: '\t',
    };
    if (!map[d]) throw new ArgError('--delimiter must be comma, semicolon or tab');
    opts.delimiter = map[d];
  }
  const dec = args.values.get('decimal');
  if (dec !== undefined) {
    const map: Record<string, DecimalSeparator> = { '.': '.', dot: '.', ',': ',', comma: ',' };
    if (!map[dec]) throw new ArgError('--decimal must be . or ,');
    opts.decimal = map[dec];
  }
  const df = args.values.get('date-format');
  if (df !== undefined) {
    if (df !== 'dmy' && df !== 'mdy') throw new ArgError('--date-format must be dmy or mdy');
    opts.dateOrder = df as DateOrder;
  }
  const enc = args.values.get('encoding');
  if (enc !== undefined) {
    const map: Record<string, Encoding> = {
      'utf-8': 'utf-8',
      utf8: 'utf-8',
      'windows-1252': 'windows-1252',
      cp1252: 'windows-1252',
    };
    if (!map[enc.toLowerCase()]) throw new ArgError('--encoding must be utf-8 or windows-1252');
    opts.encoding = map[enc.toLowerCase()];
  }
  return opts;
}

async function openEnv(args: Args, deps: CliDeps): Promise<{ env: ImportEnv; db: ImportDb }> {
  const path = args.values.has('env')
    ? deps.resolveArg(args.values.get('env') as string)
    : deps.resolveDefault('scripts/import/.env');
  if (!(await deps.exists(path))) {
    throw new ArgError(
      `No ${path}. Copy scripts/import/.env.example to scripts/import/.env and fill it in (see docs/import.md).`,
    );
  }
  const env = validateEnv(parseDotEnv(new TextDecoder().decode(await deps.readFile(path))), path);
  const db = deps.openDb(env);
  await db.checkUser(env.userId);
  return { env, db };
}

interface Prepared {
  plan: ImportPlan;
  settings: FileSettings[];
  ratioMonth: IsoDate | null;
  reconciliation: ReturnType<typeof reconcile>;
}

async function prepare(
  args: Args,
  deps: CliDeps,
  db: ImportDb | null,
  userId: string | null,
): Promise<Prepared> {
  const path = (name: string, fallback?: string) =>
    args.values.has(name)
      ? deps.resolveArg(args.values.get(name) as string)
      : fallback
        ? deps.resolveDefault(fallback)
        : null;
  const opts = readOptions(args);

  const txPath = path('transactions', 'import-data/transactions.csv') as string;
  const mappingPath = path('mapping', 'import-data/asset_mapping.csv') as string;
  const caPath = path('ca');
  const holdingsPath = path('holdings');
  const dupPath = path('allowed-duplicates', 'import-data/allowed-duplicates.txt') as string;

  const read = async (p: string, what: string) => {
    if (!(await deps.exists(p))) throw new ArgError(`${what} not found: ${p}`);
    return deps.readFile(p);
  };
  const txBytes = await read(txPath, 'Transactions file');
  const transactions = readTransactions(txBytes, opts);
  const caBytes = caPath ? await read(caPath, 'CA file') : null;
  const ca = caBytes ? readCa(caBytes, opts) : null;
  // The format options are for the two exported tables; these two files are detected.
  const mappingFile = readMappingFile(await read(mappingPath, 'Mapping file'));
  const holdings = holdingsPath ? readHoldings(await read(holdingsPath, 'Holdings file')) : null;
  const allowed = (await deps.exists(dupPath))
    ? readAllowedDuplicates(new TextDecoder().decode(await deps.readFile(dupPath)))
    : new Set<string>();

  if (ca && !args.values.has('ratio-month'))
    throw new ArgError('--ca needs --ratio-month YYYY-MM (the month the Ratio values are for)');
  if (!ca && args.values.has('ratio-month'))
    throw new ArgError('--ratio-month is only used with --ca');
  const ratioMonth = ca ? parseMonthArg(args.values.get('ratio-month')) : null;

  const settings = [
    transactions.settings,
    ...(ca ? [ca.settings] : []),
    mappingFile.settings,
    ...(holdings ? [holdings.settings] : []),
  ];
  const state = db && userId ? await db.loadState(userId) : EMPTY_STATE;
  const plan = planImport({
    transactions,
    ca,
    mapping: buildMapping(mappingFile.records),
    mappingProblems: mappingFile.problems,
    allowedDuplicates: allowed,
    ratioMonth,
    files: {
      transactionsSha256: sha256Hex(txBytes),
      caSha256: caBytes ? sha256Hex(caBytes) : null,
    },
    settings: { files: settings, ratioMonth },
    state,
    newId: deps.newId,
  });
  if (holdings) {
    for (const p of holdings.problems)
      plan.warnings.push({ file: 'holdings', line: p.line, message: p.reasons.join('; ') });
  }
  return {
    plan,
    settings,
    ratioMonth,
    reconciliation: reconcile(plan, ratioMonth, holdings?.records ?? null),
  };
}

async function writeReports(
  args: Args,
  deps: CliDeps,
  p: Prepared,
  mode: 'dry-run' | 'commit',
  projectRef: string | null,
  batchId: string | null,
) {
  const now = deps.now();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace('.', '-')
    .replace('Z', '');
  const base = args.values.has('reports')
    ? deps.resolveArg(args.values.get('reports') as string)
    : deps.resolveDefault('import-data/reports');
  const dir = `${base}/${stamp}-${mode}`;
  await deps.mkdir(dir);
  for (const f of buildReports(p.plan, p.reconciliation, {
    mode,
    generatedAt: now.toISOString(),
    projectRef,
    batchId,
    settings: p.settings,
    ratioMonth: p.ratioMonth,
  })) {
    await deps.writeFile(`${dir}/${f.name}`, f.content);
  }
  return dir;
}

function printSummary(deps: CliDeps, p: Prepared) {
  const { plan, reconciliation: rec } = p;
  deps.print('Detected CSV settings (check these):');
  for (const s of p.settings) for (const line of describeSettings(s)) deps.print(line);
  for (const line of countLines(plan)) deps.print(line);
  deps.print('Totals of accepted rows (inserted now or already imported):');
  deps.print(`  net invested (units x order price): ${rec.totals.netInvestedEur.toFixed(2)} EUR`);
  deps.print(`  CA value (units x factor):          ${rec.totals.caValueEur.toFixed(2)} EUR`);
  if (rec.holdingsDiff) {
    const off = rec.holdingsDiff.filter((h) => h.status !== 'match').length;
    deps.print(
      `  holdings vs your spreadsheet: ${off === 0 ? 'all tickers match' : `${off} ticker(s) differ (see holdings_diff.csv)`}`,
    );
  }
  deps.print('Currency: order prices are taken as EUR with fx_rate 1. Fees are recorded as 0.');
  for (const f of plan.fatal) deps.print(`BLOCKED: ${f}`);
}

export async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.flags.has('help')) {
      deps.print(USAGE);
      return 0;
    }
    if (args.command === 'undo') return await undo(args, deps);
    if (args.command === 'commit' && !args.commitFlag) {
      throw new ArgError('commit writes to the database: add --commit to confirm you mean it');
    }
    if (args.command === 'commit') return await commit(args, deps);

    const offline = args.flags.has('offline');
    const conn = offline ? null : await openEnv(args, deps);
    const p = await prepare(args, deps, conn?.db ?? null, conn?.env.userId ?? null);
    printSummary(deps, p);
    const dir = await writeReports(args, deps, p, 'dry-run', conn?.db.projectRef ?? null, null);
    deps.print(`Reports: ${dir}`);
    deps.print(
      offline
        ? 'Dry run (offline): the database was not read or written.'
        : `Dry run against project ${conn?.db.projectRef}: nothing was written.`,
    );
    if (!canCommit(p.plan)) {
      deps.print(
        'Not ready to commit: resolve the rejected rows (rejects.csv) and run the dry run again.',
      );
      return 2;
    }
    deps.print('Ready to commit.');
    return 0;
  } catch (e) {
    deps.print(`Error: ${(e as Error).message}`);
    return 1;
  }
}

async function commit(args: Args, deps: CliDeps): Promise<number> {
  if (args.flags.has('offline')) throw new ArgError('--offline cannot be used with commit');
  const { env, db } = await openEnv(args, deps);
  const p = await prepare(args, deps, db, env.userId);
  printSummary(deps, p);
  if (!canCommit(p.plan)) {
    const dir = await writeReports(args, deps, p, 'dry-run', db.projectRef, null);
    deps.print(`Reports: ${dir}`);
    deps.print(
      'Refusing to commit: there are rejected rows or blocking problems. Nothing was written.',
    );
    return 2;
  }
  const payload = p.plan.payload;
  if (payload.transactions.length === 0 && payload.ca_factors.length === 0) {
    deps.print('Nothing new to insert. Nothing was written.');
    return 0;
  }
  deps.print(`Target Supabase project: ${db.projectRef}`);
  const answer = await deps.ask(
    `Type the project reference (${db.projectRef}) to write these rows: `,
  );
  if (answer.trim() !== db.projectRef) {
    deps.print('Not confirmed. Nothing was written.');
    return 1;
  }
  const batchId = await db.commit(env.userId, payload);
  deps.print(`Committed batch ${batchId}.`);
  deps.print(`To undo: pnpm importer undo --batch ${batchId}`);
  const info = await db.batchInfo(env.userId, batchId);
  const expected = {
    accounts: payload.accounts.length,
    assets: payload.assets.length,
    ca_series: payload.ca_series.length,
    transactions: payload.transactions.length,
    ca_subscriptions: payload.ca_subscriptions.length,
    ca_factors: payload.ca_factors.length,
  };
  const dir = await writeReports(args, deps, p, 'commit', db.projectRef, batchId);
  const mismatch =
    !info ||
    Object.entries(expected).some(([k, v]) => info.counts[k as keyof typeof expected] !== v);
  deps.print(
    mismatch
      ? 'WARNING: the rows found for this batch differ from what was sent; check the database.'
      : 'Verified: the database holds exactly the rows sent for this batch.',
  );
  deps.print(`Reports: ${dir}`);
  return mismatch ? 1 : 0;
}

async function undo(args: Args, deps: CliDeps): Promise<number> {
  const batchId = (args.values.get('batch') ?? '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId)) {
    throw new ArgError('undo needs --batch <batch id> (printed by commit, also in import_batches)');
  }
  const { env, db } = await openEnv(args, deps);
  const info = await db.batchInfo(env.userId, batchId);
  if (!info)
    throw new ArgError(`No import batch ${batchId} for this user in project ${db.projectRef}`);
  if (info.undoneAt) throw new ArgError(`Batch ${batchId} was already undone at ${info.undoneAt}`);
  deps.print(`Target Supabase project: ${db.projectRef}`);
  deps.print(`Batch ${batchId}, committed ${info.createdAt}. Rows that will be deleted:`);
  for (const [table, n] of Object.entries(info.counts)) deps.print(`  ${table}: ${n}`);
  const short = batchId.slice(0, 8);
  const answer = await deps.ask(
    `Type the first 8 characters of the batch id (${short}) to delete these rows: `,
  );
  if (answer.trim().toLowerCase() !== short) {
    deps.print('Not confirmed. Nothing was removed.');
    return 1;
  }
  const counts = await db.undo(env.userId, batchId);
  deps.print('Undone. Rows deleted:');
  for (const [table, n] of Object.entries(counts)) deps.print(`  ${table}: ${n}`);
  return 0;
}
