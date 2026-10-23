import { assertPublicKey } from '@ledgr/client';

/**
 * Settings that must never reach a client. Expo inlines EXPO_PUBLIC_* variables into the
 * bundle, so if one of these is set it would ship inside the app: refuse to start.
 */
export const FORBIDDEN_VARIABLES = [
  'EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
  'EXPO_PUBLIC_SUPABASE_SECRET_KEY',
  'EXPO_PUBLIC_SERVICE_ROLE_KEY',
  'EXPO_PUBLIC_TIINGO_API_KEY',
  'EXPO_PUBLIC_ALPHAVANTAGE_API_KEY',
  'EXPO_PUBLIC_OPENFIGI_API_KEY',
] as const;

export type AppEnv = Partial<
  Record<
    | 'EXPO_PUBLIC_SUPABASE_URL'
    | 'EXPO_PUBLIC_SUPABASE_ANON_KEY'
    | (typeof FORBIDDEN_VARIABLES)[number],
    string
  >
>;

export type AppConfig =
  | { ok: true; url: string; anonKey: string; projectRef: string }
  /** `problem` names the variable at fault, never its value. */
  | { ok: false; problem: string };

/** Checks the configuration before any Supabase client exists. */
export function checkConfig(env: AppEnv): AppConfig {
  for (const name of FORBIDDEN_VARIABLES) {
    if ((env[name] ?? '').trim() !== '') {
      return { ok: false, problem: `${name} is set. Remove it: only the anon key may be used.` };
    }
  }
  const url = (env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const ref = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/i.exec(url)?.[1];
  if (!url) return { ok: false, problem: 'EXPO_PUBLIC_SUPABASE_URL is not set.' };
  if (!ref) {
    return {
      ok: false,
      problem: 'EXPO_PUBLIC_SUPABASE_URL must look like https://<project-ref>.supabase.co.',
    };
  }
  const anonKey = (env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  try {
    assertPublicKey(anonKey, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
  } catch (e) {
    const why = e instanceof Error ? e.message : 'invalid';
    return { ok: false, problem: `EXPO_PUBLIC_SUPABASE_ANON_KEY: ${why}.` };
  }
  return { ok: true, url, anonKey, projectRef: ref };
}

/**
 * The variables as Expo inlines them. Each must be written out in full (`process.env.X`):
 * Expo replaces only static references.
 */
export function appEnv(): AppEnv {
  return {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY,
    EXPO_PUBLIC_SUPABASE_SECRET_KEY: process.env.EXPO_PUBLIC_SUPABASE_SECRET_KEY,
    EXPO_PUBLIC_SERVICE_ROLE_KEY: process.env.EXPO_PUBLIC_SERVICE_ROLE_KEY,
    EXPO_PUBLIC_TIINGO_API_KEY: process.env.EXPO_PUBLIC_TIINGO_API_KEY,
    EXPO_PUBLIC_ALPHAVANTAGE_API_KEY: process.env.EXPO_PUBLIC_ALPHAVANTAGE_API_KEY,
    EXPO_PUBLIC_OPENFIGI_API_KEY: process.env.EXPO_PUBLIC_OPENFIGI_API_KEY,
  };
}
