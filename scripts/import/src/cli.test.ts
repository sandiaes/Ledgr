// The commands end to end, with an in-memory file system and database.
import { beforeEach, describe, expect, it } from 'vitest';
import { run, type CliDeps } from './cli';
import { completeMappingText, editLines, fixtureText, utf8 } from './test/fixtures';
import { MemoryDb } from './test/memory-db';

const USER = '11111111-1111-4111-8111-111111111111';
const ENV = `SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_${'x'.repeat(40)}\nLEDGR_USER_ID=${USER}\n`;
const FILES = ['--ca', 'import-data/ca.csv', '--ratio-month', '2026-10'];

let files: Map<string, Uint8Array>;
let db: MemoryDb;
let out: string[];
let answers: string[];
let asked: string[];

function deps(): CliDeps {
  return {
    resolveArg: (p) => (p.startsWith('/') ? p : `/repo/${p}`),
    resolveDefault: (p) => `/repo/${p}`,
    readFile: async (p) => {
      const f = files.get(p);
      if (!f) throw new Error(`ENOENT ${p}`);
      return f;
    },
    exists: async (p) => files.has(p),
    writeFile: async (p, c) => void files.set(p, utf8(c)),
    mkdir: async () => undefined,
    openDb: () => db,
    ask: async (q) => {
      asked.push(q);
      return answers.shift() ?? '';
    },
    print: (l) => void out.push(l),
    now: () => new Date('2026-10-21T12:00:00.123Z'),
    newId: (() => {
      let i = 0;
      return () => `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}`;
    })(),
  };
}

const cli = (...argv: string[]) => run(argv, deps());
const text = () => out.join('\n');
const report = (name: string) => {
  const key = [...files.keys()]
    .filter((k) => k.endsWith(`/${name}`))
    .sort()
    .at(-1);
  return key ? new TextDecoder().decode(files.get(key)) : null;
};

beforeEach(() => {
  files = new Map([
    ['/repo/import-data/transactions.csv', utf8(fixtureText('sample_transactions.csv'))],
    ['/repo/import-data/ca.csv', utf8(fixtureText('sample_ca.csv'))],
    ['/repo/import-data/asset_mapping.csv', utf8(completeMappingText())],
    ['/repo/scripts/import/.env', utf8(ENV)],
  ]);
  db = new MemoryDb();
  db.users.add(USER);
  out = [];
  answers = [];
  asked = [];
});

describe('dry-run', () => {
  it('prints settings, counts and totals but no individual financial values', async () => {
    expect(await cli('--offline', ...FILES)).toBe(0);
    const t = text();
    expect(t).toMatch(/transactions: encoding utf-8, delimiter comma, decimal "\."/);
    expect(t).toMatch(/transactions file: 140 read, 140 to insert, 0 skip, 0 reject/);
    expect(t).toMatch(/net invested \(units x order price\): 138010\.89 EUR/);
    expect(t).toMatch(/CA value \(units x factor\): +64948\.00 EUR/);
    expect(t).toMatch(/order prices are taken as EUR with fx_rate 1/);
    for (const value of [
      '10151.73',
      '169.1955',
      '1.10482',
      '36000',
      '0.2949738258',
      '39773.52',
      '26519',
    ]) {
      expect(t).not.toContain(value);
    }
    expect(report('rows.csv')).toContain('10151.73');
    expect(report('reconciliation_ca.csv')).toContain('39773.52');
    expect(db.data.transactions).toEqual([]);
  });

  it('writes rejects with reasons, and exits non-zero', async () => {
    files.set(
      '/repo/import-data/transactions.csv',
      utf8(
        editLines(fixtureText('sample_transactions.csv'), {
          2: '2021-01-01,Stocks,Buy,GME,60,169.1955,9999.99,Degiro',
        }),
      ),
    );
    expect(await cli('--offline', ...FILES)).toBe(2);
    expect(text()).toMatch(/value mismatch: 1/);
    expect(text()).not.toContain('9999.99');
    expect(report('rejects.csv')).toMatch(/transactions,2,value mismatch,Order Value differs/);
  });

  it('reads the database for already-imported rows unless --offline', async () => {
    expect(await cli(...FILES)).toBe(0);
    expect(text()).toMatch(/against project abcdefghijklmnopqrst: nothing was written/);
    files.delete('/repo/scripts/import/.env');
    expect(await cli(...FILES)).toBe(1);
    expect(text()).toMatch(/Copy scripts\/import\/.env.example/);
  });

  it('refuses a wrong-looking key', async () => {
    files.set(
      '/repo/scripts/import/.env',
      utf8(ENV.replace(/sb_secret_x+/, 'sb_publishable_abcdefghijklmnop')),
    );
    expect(await cli(...FILES)).toBe(1);
    expect(text()).toMatch(/publishable/);
  });

  it('a CA file needs --ratio-month', async () => {
    expect(await cli('--offline', '--ca', 'import-data/ca.csv')).toBe(1);
    expect(text()).toMatch(/--ca needs --ratio-month/);
  });
});

