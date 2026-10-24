import type { ProjectionField, ProjectionProblem } from '@ledgr/core';

const GENERIC: Record<ProjectionProblem, string> = {
  empty: 'Required.',
  not_a_number: 'Not a number. Use digits and one decimal point (1234.56 or 1234,56).',
  not_whole: 'A whole number.',
  negative: 'Cannot be negative.',
  too_small: 'Too low.',
  too_large: 'Too large.',
};

const SPECIFIC: Partial<Record<ProjectionField, Partial<Record<ProjectionProblem, string>>>> = {
  startingValue: { too_large: 'At most €1,000,000,000.' },
  monthlyContribution: { too_large: 'At most €10,000,000 a month.' },
  years: { too_large: 'At most 60 years.' },
  extraMonths: { too_large: 'Between 0 and 11 months.' },
  annualReturn: { too_small: 'At least −50% a year.', too_large: 'At most 100% a year.' },
  inflation: { too_large: 'At most 50% a year.' },
};

/** The text under a field of the return calculator. */
export const problemText = (field: ProjectionField, problem: ProjectionProblem): string =>
  SPECIFIC[field]?.[problem] ?? GENERIC[problem];
