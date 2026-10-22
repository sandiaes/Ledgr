import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonResponse } from './test/memory-db';
import { handleValueNow } from './value-now';

const USER = '11111111-2222-4333-8444-555555555555';
const env = {
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-never-used-here',
  LEDGR_USER_ID: USER,
  LEDGR_ALLOWED_ORIGINS: 'http://localhost:5173, tauri://localhost',
};
const b64url = (o: object) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: object) => `${b64url({ alg: 'ES256' })}.${b64url(claims)}.sig`;
const TOKEN = jwt({ sub: USER, aal: 'aal2', role: 'authenticated' });
const post = (headers: Record<string, string>) =>
  new Request('https://fn.test/value-now', { method: 'POST', headers });
const now = () => new Date('2026-10-24T10:00:00Z');

function backend(authStatus = 200) {
  return fakeFetch([
    [/\/auth\/v1\/user$/, () => jsonResponse({ id: USER }, authStatus)],
    [/\/rest\/v1\//, () => jsonResponse([])],
  ]);
}

describe('handleValueNow', () => {
  it('answers CORS preflight only for allowed origins', async () => {
    const ok = await handleValueNow(
      new Request('https://fn.test', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
      env,
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    const no = await handleValueNow(
      new Request('https://fn.test', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.test' },
      }),
      env,
    );
    expect(no.status).toBe(403);
    expect(no.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('needs a session that Supabase Auth accepts, with MFA, of the owner', async () => {
    const { fetch, calls } = backend();
    expect((await handleValueNow(post({}), env, { fetch, now })).status).toBe(401);
    expect(calls).toHaveLength(0);

    const rejected = backend(401);
    expect(
      (
        await handleValueNow(post({ Authorization: `Bearer ${TOKEN}` }), env, {
          fetch: rejected.fetch,
          now,
        })
      ).status,
    ).toBe(401);
    expect(rejected.calls).toHaveLength(1); // only the auth check

    const aal1 = backend();
    const r1 = await handleValueNow(
      post({ Authorization: `Bearer ${jwt({ sub: USER, aal: 'aal1' })}` }),
      env,
      { fetch: aal1.fetch, now },
    );
    expect(r1.status).toBe(403);
    expect(await r1.json()).toEqual({ error: 'mfa_required' });
    expect(aal1.calls).toHaveLength(1);

    const other = backend();
    const r2 = await handleValueNow(
      post({
        Authorization: `Bearer ${jwt({ sub: '99999999-2222-4333-8444-555555555555', aal: 'aal2' })}`,
      }),
      env,
      { fetch: other.fetch, now },
    );
    expect(r2.status).toBe(403);
    expect(other.calls).toHaveLength(1);
  });

  it('reads with the caller session (RLS applies), never the service key, and is not cached', async () => {
    const { fetch, calls } = backend();
    const res = await handleValueNow(
      post({ Authorization: `Bearer ${TOKEN}`, Origin: 'tauri://localhost' }),
      env,
      { fetch, now },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('tauri://localhost');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      valuationDate: '2026-10-24',
      totalValueEur: '0',
      refreshed: 0,
      assets: [],
    });
    const rest = calls.filter((c) => c.url.includes('/rest/v1/'));
    expect(rest.length).toBeGreaterThan(0);
    for (const c of rest) {
      const h = c.init?.headers as Record<string, string>;
      expect(h.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(h.apikey).toBe('anon-key');
      expect(c.url).toContain(`user_id=eq.${USER}`);
    }
    expect(JSON.stringify(calls)).not.toContain('service-key-never-used-here');
  });

  it('refuses to run unconfigured', async () => {
    const { fetch, calls } = backend();
    const res = await handleValueNow(
      post({ Authorization: `Bearer ${TOKEN}` }),
      { ...env, SUPABASE_ANON_KEY: '' },
      { fetch, now },
    );
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(0);
  });
});