describe('commit', () => {
  it('requires the explicit --commit flag', async () => {
    expect(await cli('commit', ...FILES)).toBe(1);
    expect(text()).toMatch(/add --commit/);
    expect(db.data.batches).toEqual([]);
  });

  it('prints the project, asks for the project reference, and writes nothing without it', async () => {
    answers = ['yes'];
    expect(await cli('commit', '--commit', ...FILES)).toBe(1);
    expect(text()).toMatch(/Target Supabase project: abcdefghijklmnopqrst/);
    expect(asked[0]).toMatch(/Type the project reference \(abcdefghijklmnopqrst\)/);
    expect(text()).toMatch(/Not confirmed\. Nothing was written\./);
    expect(db.data.batches).toEqual([]);
  });

  it('writes the batch after confirmation, verifies it, and refuses the same files again', async () => {
    answers = ['abcdefghijklmnopqrst'];
    expect(await cli('--commit', ...FILES)).toBe(0);
    expect(db.data.transactions).toHaveLength(137);
    expect(db.data.transactions.every((t) => t.userId === USER)).toBe(true);
    expect(text()).toMatch(/Verified: the database holds exactly the rows sent/);
    const batch = db.data.batches[0]!.id;
    expect(text()).toContain(`pnpm importer undo --batch ${batch}`);
    expect(report('summary.txt')).toContain(`Batch: ${batch}`);

    out = [];
    answers = ['abcdefghijklmnopqrst'];
    expect(await cli('--commit', ...FILES)).toBe(2);
    expect(text()).toMatch(/BLOCKED: The transactions file was already imported/);
    expect(asked).toHaveLength(1);
    expect(db.data.batches).toHaveLength(1);
  });

  it('refuses while any row is rejected', async () => {
    files.set('/repo/import-data/asset_mapping.csv', utf8(fixtureText('asset_mapping.csv')));
    answers = ['abcdefghijklmnopqrst'];
    expect(await cli('--commit', ...FILES)).toBe(2);
    expect(text()).toMatch(/Refusing to commit/);
    expect(asked).toEqual([]);
    expect(db.data.batches).toEqual([]);
  });
});

describe('undo', () => {
  it('shows what will go, asks for the batch id, then removes exactly that batch', async () => {
    answers = ['abcdefghijklmnopqrst'];
    await cli('--commit', ...FILES);
    const batch = db.data.batches[0]!.id;

    out = [];
    answers = ['nope'];
    expect(await cli('undo', '--batch', batch)).toBe(1);
    expect(text()).toMatch(/transactions: 137/);
    expect(db.data.transactions).toHaveLength(137);

    answers = [batch.slice(0, 8)];
    expect(await cli('undo', '--batch', batch)).toBe(0);
    expect(db.data.transactions).toEqual([]);
    expect(db.data.batches[0]!.undoneAt).not.toBeNull();

    out = [];
    expect(await cli('undo', '--batch', batch)).toBe(1);
    expect(text()).toMatch(/already undone/);
  });

  it('needs a batch id that exists for this user', async () => {
    expect(await cli('undo')).toBe(1);
    expect(await cli('undo', '--batch', '99999999-9999-4999-8999-999999999999')).toBe(1);
    expect(text()).toMatch(/No import batch 99999999/);
  });
});

describe('arguments', () => {
  it('rejects unknown options and bad values', async () => {
    expect(await cli('--offline', '--frobnicate')).toBe(1);
    expect(await cli('--offline', '--decimal', 'x')).toBe(1);
    expect(await cli('--offline', '--ca', 'import-data/ca.csv', '--ratio-month', '2026-13')).toBe(
      1,
    );
    expect(text()).toMatch(
      /Unknown option --frobnicate[\s\S]*--decimal must be[\s\S]*--ratio-month must be YYYY-MM/,
    );
  });

  it('accepts --flag=value and explicit CSV settings', async () => {
    expect(
      await cli(
        '--offline',
        '--ca=import-data/ca.csv',
        '--ratio-month=2026-10',
        '--delimiter',
        'comma',
        '--decimal',
        '.',
        '--encoding',
        'utf-8',
      ),
    ).toBe(0);
    expect(text()).toMatch(/decimal "\." \(given with --decimal\)/);
  });
});
