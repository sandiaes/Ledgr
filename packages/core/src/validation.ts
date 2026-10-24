import { addMonths, assertIsoDate, type IsoDate } from './dates';
import { Decimal, ONE, safeDiv, ZERO } from './decimal';
import { InsufficientHoldingsError, LedgerError } from './errors';
import { runFifo, type Lot } from './fifo';
import {
  MAX_DECIMALS,
  parseDecimalInput,
  unitPriceFromTotal,
  type DecimalInputProblem,
} from './input';
import {
  acquisitionCostEur,
  amountEur,
  disposalProceedsEur,
  grossNative,
  isAcquisition,
  isDisposal,
  prepareLedger,
} from './ledger';
import type { Transaction } from './types';

export interface AccountAssetDate {
  accountId: string;
  assetId: string;
  /** The date of the sale being considered. */
  date: IsoDate;
}

/**
 * Units of `assetId` in `accountId` at the end of `date`: the account's acquisitions minus
 * its disposals, plus transfers in, minus transfers out (its open FIFO lots, #1).
 */
export function unitsHeld(transactions: readonly Transaction[], at: AccountAssetDate): Decimal {
  let units = ZERO;
  for (const tx of prepareLedger(transactions, at.date)) units = units.plus(delta(tx, at));
  return units;
}

/**
 * The most units of `assetId` a new sale in `accountId` dated `date` may sell without
 * breaking the ledger: a sale is processed after that day's other rows, and then every later
 * sale or transfer out of the account must still be covered. Holding 10 on 1 March and
 * selling 6 on 1 May, a sale on 1 April may sell at most 4. Never negative.
 *
 * Checks units per account only. A CA redemption linked to a subscription also needs that
 * subscription's lot; the final check is runFifo over the whole ledger with the new row.
 */
export function maxDisposable(transactions: readonly Transaction[], at: AccountAssetDate): Decimal {
  let units = ZERO;
  let min: Decimal | null = null;
  for (const tx of prepareLedger(transactions)) {
    if (tx.tradeDate > at.date && min === null) min = units;
    units = units.plus(delta(tx, at));
    if (min !== null && units.lt(min)) min = units;
  }
  const limit = min === null ? units : min;
  return limit.isNegative() ? ZERO : limit;
}

/** A row's change to the units of one asset in one account. */
function delta(tx: Transaction, at: { accountId: string; assetId: string }): Decimal {
  if (tx.assetId !== at.assetId || !tx.quantity) return ZERO;
  if (tx.type === 'transfer') {
    if (tx.accountId === at.accountId) return tx.quantity.neg();
    if (tx.transferToAccountId === at.accountId) return tx.quantity;
    return ZERO;
  }
  if (tx.accountId !== at.accountId) return ZERO;
  if (isAcquisition(tx.type)) return tx.quantity;
  if (isDisposal(tx.type)) return tx.quantity.neg();
  return ZERO;
}

// ---------------------------------------------------------------------------
// The app's New transaction form and its edits (docs/app-plan.md §1, §4; kpis §0).
// ---------------------------------------------------------------------------

/** The row types the form offers (deposits, withdrawals, transfers and CA rows are not in it). */
export const FORM_TRANSACTION_TYPES = ['buy', 'sell', 'dividend', 'interest'] as const;
export type FormTransactionType = (typeof FORM_TRANSACTION_TYPES)[number];

const isFormType = (type: string): type is FormTransactionType =>
  (FORM_TRANSACTION_TYPES as readonly string[]).includes(type);

/**
 * The form as typed. Amounts are EUR text (parseDecimalInput). Buy / sell: `quantity` and
 * `total` = what the units cost or fetched, before the fee; `fee` optional ('' = 0).
 * Dividend / interest: `total` = the amount received (net); `quantity` and `fee` unused.
 */
export interface TransactionForm {
  type: FormTransactionType;
  accountId: string | null;
  /** Buy, sell, dividend; null for interest (cash interest has no asset). */
  assetId: string | null;
  date: string;
  quantity: string;
  total: string;
  fee: string;
}

export type TransactionField =
  | 'type'
  | 'asset'
  | 'account'
  | 'date'
  | 'quantity'
  | 'total'
  | 'fee'
  /** The rest of the ledger (a later sale the change would leave uncovered). */
  | 'ledger';

type NumberProblem = Exclude<DecimalInputProblem, 'empty'>;

