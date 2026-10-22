// ECB euro foreign exchange reference rates (official SDMX API, no key). Published on TARGET
// working days around 16:00 CET; no rows on weekends and holidays (the lookup then uses the
// last published rate). Quoted as units of the currency per 1 EUR.
import { assertIsoDate, type IsoDate } from '@ledgr/core';
import { decimalText, request, type HttpOptions } from './http';

const BASE = 'https://data-api.ecb.europa.eu/service/data/EXR';

export interface EcbQuote {
  date: IsoDate;
  /** Units of the currency per 1 EUR, exactly as published. */
  unitsPerEur: string;
}

export async function fetchEcbRates(
  http: HttpOptions,
  currency: string,
  from: IsoDate,
  to: IsoDate,
): Promise<EcbQuote[]> {
  if (!/^[A-Z]{3}$/.test(currency) || currency === 'EUR')
    throw new RangeError(`Bad currency ${currency}`);
  const url = `${BASE}/D.${currency}.EUR.SP00.A?startPeriod=${from}&endPeriod=${to}&format=csvdata&detail=dataonly`;
  // 404 = no observations in the range (e.g. a weekend).
  const res = await request(http, 'ecb', url, { headers: { Accept: 'text/csv' } }, [404]);
  if (res.status === 404) {
    await res.body?.cancel();
    return [];
  }
  return parseEcbCsv(await res.text());
}

/** The csvdata format: a header row, then one row per observation. */
export function parseEcbCsv(text: string): EcbQuote[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const cells = (line: string) => line.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  const header = cells(lines[0] as string);
  const dateCol = header.indexOf('TIME_PERIOD');
  const valueCol = header.indexOf('OBS_VALUE');
  if (dateCol < 0 || valueCol < 0) throw new Error('ecb: unexpected CSV header');
  const out: EcbQuote[] = [];
  for (const line of lines.slice(1)) {
    const row = cells(line);
    const date = row[dateCol] ?? '';
    const value = decimalText(row[valueCol]);
    assertIsoDate(date);
    if (!value) continue; // an empty observation (NaN) is no rate
    out.push({ date, unitsPerEur: value });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
