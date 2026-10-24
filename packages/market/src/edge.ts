// The Edge Functions' handler (bundled into supabase/functions/_shared by
// `pnpm functions:build`). Every function is deployed with --no-verify-jwt, because the
// anon key is public; instead each request must carry x-ledgr-cron-secret, compared in
// constant time with the LEDGR_CRON_SECRET secret, before anything else happens.
// The user id comes from the LEDGR_USER_ID secret, never from the request.
// Responses and logs hold counts only.
import {
  addDays,
  daysBetween,
  DEFAULT_CA_MAX_AGE_DAYS,
  DEFAULT_STALE_AFTER_DAYS,
  type IsoDate,
} from '@ledgr/core';
import { realSleep, type Fetch, type Sleep } from './http';
import { runRecorded, type JobContext } from './jobs/common';
import { runFx } from './jobs/fx';
import { runPrices } from './jobs/prices';
import { runSnapshots } from './jobs/snapshots';
import { createProviders } from './providers';
import { createRestDb } from './rest-db';

export { handleValueNow } from './value-now';

export type EdgeJob = 'fx' | 'prices' | 'snapshots';

export const CRON_SECRET_HEADER = 'x-ledgr-cron-secret';
/** A body `from` may reach back at most this far (bounds the work one call can cause). */
export const MAX_FROM_DAYS = 62;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface EdgeDeps {
  fetch?: Fetch;
  sleep?: Sleep;
  now?: () => Date;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Compares SHA-256 digests byte by byte without an early exit. */
export async function secretMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number);
  return diff === 0;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error('bad_config');
  return Number(value.trim());
}

export async function handleJob(
  job: EdgeJob,
  req: Request,
  env: Record<string, string | undefined>,
  deps: EdgeDeps = {},
): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const expected = env.LEDGR_CRON_SECRET ?? '';
  if (expected.length < 32) return json(500, { error: 'not_configured' });
  if (!(await secretMatches(req.headers.get(CRON_SECRET_HEADER) ?? '', expected))) {
    return json(401, { error: 'unauthorized' });
  }

  const userId = (env.LEDGR_USER_ID ?? '').trim();
  const url = (env.SUPABASE_URL ?? '').trim();
  // LEDGR_SERVICE_KEY lets you use an sb_secret_ key when the legacy keys are disabled.
  const serviceKey = (env.LEDGR_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  let staleAfterDays: number;
  let caMaxAgeDays: number;
  try {
    staleAfterDays = positiveInt(env.LEDGR_STALE_AFTER_DAYS, DEFAULT_STALE_AFTER_DAYS);
    caMaxAgeDays = positiveInt(env.LEDGR_CA_MAX_AGE_DAYS, DEFAULT_CA_MAX_AGE_DAYS);
  } catch {
    return json(500, { error: 'not_configured' });
  }
  if (!UUID.test(userId) || !url.startsWith('https://') || serviceKey === '') {
    return json(500, { error: 'not_configured' });
  }

  const now = deps.now ?? (() => new Date());
  const today: IsoDate = now().toISOString().slice(0, 10);
  let from: IsoDate | undefined;
  const text = await req.text();
  if (text.trim() !== '') {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'bad_request' });
    }
    const keys = body && typeof body === 'object' ? Object.keys(body) : null;
    if (!keys || keys.some((k) => k !== 'from')) return json(400, { error: 'bad_request' });
    const value = (body as { from?: unknown }).from;
    if (value !== undefined) {
      if (typeof value !== 'string' || !ISO.test(value)) return json(400, { error: 'bad_request' });
      try {
        const age = daysBetween(value, today);
        if (age < 1 || age > MAX_FROM_DAYS) return json(400, { error: 'bad_request' });
      } catch {
        return json(400, { error: 'bad_request' });
      }
      from = value;
    }
  }

  const fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  const http = { fetch: fetchFn, sleep: deps.sleep ?? realSleep };
  const ctx: JobContext = {
    db: createRestDb({ url, apiKey: serviceKey, userId: userId.toLowerCase(), fetch: fetchFn }),
    http,
    providers: createProviders(
      http,
      { tiingo: env.TIINGO_API_KEY, alphavantage: env.ALPHAVANTAGE_API_KEY },
      () => today,
    ),
    today,
    trigger: 'cron',
    staleAfterDays,
    caMaxAgeDays,
    now,
  };

  const run = await runRecorded(ctx, job, () => {
    if (job === 'fx') return runFx(ctx, { from });
    if (job === 'prices') {
      const openFigiKey = env.OPENFIGI_API_KEY?.trim() || undefined;
      return runPrices(ctx, { mode: 'daily', from, resolve: { openFigiKey } });
    }
    return runSnapshots(ctx, { from, to: addDays(today, -1) });
  });
  return json(run.status === 'failed' ? 500 : 200, {
    job,
    status: run.status,
    counts: run.counts,
    issues: run.issues.length,
  });
}