/** Why the form cannot be saved. Ids, dates and units only. */
export type TransactionIssue =
  | { field: 'type'; code: 'unsupported' | 'not_editable' | 'cannot_change' }
  | { field: 'asset'; code: 'required' | 'unknown' | 'not_allowed' }
  | { field: 'account'; code: 'required' | 'unknown' }
  /** Sell: the account holds none of the asset on the date. */
  | { field: 'account'; code: 'no_units' }
  | { field: 'date'; code: 'invalid' | 'future' }
  | { field: 'quantity' | 'total' | 'fee'; code: 'required' | NumberProblem }
  | { field: 'quantity' | 'total'; code: 'not_positive' }
  | { field: 'fee'; code: 'negative' }
  /** A fee on a dividend or interest: the amount received is already net (decision D6). */
  | { field: 'fee'; code: 'not_allowed' }
  /** Sell above what the account can sell on the date (maxDisposable, later sales included). */
  | {
      field: 'quantity';
      code: 'exceeds_holdings';
      accountId: string;
      held: Decimal;
      available: Decimal;
    }
  /** The change would make another row (a later sale or transfer) exceed its holdings. */
  | LedgerChangeIssue;

export interface LedgerChangeIssue {
  field: 'ledger';
  code: 'breaks_later_sale';
  /** The row that would no longer be covered. */
  transactionId: string;
  date: IsoDate;
  accountId: string;
  assetId: string;
  requested: Decimal;
  available: Decimal;
}

export interface LedgerContext {
  /** The ledger (not deleted). */
  transactions: readonly Transaction[];
  /** Assets that exist (not deleted). */
  assets: readonly { id: string; assetType: string }[];
  /** Brokers that can take new rows (not deleted). */
  accountIds: readonly string[];
  /** For CA redemptions linked to a subscription (runFifo). */
  caSubscriptions?: readonly { id: string; transactionId: string }[];
}

export type FormCheck =
  { ok: true; row: Transaction; issues: [] } | { ok: false; row: null; issues: TransactionIssue[] };

/**
 * Whether the form can show a row exactly, so an edit cannot silently drop anything: a form
 * type, EUR at fx 1, no withholding; dividends with an asset and no fee; interest without
 * an asset and no fee. Other rows can be deleted in the app but not edited.
 */
export function editableInApp(tx: Transaction): boolean {
  if (!isFormType(tx.type)) return false;
  if (tx.currency !== 'EUR' || !tx.fxRateToEur.eq(1)) return false;
  if (tx.withholdingTax && !tx.withholdingTax.isZero()) return false;
  if (tx.caSubscriptionId || tx.transferToAccountId) return false;
  if (tx.type === 'dividend') return tx.assetId !== null && tx.fees.isZero();
  if (tx.type === 'interest') return tx.assetId === null && tx.fees.isZero();
  return true;
}

/** quantity x unit price rounded to 18 dp: what the form calls the total. */
function storedTotal(tx: Transaction): Decimal {
  return grossNative(tx).toDecimalPlaces(MAX_DECIMALS, Decimal.ROUND_HALF_EVEN);
}

/**
 * The total to prefill when editing a trade: the shortest decimal whose derived unit price
 * is exactly the stored one (100 for 3 @ 33.333333333333333333), else quantity x price to
 * 18 dp. Saving it unchanged keeps the stored unit price (see validateNewTransaction).
 */
function prefillTotal(tx: Transaction): Decimal {
  const quantity = tx.quantity as Decimal;
  const price = tx.unitPrice as Decimal;
  const exact = grossNative(tx);
  for (let dp = 0; dp <= MAX_DECIMALS; dp++) {
    const t = exact.toDecimalPlaces(dp, Decimal.ROUND_HALF_EVEN);
    if (unitPriceFromTotal(t, quantity).eq(price)) return t;
  }
  return storedTotal(tx);
}

/** An editable row as the form shows it (editableInApp must hold). */
export function formFromTransaction(tx: Transaction): TransactionForm {
  if (!editableInApp(tx)) throw new LedgerError('This row cannot be edited in the app', tx.id);
  const trade = tx.type === 'buy' || tx.type === 'sell';
  return {
    type: tx.type as FormTransactionType,
    accountId: tx.accountId,
    assetId: tx.assetId,
    date: tx.tradeDate,
    quantity: trade ? (tx.quantity as Decimal).toFixed() : '',
    total: trade ? prefillTotal(tx).toFixed() : (tx.amount as Decimal).toFixed(),
    fee: trade && !tx.fees.isZero() ? tx.fees.toFixed() : '',
  };
}

