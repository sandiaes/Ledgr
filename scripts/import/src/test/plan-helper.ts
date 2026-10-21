// Test-only: a plan from fixture text, with the complete test mapping by default.
import { EMPTY_STATE, type ExistingState } from '../db';
import { readCa, readMappingFile, readTransactions } from '../inputs';
import { buildMapping } from '../mapping';
import { planImport, type ImportPlan } from '../plan';
import { sha256Hex } from '../hash';
import { completeMappingText, fixtureText, utf8 } from './fixtures';

export const TX = fixtureText('sample_transactions.csv');
export const CA = fixtureText('sample_ca.csv');

export interface PlanOpts {
  tx?: string;
  ca?: string | null;
  mapping?: string;
  ratioMonth?: string | null;
  state?: ExistingState;
  allowed?: string[];
}

let ids = 0;
export function plan(o: PlanOpts = {}): ImportPlan {
  const txText = o.tx ?? TX;
  const caText = o.ca === undefined ? CA : o.ca;
  const mappingFile = readMappingFile(utf8(o.mapping ?? completeMappingText()));
  return planImport({
    transactions: readTransactions(utf8(txText)),
    ca: caText === null ? null : readCa(utf8(caText)),
    mapping: buildMapping(mappingFile.records),
    mappingProblems: mappingFile.problems,
    allowedDuplicates: new Set(o.allowed ?? []),
    ratioMonth: o.ratioMonth === undefined ? '2026-10-01' : o.ratioMonth,
    files: {
      transactionsSha256: sha256Hex(txText),
      caSha256: caText === null ? null : sha256Hex(caText),
    },
    settings: {},
    state: o.state ?? EMPTY_STATE,
    newId: () => `id-${++ids}`,
  });
}
