import { describe, expect, it } from 'vitest';
import { assertPublicKey } from './publicKey';

const jwt = (claims: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.sig`;

describe('assertPublicKey', () => {
  it('accepts publishable and legacy anon keys', () => {
    expect(() => assertPublicKey('sb_publishable_abc')).not.toThrow();
    expect(() => assertPublicKey(jwt({ role: 'anon' }))).not.toThrow();
  });

  it('rejects secret and service-role keys', () => {
    expect(() => assertPublicKey('sb_secret_abc')).toThrow(/secret/);
    expect(() => assertPublicKey(jwt({ role: 'service_role' }))).toThrow(/non-anon/);
  });

  it('rejects empty or unknown keys', () => {
    expect(() => assertPublicKey('')).toThrow(/^SUPABASE_ANON_KEY is not set/);
    expect(() => assertPublicKey(undefined, 'EXPO_PUBLIC_SUPABASE_ANON_KEY')).toThrow(
      /^EXPO_PUBLIC_SUPABASE_ANON_KEY is not set/,
    );
    expect(() => assertPublicKey('nonsense')).toThrow(/unrecognised/);
    expect(() => assertPublicKey('a.!!!.c')).toThrow(/unrecognised/);
  });
});
