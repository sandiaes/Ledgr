/**
 * A short code for an error shown to the owner: the Supabase/PostgREST code or HTTP status,
 * never a message (which can quote values).
 */
export function errorCode(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; status?: unknown; name?: unknown };
    if (typeof o.code === 'string' && o.code) return o.code;
    if (typeof o.status === 'number') return `HTTP ${o.status}`;
    if (typeof o.name === 'string' && o.name) return o.name;
  }
  return 'unknown';
}
