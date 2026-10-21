// scripts/import/.env (git-ignored): the service-role key lives only here, on your machine.
// Refuses to run when the URL, key or user id is missing or looks wrong. Never prints the key.

export class EnvError extends Error {
  override name = 'EnvError';
}

export interface ImportEnv {
  url: string;
  projectRef: string;
  serviceRoleKey: string;
  userId: string;
}

/** KEY=value lines; '#' comments; optional quotes around the value. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = (m[2] as string).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[m[1] as string] = value;
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1] as string, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function validateEnv(vars: Record<string, string | undefined>, envPath: string): ImportEnv {
  const url = (vars.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = (vars.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const userId = (vars.LEDGR_USER_ID ?? '').trim();
  const missing = [
    ['SUPABASE_URL', url],
    ['SUPABASE_SERVICE_ROLE_KEY', key],
    ['LEDGR_USER_ID', userId],
  ]
    .filter(([, v]) => v === '')
    .map(([k]) => k);
  if (missing.length > 0)
    throw new EnvError(`${envPath}: ${missing.join(', ')} missing or empty. See docs/import.md.`);

  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(url);
  if (!m)
    throw new EnvError(
      `${envPath}: SUPABASE_URL should look like https://<20-letter project ref>.supabase.co`,
    );
  const projectRef = m[1] as string;

  if (key.startsWith('sb_publishable_')) {
    throw new EnvError(
      `${envPath}: SUPABASE_SERVICE_ROLE_KEY is the publishable (client) key. Use the secret key.`,
    );
  }
  if (key.startsWith('sb_secret_')) {
    if (key.length < 30)
      throw new EnvError(`${envPath}: SUPABASE_SERVICE_ROLE_KEY looks truncated`);
  } else {
    const payload = jwtPayload(key);
    if (!payload)
      throw new EnvError(
        `${envPath}: SUPABASE_SERVICE_ROLE_KEY is not a Supabase key (sb_secret_... or a service_role JWT)`,
      );
    if (payload.role === 'anon')
      throw new EnvError(
        `${envPath}: SUPABASE_SERVICE_ROLE_KEY is the anon key. Use the service_role key.`,
      );
    if (payload.role !== 'service_role')
      throw new EnvError(`${envPath}: SUPABASE_SERVICE_ROLE_KEY is not a service_role key`);
    if (typeof payload.ref === 'string' && payload.ref !== projectRef) {
      throw new EnvError(
        `${envPath}: the key belongs to project ${payload.ref}, the URL to ${projectRef}`,
      );
    }
  }
  if (!UUID.test(userId))
    throw new EnvError(
      `${envPath}: LEDGR_USER_ID must be your user's UUID (Authentication > Users)`,
    );
  return { url, projectRef, serviceRoleKey: key, userId: userId.toLowerCase() };
}
