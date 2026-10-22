// HTTP for the providers. Errors carry the provider and status only: never the URL (it can
// hold an API key) and never the body (it can hold prices).

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(`${provider}: HTTP ${status}`);
  }
}

/** The provider answered, but not with usable data (unknown symbol, rate limit text, ...). */
export class ProviderError extends Error {
  override name = 'ProviderError';
  constructor(
    readonly provider: string,
    readonly code: 'unknown_symbol' | 'rate_limited' | 'bad_response' | 'premium_only',
  ) {
    super(`${provider}: ${code}`);
  }
}

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface HttpOptions {
  fetch: Fetch;
  sleep: Sleep;
}

/**
 * GET/POST with one retry after 2 s on a network error, 429 or 5xx. `allow` lists statuses
 * the caller handles itself (e.g. 404 = no data). Anything else non-2xx is an HttpError.
 */
export async function request(
  http: HttpOptions,
  provider: string,
  url: string,
  init: RequestInit = {},
  allow: readonly number[] = [],
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await http.fetch(url, init);
    } catch {
      if (attempt === 0) {
        await http.sleep(2000);
        continue;
      }
      throw new HttpError(provider, 0);
    }
    if (res.ok || allow.includes(res.status)) return res;
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
      await res.body?.cancel();
      await http.sleep(2000);
      continue;
    }
    await res.body?.cancel();
    throw new HttpError(provider, res.status);
  }
}

/**
 * JSON.parse that keeps every number as its exact source text (a string), so a price is
 * never rounded through a JS float. Needs JSON.parse source text access (Node >= 21, Deno).
 */
export function parseJsonExact(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== 'number') return value;
    if (typeof context?.source !== 'string') {
      throw new Error('JSON.parse source text access is not available in this runtime');
    }
    return context.source;
  });
}

const DECIMAL_TEXT = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** A decimal as text from a parsed field, or null when it is missing or not a number. */
export function decimalText(value: unknown): string | null {
  return typeof value === 'string' && DECIMAL_TEXT.test(value.trim()) ? value.trim() : null;
}
