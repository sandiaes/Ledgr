import { jwtClaims } from './jwt';

/**
 * Refuses anything that is not a public client key: new-style `sb_secret_...`
 * keys, and legacy JWT keys whose `role` claim is not `anon`. `variable` names the
 * setting in the messages (never the key itself).
 */
export function assertPublicKey(key: string | undefined, variable = 'SUPABASE_ANON_KEY'): void {
  if (!key) throw new Error(`${variable} is not set`);
  if (key.startsWith('sb_secret_')) throw new Error('Refusing to use a secret key in a client');
  if (key.startsWith('sb_publishable_')) return;

  const claims = jwtClaims(key);
  if (!claims) throw new Error(`${variable}: unrecognised Supabase key format`);
  if (claims.role !== 'anon') throw new Error('Refusing to use a non-anon key in a client');
}
