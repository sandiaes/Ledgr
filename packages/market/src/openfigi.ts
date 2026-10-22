// OpenFIGI mapping (Bloomberg, official, free): which ticker does an ISIN have on one
// exchange (MIC)? Without a key: 25 requests/minute and 10 jobs per request.
//
// OpenFIGI files Nasdaq listings under Nasdaq's market-segment MICs (XNGS, XNMS, XNCM),
// so a query for the operating MIC XNAS finds nothing. US listings are therefore asked for
// by Bloomberg's US composite exchange code, which covers Nasdaq, NYSE and NYSE American
// (a US ticker is the same on all of them); other exchanges by their MIC.
import { parseJsonExact, ProviderError, request, type HttpOptions } from './http';

const URL_MAPPING = 'https://api.openfigi.com/v3/mapping';
const US_MICS = new Set(['XNAS', 'XNYS', 'XASE']);

export interface FigiQuery {
  isin: string;
  mic: string;
}

/** The mapping job for one query. */
export function figiJob(q: FigiQuery): Record<string, string> {
  return US_MICS.has(q.mic)
    ? { idType: 'ID_ISIN', idValue: q.isin, exchCode: 'US' }
    : { idType: 'ID_ISIN', idValue: q.isin, micCode: q.mic };
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
    const jobs = queries.slice(i, i + batch).map(figiJob);
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
