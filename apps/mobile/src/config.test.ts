import { checkConfig } from './config';

const jwt = (claims: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const URL = 'https://abcdefghijklmnopqrst.supabase.co';

describe('checkConfig', () => {
  it('accepts the URL and an anon or publishable key', () => {
    expect(
      checkConfig({
        EXPO_PUBLIC_SUPABASE_URL: URL,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon' }),
      }),
    ).toMatchObject({ ok: true, projectRef: 'abcdefghijklmnopqrst' });
    expect(
      checkConfig({
        EXPO_PUBLIC_SUPABASE_URL: `${URL}/`,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_x',
      }),
    ).toMatchObject({ ok: true, url: URL });
  });

  it('refuses a secret or service-role key in the anon slot, naming the variable only', () => {
    const secret = 'sb_secret_0123456789';
    const bad = checkConfig({
      EXPO_PUBLIC_SUPABASE_URL: URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: secret,
    });
    expect(bad).toEqual({
      ok: false,
      problem: 'EXPO_PUBLIC_SUPABASE_ANON_KEY: Refusing to use a secret key in a client.',
    });
    const role = checkConfig({
      EXPO_PUBLIC_SUPABASE_URL: URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'service_role' }),
    });
    expect(role.ok).toBe(false);
  });

  it('refuses to start when a service-role, secret or provider key is configured at all', () => {
    for (const name of [
      'EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
      'EXPO_PUBLIC_SUPABASE_SECRET_KEY',
      'EXPO_PUBLIC_TIINGO_API_KEY',
    ] as const) {
      const r = checkConfig({
        EXPO_PUBLIC_SUPABASE_URL: URL,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_x',
        [name]: 'value-that-must-not-appear',
      });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.problem).toContain(name);
      expect(JSON.stringify(r)).not.toContain('value-that-must-not-appear');
    }
  });

  it('refuses a missing or malformed URL or key', () => {
    expect(checkConfig({}).ok).toBe(false);
    expect(
      checkConfig({
        EXPO_PUBLIC_SUPABASE_URL: 'http://localhost',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_x',
      }).ok,
    ).toBe(false);
    expect(checkConfig({ EXPO_PUBLIC_SUPABASE_URL: URL }).ok).toBe(false);
  });
});
