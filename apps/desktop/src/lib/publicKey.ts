/**
 * Refuses anything that is not a public client key: new-style `sb_secret_...`
 * keys, and legacy JWT keys whose `role` claim is not `anon`.
 */
export function assertPublicKey(key: string): void {
  if (!key) throw new Error('VITE_SUPABASE_ANON_KEY is not set');
  if (key.startsWith('sb_secret_')) throw new Error('Refusing to use a secret key in a client');
  if (key.startsWith('sb_publishable_')) return;

  const payload = key.split('.')[1];
  if (!payload) throw new Error('Unrecognised Supabase key format');
  const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
    role?: string;
  };
  if (claims.role !== 'anon') throw new Error('Refusing to use a non-anon key in a client');
}
