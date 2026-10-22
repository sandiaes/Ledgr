// The value-now Edge Function's handler (bundled with the daily jobs). Called by the app
// with the owner's session (supabase.functions.invoke sends it). The session is checked by
// Supabase Auth, must be MFA (aal2) and must belong to LEDGR_USER_ID; every database call
// then uses that same session token, so RLS applies (no service role here). Provider keys
// come from secrets. The response holds the owner's own values; nothing is logged.
import {
  DEFAULT_CA_MAX_AGE_DAYS,
  DEFAULT_STALE_AFTER_DAYS,
  MissingValuationError,
  type IsoDate,
} from '@ledgr/core';
import type { EdgeDeps } from './edge';
import { realSleep } from './http';
import { localDate, runValueNow } from './live';
import { createProviders } from './providers';
import { createRestDb } from './rest-db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DEFAULT_TIME_ZONE = 'Europe/Lisbon';

/** CORS headers for an allowed browser origin (LEDGR_ALLOWED_ORIGINS), else none. */
function corsFor(req: Request, env: Record<string, string | undefined>): Record<string, string> {
  const origin = req.headers.get('Origin');
  const allowed = (env.LEDGR_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
}

function reply(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** The claims of a JWT whose signature Supabase Auth has already accepted. */
function claims(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) =>
      c.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const v = (value ?? '').trim();
  return /^\d+$/.test(v) ? Number(v) : fallback;
}

export async function handleValueNow(
  req: Request,
  env: Record<string, string | undefined>,
  deps: EdgeDeps = {},
): Promise<Response> {
  const cors = corsFor(req, env);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: Object.keys(cors).length > 0 ? 204 : 403, headers: cors });
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return reply(405, { error: 'method_not_allowed' }, cors);
  }

  const token = /^Bearer\s+(\S+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) return reply(401, { error: 'unauthorized' }, cors);

  const url = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  // LEDGR_ANON_KEY lets you use an sb_publishable_ key when the legacy keys are disabled.
  const anonKey = (env.LEDGR_ANON_KEY || env.SUPABASE_ANON_KEY || '').trim();
  const userId = (env.LEDGR_USER_ID ?? '').trim().toLowerCase();
  if (!url.startsWith('https://') || anonKey === '' || !UUID.test(userId)) {
    return reply(500, { error: 'not_configured' }, cors);
  }

  const fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  // Supabase Auth checks the signature, expiry and that the session still exists.
  const auth = await fetchFn(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  await auth.body?.cancel();
  if (!auth.ok) return reply(401, { error: 'unauthorized' }, cors);
  const c = claims(token);
  if (!c || String(c.sub ?? '').toLowerCase() !== userId)
    return reply(403, { error: 'forbidden' }, cors);
  if (c.aal !== 'aal2') return reply(403, { error: 'mfa_required' }, cors);

  const now = deps.now ?? (() => new Date());
  const timeZone = (env.LEDGR_TIME_ZONE ?? '').trim() || DEFAULT_TIME_ZONE;
  const http = { fetch: fetchFn, sleep: deps.sleep ?? realSleep };
  try {
    const today: IsoDate = localDate(now(), timeZone);
    const result = await runValueNow({
      db: createRestDb({ url, apiKey: anonKey, accessToken: token, userId, fetch: fetchFn }),
      providers: createProviders(
        http,
        { tiingo: env.TIINGO_API_KEY, alphavantage: env.ALPHAVANTAGE_API_KEY },
        () => today,
      ),
      now,
      timeZone,
      staleAfterDays: positiveInt(env.LEDGR_STALE_AFTER_DAYS, DEFAULT_STALE_AFTER_DAYS),
      caMaxAgeDays: positiveInt(env.LEDGR_CA_MAX_AGE_DAYS, DEFAULT_CA_MAX_AGE_DAYS),
    });
    return reply(200, result, cors);
  } catch (e) {
    if (e instanceof MissingValuationError) return reply(503, { error: 'missing_fx' }, cors);
    return reply(500, { error: 'failed' }, cors);
  }
}
