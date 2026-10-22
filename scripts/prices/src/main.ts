// Entry point: pnpm prices ... (see docs/prices.md). Local use only: it reads the
// service-role key and provider keys from scripts/prices/.env and must never be bundled
// into an app. Behind a TLS-inspecting proxy, start Node with your company's root
// certificate (NODE_EXTRA_CA_CERTS or --use-system-ca, see the runbook).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createRestDb, realSleep } from '@ledgr/market';
import { createClient } from '@supabase/supabase-js';
import { run } from './cli';
import { print } from './console';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

process.exitCode = await run(process.argv.slice(2), {
  envPath: `${repoRoot}scripts/prices/.env`,
  reportsRoot: `${repoRoot}prices-data/reports`,
  readText: (p) => readFile(p, 'utf8').catch(() => null),
  writeFile: (p, content) => writeFile(p, content, 'utf8'),
  mkdir: (p) => mkdir(p, { recursive: true }).then(() => undefined),
  openDb: (env) =>
    createRestDb({
      url: env.url,
      apiKey: env.serviceRoleKey,
      userId: env.userId,
      fetch: (u, i) => fetch(u, i),
    }),
  checkUser: async (env) => {
    const client = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.admin.getUserById(env.userId);
    if (error || !data.user) {
      throw new Error(`LEDGR_USER_ID was not found in project ${env.projectRef}`);
    }
  },
  fetch: (u, i) => fetch(u, i),
  sleep: realSleep,
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
});