/**
 * Checks the form against the ledger and builds the row to save (EUR at fx 1, day
 * precision; docs/app-plan.md §5). Blocks: a type the form does not offer, a missing or
 * unknown asset or broker, a certificado (subscriptions are not in the form), an invalid or
 * future date, a quantity, total or amount that is not a number or not above 0, a negative
 * fee, a fee on income, and a sale above what that broker can sell on the date
 * (maxDisposable: FIFO is per account, and later sales must stay covered). The final check
 * is runFifo over the whole ledger with the row, which also refuses an edit that would
 * leave a later sale uncovered.
 *
 * `original`: the row being edited. It is left out of the ledger for every check, keeps its
 * id and type, and keeps its stored unit price when quantity and total are unchanged.
 */
export function validateNewTransaction(input: {
  form: TransactionForm;
  /** Client-generated id of a new row (ignored when editing). */
  id: string;
  ledger: LedgerContext;
  /** The owner's today (Europe/Lisbon). */
  today: IsoDate;
  original?: Transaction;
}): FormCheck {
  const { form, ledger, today, original } = input;
  const issues: TransactionIssue[] = [];
  const fail = (): FormCheck => ({ ok: false, row: null, issues });

  if (!isFormType(form.type)) {
    issues.push({ field: 'type', code: 'unsupported' });
    return fail();
  }
  if (original) {
    if (!editableInApp(original)) issues.push({ field: 'type', code: 'not_editable' });
    else if (original.type !== form.type) issues.push({ field: 'type', code: 'cannot_change' });
    if (issues.length > 0) return fail();
  }
  const trade = form.type === 'buy' || form.type === 'sell';
  const base = original
    ? ledger.transactions.filter((t) => t.id !== original.id)
    : ledger.transactions;

  // Asset: required for trades and dividends, none for interest, never a certificado.
  if (form.type === 'interest') {
    if (form.assetId !== null) issues.push({ field: 'asset', code: 'not_allowed' });
  } else if (form.assetId === null || form.assetId === '') {
    issues.push({ field: 'asset', code: 'required' });
  } else {
    const asset = ledger.assets.find((a) => a.id === form.assetId);
    if (!asset) issues.push({ field: 'asset', code: 'unknown' });
    else if (asset.assetType === 'certificado_aforro') {
      issues.push({ field: 'asset', code: 'not_allowed' });
    }
  }

  if (form.accountId === null || form.accountId === '') {
    issues.push({ field: 'account', code: 'required' });
  } else if (!ledger.accountIds.includes(form.accountId)) {
    issues.push({ field: 'account', code: 'unknown' });
  }

  let dateOk = false;
  try {
    assertIsoDate(form.date);
    dateOk = true;
  } catch {
    issues.push({ field: 'date', code: 'invalid' });
  }
  if (dateOk && form.date > today) {
    issues.push({ field: 'date', code: 'future' });
    dateOk = false;
  }

  const positive = (field: 'quantity' | 'total', text: string): Decimal | null => {
    const parsed = parseDecimalInput(text);
    if (!parsed.ok) {
      issues.push({ field, code: parsed.problem === 'empty' ? 'required' : parsed.problem });
      return null;
    }
    if (!parsed.value.gt(0)) {
      issues.push({ field, code: 'not_positive' });
      return null;
    }
    return parsed.value;
  };
  const quantity = trade ? positive('quantity', form.quantity) : null;
  const total = positive('total', form.total);
  let fee: Decimal | null = ZERO;
  if (form.fee.trim() !== '') {
    const parsed = parseDecimalInput(form.fee);
    if (!parsed.ok) {
      issues.push({ field: 'fee', code: parsed.problem === 'empty' ? 'required' : parsed.problem });
      fee = null;
    } else if (parsed.value.isNegative()) {
      issues.push({ field: 'fee', code: 'negative' });
      fee = null;
    } else if (!trade && !parsed.value.isZero()) {
      issues.push({ field: 'fee', code: 'not_allowed' });
      fee = null;
    } else fee = parsed.value;
  }

  // A total so small that the unit price rounds to 0 at 18 decimals would be stored as 0.
  if (quantity && total && unitPriceFromTotal(total, quantity).isZero()) {
    issues.push({ field: 'total', code: 'not_positive' });
  }
  if (issues.length > 0 || total === null || fee === null) return fail();
  const accountId = form.accountId as string;
  const assetId = form.type === 'interest' ? null : (form.assetId as string);

  // Sell: only what that broker can sell on the date, later sales included.
  if (form.type === 'sell' && dateOk) {
    const at = { accountId, assetId: assetId as string, date: form.date };
    const held = unitsHeld(base, at);
    if (!held.gt(0)) {
      issues.push({ field: 'account', code: 'no_units' });
      return fail();
    }
    const available = maxDisposable(base, at);
    if ((quantity as Decimal).gt(available)) {
      issues.push({ field: 'quantity', code: 'exceeds_holdings', accountId, held, available });
      return fail();
    }
  }

  let unitPrice: Decimal | null = null;
  if (trade) {
    const q = quantity as Decimal;
    const kept = original?.quantity && original.unitPrice ? original : null;
    const unchanged =
      kept !== null &&
      (kept.quantity as Decimal).eq(q) &&
      (total.eq(storedTotal(kept)) || total.eq(prefillTotal(kept)));
    unitPrice = unchanged ? (kept.unitPrice as Decimal) : unitPriceFromTotal(total, q);
  }
  const keepMonth = original?.tradeDatePrecision === 'month' && original.tradeDate === form.date;
  const row: Transaction = {
    id: original ? original.id : input.id,
    accountId,
    assetId,
    type: form.type,
    tradeDate: form.date,
    quantity: trade ? quantity : null,
    unitPrice,
    amount: trade ? null : total,
    fees: trade ? fee : ZERO,
    currency: 'EUR',
    fxRateToEur: ONE,
    caSubscriptionId: null,
    withholdingTax: null,
    transferToAccountId: null,
    ...(keepMonth ? { tradeDatePrecision: 'month' as const } : {}),
  };

  const broken = validateLedgerChange({
    transactions: base,
    change: { kind: 'add', row },
    caSubscriptions: ledger.caSubscriptions,
  });
  if (broken) {
    if (broken.transactionId === row.id) {
      // Units-only maxDisposable passed but FIFO did not (e.g. a linked CA redemption).
      issues.push({
        field: 'quantity',
        code: 'exceeds_holdings',
        accountId,
        held: unitsHeld(base, { accountId, assetId: assetId as string, date: form.date }),
        available: broken.available,
      });
    } else issues.push(broken);
    return fail();
  }
  return { ok: true, row, issues: [] };
}

