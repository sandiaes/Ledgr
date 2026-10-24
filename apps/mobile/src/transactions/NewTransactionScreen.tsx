import type { Transaction } from '@ledgr/core';
import { useState } from 'react';
import { Banner } from '../ui/parts';
import { useNames } from '../ui/labels';
import { useLedger } from '../data/usePortfolio';
import { FORM_TYPE_LABELS } from './messages';
import { TransactionFlow } from './TransactionFlow';

/** The New tab: after a save the form starts again (with a new id) under a "Saved" notice. */
export function NewTransactionScreen() {
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState<Transaction | null>(null);
  const names = useNames(useLedger().data ?? null);
  const what =
    saved &&
    `${FORM_TYPE_LABELS[saved.type as keyof typeof FORM_TYPE_LABELS]}${
      saved.assetId ? ` ${names.assets.get(saved.assetId)?.ticker ?? ''}` : ''
    }`;
  return (
    <TransactionFlow
      key={round}
      notice={
        saved ? <Banner tone="warning">Saved: {what}. Every figure is updated.</Banner> : null
      }
      onSaved={(row) => {
        setSaved(row);
        setRound((r) => r + 1);
      }}
    />
  );
}
