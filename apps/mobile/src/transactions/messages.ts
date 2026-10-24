import type { AssetIssue, FormTransactionType, TransactionIssue } from '@ledgr/core';

export const FORM_TYPE_LABELS: Record<FormTransactionType, string> = {
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  interest: 'Interest',
};

const NUMBER: Record<string, string> = {
  required: 'Required.',
  not_a_number: 'Not a number. Use digits and one decimal point (1234.56 or 1234,56).',
  separators: 'No thousands separators: type 1234.56 (or 1234,56).',
  too_many_decimals: 'At most 18 decimals.',
  too_large: 'Too large.',
  not_positive: 'Must be more than 0.',
};

/**
 * The text of an issue shown under its field. Issues that name units (a sale above what a
 * broker holds, a later sale left uncovered) are rendered by the form itself, so the units
 * go through <Units> and are masked while values are hidden; this gives their wording.
 */
export function issueText(issue: TransactionIssue): string {
  switch (issue.field) {
    case 'type':
      return issue.code === 'not_editable'
        ? 'This row cannot be edited in the app (only deleted).'
        : issue.code === 'cannot_change'
          ? 'The type of a saved row cannot change: delete it and add a new one.'
          : 'This type cannot be entered here.';
    case 'asset':
      return issue.code === 'required'
        ? 'Choose an asset.'
        : issue.code === 'unknown'
          ? 'This asset no longer exists.'
          : 'Certificados are not entered here.';
    case 'account':
      return issue.code === 'required'
        ? 'Choose a broker.'
        : issue.code === 'no_units'
          ? 'You hold none of this asset at this broker on this date.'
          : 'This broker is no longer in use.';
    case 'date':
      return issue.code === 'future'
        ? 'The date cannot be in the future.'
        : 'Not a valid date (YYYY-MM-DD).';
    case 'fee':
      if (issue.code === 'negative') return 'The fee cannot be negative.';
      if (issue.code === 'not_allowed') return 'No fee here: enter the net amount received.';
      return NUMBER[issue.code] ?? 'Not valid.';
    case 'quantity':
      if (issue.code === 'exceeds_holdings')
        return 'More than you can sell at this broker on this date';
      return NUMBER[issue.code] ?? 'Not valid.';
    case 'total':
      return NUMBER[issue.code] ?? 'Not valid.';
    case 'ledger':
      return 'This change would leave a later sale without enough units';
  }
}

export function assetIssueText(issue: AssetIssue): string {
  switch (issue.field) {
    case 'name':
      return 'Required.';
    case 'assetType':
      return 'Stocks, ETFs and crypto only.';
    case 'ticker':
      return issue.code === 'required'
        ? 'Required.'
        : issue.code === 'duplicate'
          ? 'An asset with this ticker on this exchange already exists.'
          : 'Letters and digits only; crypto as a pair, e.g. BTCEUR.';
    case 'isin':
      return issue.code === 'required'
        ? 'Required for stocks and ETFs.'
        : issue.code === 'check_digit'
          ? 'The check digit does not match: check for a typo.'
          : issue.code === 'duplicate'
            ? 'An asset with this ISIN already exists.'
            : '2 letters, 9 letters or digits, 1 digit (e.g. IE00BK5BQT80).';
    case 'exchange':
      return issue.code === 'not_allowed'
        ? 'Crypto has no exchange.'
        : issue.code === 'unsupported'
          ? 'Not a supported exchange.'
          : 'Choose the exchange.';
    case 'currency':
      return `Must be ${issue.expected}, the currency this listing is quoted in.`;
  }
}
