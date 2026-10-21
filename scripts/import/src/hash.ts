import { createHash } from 'node:crypto';
import type { TxRecord } from './inputs';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * The normalized fields of a transactions row that end up in the ledger: month, transact
 * type, ticker, units, price, value, broker. Numbers are canonical (34.50 = 34.5), text is
 * case-normalized, so a re-export with other regional settings gives the same key. The
 * Type column is not included: it is resolved through the mapping file.
 */
export function rowKey(r: TxRecord): string {
  return [
    'v1',
    'tx',
    r.month,
    r.transactType.trim().toLowerCase(),
    r.ticker,
    r.units.value.toString(),
    r.price.value.toString(),
    r.value.value.toString(),
    r.broker.trim().toLowerCase(),
  ].join('|');
}

/** Short id for a group of identical rows, used in allowed-duplicates.txt. */
export function duplicateKey(r: TxRecord): string {
  return sha256Hex(rowKey(r)).slice(0, 12);
}

/** import_row_hash: the row's key plus its occurrence among identical rows (1-based). */
export function rowHash(r: TxRecord, occurrence: number): string {
  return sha256Hex(`${rowKey(r)}|#${occurrence}`);
}

/** import_row_hash of a CA subscription: one per (series, month). */
export function caSubscriptionHash(series: string, month: string): string {
  return sha256Hex(['v1', 'ca-subscription', series, month].join('|'));
}
