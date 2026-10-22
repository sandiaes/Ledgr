// OpenFIGI mapping (Bloomberg, official, free): which ticker does an ISIN have on one
// exchange (MIC)? Without a key: 25 requests/minute and 10 jobs per request.
import { parseJsonExact, ProviderError, request, type HttpOptions } from './http';

const URL_MAPPING = 'https://api.openfigi.com/v3/mapping';

export interface FigiQuery {
  isin: string;
  mic: string;
}

/** Distinct tickers OpenFIGI lists for the ISIN on that MIC (empty: no listing found). */
export type FigiResult = { tickers: string[]; names: string[] };

export async function mapIsins(
  http: HttpOptions,
  queries: readonly FigiQuery[],
  apiKey?: string,
): Promise<FigiResult[]> {
  const batch = apiKey ? 100 : 10;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-OPENFIGI-APIKEY'] = apiKey;
  const results: FigiResult[] = [];
  for (let i = 0; i < queries.length; i += batch) {
    if (i > 0) await http.sleep(apiKey ? 300 : 2600);
    const jobs = queries
      .slice(i, i + batch)
      .map((q) => ({ idType: 'ID_ISIN', idValue: q.isin, micCode: q.mic }));
    const res = await request(http, 'openfigi', URL_MAPPING, {
      method: 'POST',
      headers,
      body: JSON.stringify(jobs),
    });
    const body = parseJsonExact(await res.text());
    if (!Array.isArray(body) || body.length !== jobs.length)
      throw new ProviderError('openfigi', 'bad_response');
    results.push(...body.map(parseFigiJob));
  }
  return results;
}

export function parseFigiJob(job: unknown): FigiResult {
  const data = (job as { data?: unknown })?.data;
  if (!Array.isArray(data)) return { tickers: [], names: [] };
  const tickers = new Set<string>();
  const names = new Set<string>();
  for (const d of data as { ticker?: unknown; name?: unknown }[]) {
    if (typeof d.ticker === 'string' && d.ticker !== '') tickers.add(d.ticker.toUpperCase());
    if (typeof d.name === 'string' && d.name !== '') names.add(d.name);
  }
  return { tickers: [...tickers].sort(), names: [...names].sort() };
}