export type LedgerChange =
  | { kind: 'add'; row: Transaction }
  | { kind: 'edit'; row: Transaction }
  | { kind: 'delete'; id: string };

/**
 * Runs FIFO over the ledger with the change applied. Null when every sale and transfer is
 * still covered by its own account's lots; otherwise the first row that is not (an edit or
 * delete that removes units a later sale needs is refused, naming that sale).
 */
export function validateLedgerChange(input: {
  transactions: readonly Transaction[];
  change: LedgerChange;
  caSubscriptions?: readonly { id: string; transactionId: string }[];
}): LedgerChangeIssue | null {
  const { transactions, change } = input;
  const next =
    change.kind === 'add'
      ? [...transactions, change.row]
      : change.kind === 'edit'
        ? transactions.map((t) => (t.id === change.row.id ? change.row : t))
        : transactions.filter((t) => t.id !== change.id);
  try {
    runFifo(next, { caSubscriptions: input.caSubscriptions });
    return null;
  } catch (e) {
    if (!(e instanceof InsufficientHoldingsError)) throw e;
    const tx = next.find((t) => t.id === e.transactionId);
    return {
      field: 'ledger',
      code: 'breaks_later_sale',
      transactionId: e.transactionId as string,
      date: tx?.tradeDate ?? '',
      accountId: e.accountId,
      assetId: e.assetId,
      requested: e.requested,
      available: e.available,
    };
  }
}

/** One broker's units of an asset on a date, and how many a new sale there may sell. */
export interface SellableAccount {
  accountId: string;
  held: Decimal;
  /** maxDisposable: can be below `held` when a later sale needs some of them. */
  available: Decimal;
}

/**
 * The brokers that hold units of `assetId` at the end of `date` (the only ones a sale may
 * use), most units first, ties by account id.
 */
export function sellableAccounts(
  transactions: readonly Transaction[],
  at: { assetId: string; date: IsoDate },
): SellableAccount[] {
  const accounts = new Set<string>();
  for (const t of transactions) {
    if (t.assetId !== at.assetId) continue;
    accounts.add(t.accountId);
    if (t.transferToAccountId) accounts.add(t.transferToAccountId);
  }
  const out: SellableAccount[] = [];
  for (const accountId of accounts) {
    const where = { accountId, assetId: at.assetId, date: at.date };
    const held = unitsHeld(transactions, where);
    if (held.gt(0)) out.push({ accountId, held, available: maxDisposable(transactions, where) });
  }
  return out.sort((a, b) => b.held.comparedTo(a.held) || a.accountId.localeCompare(b.accountId));
}

/**
 * The broker the form starts with. Sell: the one with the most units of the asset on the
 * date. Otherwise: the broker of the most rows of that type in the 12 months to `today`
 * (all time when there are none; all types when there are none of that type), ties by the
 * most recent row. Only brokers in `accountIds` (not deleted). Null when none applies.
 */
