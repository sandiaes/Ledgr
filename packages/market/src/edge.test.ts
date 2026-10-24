import { dec } from '@ledgr/core';
import { describe, expect, it } from 'vitest';
import { CRON_SECRET_HEADER, handleJob, secretMatches } from './edge';
import { createRestDb, RestDbError } from './rest-db';
import { fakeFetch, jsonResponse, noSleep } from './test/memory-db';

const SECRET = 's'.repeat(40);
const USER = '11111111-2222-4333-8444-555555555555';
const env = {
  LEDGR_CRON_SECRET: SECRET,
  LEDGR_USER_ID: USER,
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
};
const post = (headers: Record<string, string> = {}, body?: string) =>
  new Request('https://fn.test/fx-daily', { method: 'POST', headers, body });
const now = () => new Date('2026-10-22T05:15:00Z');

describe('handleJob security', () => {
  it('refuses anything but POST, and any request without the right secret, before any work', async () => {
    const { fetch, calls } = fakeFetch([]);
    const get = await handleJob('fx', new Request('https://fn.test', { method: 'GET' }), env, {
      fetch,
    });
    expect(get.status).toBe(405);
    expect((await handleJob('fx', post(), env, { fetch })).status).toBe(401);
    expect(
      (await handleJob('fx', post({ [CRON_SECRET_HEADER]: 'wrong' }), env, { fetch })).status,
    ).toBe(401);
    expect(
      (await handleJob('fx', post({ Authorization: `Bearer ${SECRET}` }), env, { fetch })).status,
    ).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('refuses to run unconfigured: short secret, bad user id, missing key', async () => {
    const { fetch, calls } = fakeFetch([]);
    const h = { [CRON_SECRET_HEADER]: 'short' };
    expect(
      (await handleJob('fx', post(h), { ...env, LEDGR_CRON_SECRET: 'short' }, { fetch })).status,
    ).toBe(500);
    const ok = { [CRON_SECRET_HEADER]: SECRET };
    expect(
      (await handleJob('fx', post(ok), { ...env, LEDGR_USER_ID: 'me' }, { fetch })).status,
    ).toBe(500);
    expect(
      (await handleJob('fx', post(ok), { ...env, SUPABASE_SERVICE_ROLE_KEY: '' }, { fetch }))
        .status,
    ).toBe(500);
    expect(calls).toHaveLength(0);
  });

  it('accepts only an optional, bounded {"from"} body', async () => {
    const { fetch, calls } = fakeFetch([]);
    const h = { [CRON_SECRET_HEADER]: SECRET };
    for (const body of [
      'not json',
      '{"user_id":"x"}',
      '{"from":"2026-01-01"}',
      '{"from":"2026-10-22"}',
      '[1]',
    ]) {
      expect((await handleJob('fx', post(h, body), env, { fetch, now })).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('runs the job for the configured user and answers with counts only', async () => {
    const { fetch, calls } = fakeFetch([
      [/\/rest\/v1\/assets\?/, () => jsonResponse([])],
      [/\/rest\/v1\/job_runs$/, () => new Response(null, { status: 201 })],
    ]);
    const res = await handleJob(
      'fx',
      post({ [CRON_SECRET_HEADER]: SECRET }, '{"from":"2026-10-01"}'),
      env,
      {
        fetch,
        now,
        sleep: noSleep,
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      job: 'fx',
      status: 'ok',
      counts: { currencies: 0, rows: 0, failed: 0, issues_dropped: 0 },
      issues: 0,
    });
    expect(calls[0]?.url).toContain(`user_id=eq.${USER}`);
    const run = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
    expect(run).toMatchObject({ user_id: USER, job: 'fx', trigger: 'cron', status: 'ok' });
  });

  it('prices: an OpenFIGI outage during symbol resolution leaves the run partial, never 500', async () => {
    const assetRow = {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      name: 'Apple',
      ticker: 'AAPL',
      isin: 'US0378331005',
      exchange: 'XNAS',
      asset_type: 'stock',
      trading_currency: 'USD',
      price_source: 'manual',
      price_source_id: null,
    };
    const txRow = {
      id: 'bbbbbbbb-0000-4000-8000-000000000001',
      account_id: 'cccccccc-0000-4000-8000-000000000001',
      asset_id: assetRow.id,
      type: 'buy',
      trade_date: '2026-10-20',
      trade_date_precision: 'day',
      quantity: '1',
      unit_price: '200',
      amount: null,
      fees: '0',
      currency: 'EUR',
      fx_rate_to_eur: '1',
      ca_subscription_id: null,
      withholding_tax: null,
      transfer_to_account_id: null,
    };
    const { fetch, calls } = fakeFetch([
      [/openfigi/, () => new Response('down', { status: 503 })],
      [/\/rest\/v1\/assets\?/, () => jsonResponse([assetRow])],
      [/\/rest\/v1\/transactions\?/, () => jsonResponse([txRow])],
      [/\/rest\/v1\/job_runs$/, () => new Response(null, { status: 201 })],
    ]);
    const res = await handleJob(
      'prices',
      post({ [CRON_SECRET_HEADER]: SECRET }),
      { ...env, TIINGO_API_KEY: 'k' },
      { fetch, now, sleep: noSleep },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ job: 'prices', status: 'partial' });
    const run = JSON.parse(String(calls.find((c) => c.url.endsWith('/job_runs'))?.init?.body));
    expect(run.issues).toContainEqual({
      code: 'unresolved',
      assetId: assetRow.id,
      reason: 'OpenFIGI failed (openfigi: HTTP 503)',
    });
    expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(false);
  });

  it('compares secrets by digest', async () => {
    expect(await secretMatches(SECRET, SECRET)).toBe(true);
    expect(await secretMatches(`${SECRET}x`, SECRET)).toBe(false);
    expect(await secretMatches('', SECRET)).toBe(false);
  });
});

describe('createRestDb', () => {
  const opts = (key: string, fetch: ReturnType<typeof fakeFetch>['fetch']) => ({
    url: 'https://abcdefghijklmnopqrst.supabase.co/',
    apiKey: key,
    userId: USER,
    fetch,
  });

  it('filters every read on the user, reads numerics as text, and pages', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      asset_id: 'a',
      price_date: `2024-01-01`,
      close: i === 0 ? '0.123456789012345678' : '1',
      currency: 'USD',
      split_factor: null,
    }));
    let n = 0;
    const { fetch, calls } = fakeFetch([[/prices/, () => jsonResponse(n++ === 0 ? page : [])]]);
    const db = createRestDb(opts('sb_secret_abc', fetch));
    const rows = await db.loadPrices({ from: '2024-01-01' });
    expect(rows).toHaveLength(1000);
    expect(rows[0]?.close.toString()).toBe('0.123456789012345678');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain(`user_id=eq.${USER}`);
    expect(calls[0]?.url).toContain('close::text');
    expect(calls[1]?.url).toContain('offset=1000');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.apikey).toBe('sb_secret_abc');
    expect(headers.Authorization).toBe('Bearer sb_secret_abc');
  });

  it('sets user_id on every upserted row', async () => {
    const { fetch, calls } = fakeFetch([[/fx_rates/, () => new Response(null, { status: 201 })]]);
    const db = createRestDb(opts('aaa.bbb.ccc', fetch));
    await db.upsertFx([{ currency: 'USD', date: '2024-01-02', rateToEur: '0.9', source: 'ecb' }]);
    expect(calls[0]?.url).toContain('on_conflict=user_id,currency,rate_date');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual([
      {
        currency: 'USD',
        rate_date: '2024-01-02',
        rate_to_eur: '0.9',
        source: 'ecb',
        user_id: USER,
      },
    ]);
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer aaa.bbb.ccc',
    );
  });

  it('writes snapshots rounded to 18 decimals and reports errors without row details', async () => {
    const { fetch, calls } = fakeFetch([
      [
        /portfolio_snapshots/,
        () =>
          jsonResponse({ code: '23514', message: 'Failing row contains (..., 1234.56, ...)' }, 400),
      ],
    ]);
    const db = createRestDb(opts('sb_secret_abc', fetch));
    const err = await db
      .upsertSnapshots([
        {
          snapshotDate: '2024-01-02',
          totalValueEur: dec('1').div(3),
          totalCostBasisEur: dec('1'),
          netContributionsEur: dec('1'),
          cashEur: null,
          stockValueEur: dec('0'),
          etfValueEur: dec('0'),
          cryptoValueEur: dec('0'),
          certificadoAforroValueEur: dec('0'),
          stale: false,
          staleAssetCount: 0,
          caValueSource: null,
          caValueAsOf: null,
          caValueAgeDays: null,
          caValueStale: false,
          valuationFlags: [],
        },
      ])
      .catch((e: unknown) => e);
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>[];
    expect(sent[0]?.total_value_eur).toBe('0.333333333333333333');
    expect(err).toBeInstanceOf(RestDbError);
    expect((err as Error).message).toBe('Supabase portfolio_snapshots: HTTP 400 (23514)');
  });
});
