import { describe, expect, it } from 'vitest';
import { EnvError, parseDotEnv, validateEnv } from './env';

const REF = 'abcdefghijklmnopqrst';
const URL_OK = `https://${REF}.supabase.co`;
const USER = '11111111-1111-4111-8111-111111111111';
const jwt = (payload: object) =>
  ['{"alg":"HS256","typ":"JWT"}', JSON.stringify(payload)]
    .map((p) => Buffer.from(p).toString('base64url'))
    .join('.') + '.sig';
const check = (vars: Record<string, string>) => validateEnv(vars, '.env');

describe('import .env', () => {
  it('accepts a secret key or a service_role JWT for the same project', () => {
    expect(
      check({
        SUPABASE_URL: URL_OK + '/',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_' + 'x'.repeat(40),
        LEDGR_USER_ID: USER,
      }),
    ).toEqual({
      url: URL_OK,
      projectRef: REF,
      serviceRoleKey: 'sb_secret_' + 'x'.repeat(40),
      userId: USER,
    });
    expect(
      check({
        SUPABASE_URL: URL_OK,
        SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: REF }),
        LEDGR_USER_ID: USER,
      }).projectRef,
    ).toBe(REF);
  });

  it.each([
    [{ SUPABASE_URL: URL_OK, LEDGR_USER_ID: USER }, /SUPABASE_SERVICE_ROLE_KEY missing/],
    [
      {
        SUPABASE_URL: 'https://example.com',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_' + 'x'.repeat(40),
        LEDGR_USER_ID: USER,
      },
      /SUPABASE_URL should look like/,
    ],
    [
      {
        SUPABASE_URL: URL_OK,
        SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_abcdefabcdefabcdef',
        LEDGR_USER_ID: USER,
      },
      /publishable/,
    ],
    [
      {
        SUPABASE_URL: URL_OK,
        SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'anon', ref: REF }),
        LEDGR_USER_ID: USER,
      },
      /anon key/,
    ],
    [
      {
        SUPABASE_URL: URL_OK,
        SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: 'zzzzzzzzzzzzzzzzzzzz' }),
        LEDGR_USER_ID: USER,
      },
      /belongs to project zzzz/,
    ],
    [
      {
        SUPABASE_URL: URL_OK,
        SUPABASE_SERVICE_ROLE_KEY: 'paste-your-key-here',
        LEDGR_USER_ID: USER,
      },
      /not a Supabase key/,
    ],
    [
      { SUPABASE_URL: URL_OK, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_short', LEDGR_USER_ID: USER },
      /truncated/,
    ],
    [
      {
        SUPABASE_URL: URL_OK,
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_' + 'x'.repeat(40),
        LEDGR_USER_ID: 'me@example.com',
      },
      /LEDGR_USER_ID must be/,
    ],
  ])('refuses %o', (vars, message) => {
    expect(() => check(vars)).toThrow(EnvError);
    expect(() => check(vars)).toThrow(message);
  });

  it('never puts the key in an error message', () => {
    const key = jwt({ role: 'anon', secret: 'do-not-print' });
    try {
      check({ SUPABASE_URL: URL_OK, SUPABASE_SERVICE_ROLE_KEY: key, LEDGR_USER_ID: USER });
    } catch (e) {
      expect((e as Error).message).not.toContain(key);
    }
  });

  it('parses KEY=value lines with comments and quotes', () => {
    expect(parseDotEnv('\uFEFF# c\nA=1\r\nexport B = "two words"\nC=\'3\'\n\nbad line\n')).toEqual({
      A: '1',
      B: 'two words',
      C: '3',
    });
  });
});