export function mostUsedAccount(input: {
  transactions: readonly Transaction[];
  type: FormTransactionType;
  today: IsoDate;
  accountIds: readonly string[];
  /** Sell only. */
  assetId?: string | null;
  date?: IsoDate;
}): string | null {
  const allowed = new Set(input.accountIds);
  if (input.type === 'sell') {
    if (!input.assetId) return null;
    const best = sellableAccounts(input.transactions, {
      assetId: input.assetId,
      date: input.date ?? input.today,
    }).find((a) => allowed.has(a.accountId));
    return best?.accountId ?? null;
  }
  const rows = prepareLedger(input.transactions).filter(
    (t) => allowed.has(t.accountId) && t.tradeDate <= input.today,
  );
  const since = addMonths(input.today, -12);
  const order = new Map(rows.map((t, i) => [t, i]));
  const pick = (candidates: Transaction[]) => {
    const tally = new Map<string, { count: number; last: number }>();
    candidates.forEach((t) => {
      const index = order.get(t) as number;
      const entry = tally.get(t.accountId) ?? { count: 0, last: -1 };
      entry.count++;
      entry.last = Math.max(entry.last, index);
      tally.set(t.accountId, entry);
    });
    let best: [string, { count: number; last: number }] | null = null;
    for (const e of tally) {
      if (!best || e[1].count > best[1].count) best = e;
      else if (e[1].count === best[1].count && e[1].last > best[1].last) best = e;
    }
    return best?.[0] ?? null;
  };
  const ofType = rows.filter((t) => t.type === input.type);
  return pick(ofType.filter((t) => t.tradeDate > since)) ?? pick(ofType) ?? pick(rows) ?? null;
}

/** Units, cost basis and average cost of one asset (in one account, or overall). */
export interface PositionFigures {
  units: Decimal;
  costBasisEur: Decimal;
  /** cost basis / units; null with no units. */
  averageCostEur: Decimal | null;
}

export interface TransactionPreview {
  /** The asset's position before and after the change (null for interest: no asset). */
  account: { before: PositionFigures; after: PositionFigures } | null;
  overall: { before: PositionFigures; after: PositionFigures } | null;
  /** Buy: cost with the fee. Sell: proceeds net of the fee. Income: the amount received. */
  totalEur: Decimal;
  /** Sell: proceeds net of the fee - FIFO cost of the lots this sale consumes. */
  realizedGainEur: Decimal | null;
}

function figures(lots: readonly { quantity: Decimal; costEur: Decimal }[]): PositionFigures {
  const units = lots.reduce((s, l) => s.plus(l.quantity), ZERO);
  const costBasisEur = lots.reduce((s, l) => s.plus(l.costEur), ZERO);
  return { units, costBasisEur, averageCostEur: safeDiv(costBasisEur, units) };
}

/**
 * The confirm screen: the asset's position in the row's account and overall at the end of
 * `asOf` (today), before and after the row is added (or, with `replaceId`, after it
 * replaces that row), and a sale's realized gain. The row must already be valid
 * (validateNewTransaction).
 */
export function previewTransaction(input: {
  transactions: readonly Transaction[];
  row: Transaction;
  asOf: IsoDate;
  replaceId?: string;
  caSubscriptions?: readonly { id: string; transactionId: string }[];
}): TransactionPreview {
  const { row, asOf } = input;
  const without = input.transactions.filter((t) => t.id !== (input.replaceId ?? row.id));
  const options = { asOf, caSubscriptions: input.caSubscriptions };
  const before = runFifo(input.transactions, options);
  const after = runFifo([...without, row], options);
  const totalEur =
    row.type === 'buy'
      ? acquisitionCostEur(row)
      : row.type === 'sell'
        ? disposalProceedsEur(row)
        : amountEur(row);
  const disposal = after.disposals.find((d) => d.transactionId === row.id);
  if (!row.assetId) return { account: null, overall: null, totalEur, realizedGainEur: null };
  const lotsOf = (lots: readonly Lot[], accountId?: string) =>
    lots.filter((l) => l.assetId === row.assetId && (!accountId || l.accountId === accountId));
  return {
    account: {
      before: figures(lotsOf(before.openLots, row.accountId)),
      after: figures(lotsOf(after.openLots, row.accountId)),
    },
    overall: { before: figures(lotsOf(before.openLots)), after: figures(lotsOf(after.openLots)) },
    totalEur,
    realizedGainEur: disposal ? disposal.gainEur : null,
  };
}
