// scripts/prices/.env (git-ignored): the service-role key and provider keys live only here,
// on your machine. Supabase settings are validated like the importer's. Never prints a key.
import { EnvError, parseDotEnv, validateEnv, type ImportEnv } from '@ledgr/import/env';
import { DEFAULT_CA_MAX_AGE_DAYS, DEFAULT_STALE_AFTER_DAYS } from '@ledgr/core';

export { EnvError, parseDotEnv };

export interface PricesEnv extends ImportEnv {
  tiingoKey: string | null;
  alphaVantageKey: string | null;
  openFigiKey: string | null;
  staleAfterDays: number;
  caMaxAgeDays: number;
}

function days(
  vars: Record<string, string | undefined>,
  name: string,
  fallback: number,
  path: string,
): number {
  const v = (vars[name] ?? '').trim();
  if (v === '') return fallback;
  if (!/^\d+$/.test(v)) throw new EnvError(`${path}: ${name} must be a whole number of days`);
  return Number(v);
}

export function validatePricesEnv(
  vars: Record<string, string | undefined>,
  path: string,
): PricesEnv {
  const base = validateEnv(vars, path);
  const key = (name: string) => (vars[name] ?? '').trim() || null;
  return {
    ...base,
    tiingoKey: key('TIINGO_API_KEY'),
    alphaVantageKey: key('ALPHAVANTAGE_API_KEY'),
    openFigiKey: key('OPENFIGI_API_KEY'),
    staleAfterDays: days(vars, 'LEDGR_STALE_AFTER_DAYS', DEFAULT_STALE_AFTER_DAYS, path),
    caMaxAgeDays: days(vars, 'LEDGR_CA_MAX_AGE_DAYS', DEFAULT_CA_MAX_AGE_DAYS, path),
  };
}
