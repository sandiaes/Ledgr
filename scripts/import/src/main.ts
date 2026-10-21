// Entry point: pnpm importer ... (see docs/import.md). Local use only: it reads the
// service-role key from scripts/import/.env and must never be bundled into an app.
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { run } from './cli';
import { print } from './console';
import { SupabaseImportDb } from './supabase-db';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

process.exitCode = await run(process.argv.slice(2), {
  resolveArg: (p) => resolve(process.cwd(), p),
  resolveDefault: (p) => resolve(repoRoot, p),
  readFile: async (p) => new Uint8Array(await readFile(p)),
  exists: (p) =>
    access(p).then(
      () => true,
      () => false,
    ),
  writeFile: (p, content) => writeFile(p, content, 'utf8'),
  mkdir: (p) => mkdir(p, { recursive: true }).then(() => undefined),
  openDb: (env) => new SupabaseImportDb(env),
  ask: async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
  print,
  now: () => new Date(),
  newId: randomUUID,
});
