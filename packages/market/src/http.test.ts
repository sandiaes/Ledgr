import { describe, expect, it } from 'vitest';
import { parseEcbCsv, fetchEcbRates } from './ecb';
import { decimalText, HttpError, parseJsonExact, request } from './http';
import { parseFigiJob } from './openfigi';
import { fakeFetch, noSleep } from './test/memory-db';

describe('parseJsonExact', () => {
  it('keeps every number as its exact source text, never a float', () => {
    const v = parseJsonExact(
      '{"a": 123.4500, "b": [0.1000000000000000055511151231257827, 1e-7], "c": "x"}',
    ) as {
      a: string;
      b: string[];
      c: string;
    };
    expect(v.a).toBe('123.4500');
    expect(v.b).toEqual(['0.1000000000000000055511151231257827', '1e-7']);
    expect(v.c).toBe('x');
    expect(decimalText(v.a)).toBe('123.4500');
    expect(decimalText('abc')).toBeNull();
    expect(decimalText(undefined)).toBeNull();
  });
});

describe('request', () => {
  it('retries once on 429 or 5xx, then raises an error without the URL', async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch([
      [/./, () => new Response('', { status: n++ === 0 ? 503 : 200 })],
    ]);
    const ok = await request({ fetch, sleep: noSleep }, 'tiingo', 'https://x.test/?apikey=SECRET');
    expect(ok.status).toBe(200);
    expect(calls).toHaveLength(2);

    const always = fakeFetch([[/./, () => new Response('', { status: 429 })]]);
    const err = await request(
      { fetch: always.fetch, sleep: noSleep },
      'alphavantage',
      'https://x.test/?apikey=SECRET',
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(429);
    expect((err as Error).message).not.toContain('SECRET');
    expect(always.calls).toHaveLength(2);
  });

  it('does not retry other errors, and returns allowed statuses', async () => {
    const { fetch, calls } = fakeFetch([[/./, () => new Response('', { status: 404 })]]);
    const res = await request({ fetch, sleep: noSleep }, 'ecb', 'https://x.test', {}, [404]);
    expect(res.status).toBe(404);
    await expect(request({ fetch, sleep: noSleep }, 'ecb', 'https://x.test')).rejects.toThrow(
      'ecb: HTTP 404',
    );
    expect(calls).toHaveLength(2);
  });
});

describe('ECB', () => {
  const csv = [
    'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE',
    'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2021-01-05,1.2271',
    'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2021-01-04,1.2296',
    'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2021-01-06,',
  ].join('\r\n');

  it('parses the CSV by header names, sorted, skipping empty observations', () => {
    expect(parseEcbCsv(csv)).toEqual([
      { date: '2021-01-04', unitsPerEur: '1.2296' },
      { date: '2021-01-05', unitsPerEur: '1.2271' },
    ]);
  });

  it('asks for the currency series and treats 404 as no data', async () => {
    const { fetch, calls } = fakeFetch([
      [
        /D\.USD\.EUR\.SP00\.A\?startPeriod=2021-01-01&endPeriod=2021-01-10/,
        () => new Response(csv),
      ],
      [/startPeriod=2021-01-09/, () => new Response('No results found.', { status: 404 })],
    ]);
    const http = { fetch, sleep: noSleep };
    expect(await fetchEcbRates(http, 'USD', '2021-01-01', '2021-01-10')).toHaveLength(2);
    expect(await fetchEcbRates(http, 'USD', '2021-01-09', '2021-01-10')).toEqual([]);
    expect(calls[0]?.url).toContain('data-api.ecb.europa.eu');
  });
});

describe('OpenFIGI job parsing', () => {
  it('collects distinct tickers; a warning means no listing', () => {
    expect(
      parseFigiJob({
        data: [
          { ticker: 'aapl', name: 'APPLE INC' },
          { ticker: 'AAPL', name: 'APPLE INC' },
        ],
      }),
    ).toEqual({ tickers: ['AAPL'], names: ['APPLE INC'] });
    expect(parseFigiJob({ warning: 'No identifier found.' })).toEqual({ tickers: [], names: [] });
  });
});
