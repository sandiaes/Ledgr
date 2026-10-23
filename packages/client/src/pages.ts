/** PostgREST returns at most this many rows per request (the project's max rows). */
export const PAGE_SIZE = 1000;

/**
 * A failed read. Carries the PostgREST / HTTP code only: a message can quote row values,
 * and financial data is never shown in errors or logged.
 */
export class DataError extends Error {
  override name = 'DataError';
  constructor(
    readonly table: string,
    readonly code: string | null,
  ) {
    super(`Could not read ${table}${code ? ` (${code})` : ''}`);
  }
}

export interface PageResult<T> {
  data: T[] | null;
  error: { code?: string } | null;
}

/**
 * Every row of a query, page by page, so a growing table never silently stops at 1,000
 * rows. `page(from, to)` must apply `.range(from, to)` to a query with a total order on a
 * unique key (e.g. `.order('date').order('id')`); pages are read until one is short.
 */
export async function selectAll<T>(
  table: string,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new DataError(table, error.code ?? null);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return rows;
  }
}
