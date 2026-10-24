import { assetTransactions, buildPositions, type AssetTransactionRow } from '@ledgr/core';
import { useMemo } from 'react';
import { View } from 'react-native';
import { usePortfolio } from '../data/usePortfolio';
import { formatDate } from '../format';
import { useRootRoute } from '../navigation';
import { Amount } from '../ui/Amount';
import { EmptyState } from '../ui/EmptyState';
import {
  assetLabel,
  brokerLabel,
  TRANSACTION_TYPE_LABELS,
  useNames,
  type Names,
} from '../ui/labels';
import { ListRow } from '../ui/ListRow';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { Section } from '../ui/Section';
import { SkeletonRows } from '../ui/Skeleton';
import { T } from '../ui/T';

/** The asset's ledger rows, newest first. */
export function AssetTransactionsScreen() {
  const { assetId } = useRootRoute<'AssetTransactions'>().params;
  const state = usePortfolio(buildPositions);
  const ledger = state.status === 'ready' ? state.ledger : null;
  const names = useNames(ledger);
  const rows = useMemo(
    () => (ledger ? assetTransactions(ledger.transactions, assetId) : []),
    [ledger, assetId],
  );
  return (
    <PortfolioScreen state={state} what="transactions" skeleton={<SkeletonRows n={6} />}>
      {(view) =>
        rows.length === 0 ? (
          <EmptyState
            title="No transactions"
            line={`Nothing in the ledger for ${assetLabel(names, assetId)}.`}
          />
        ) : (
          <Section title={`${assetLabel(names, assetId)} transactions`}>
            {rows.map((r, i) => (
              <TransactionRow
                key={r.id}
                r={r}
                names={names}
                year={view.today.slice(0, 4)}
                last={i === rows.length - 1}
              />
            ))}
          </Section>
        )
      }
    </PortfolioScreen>
  );
}

function TransactionRow(props: {
  r: AssetTransactionRow;
  names: Names;
  year: string;
  last: boolean;
}) {
  const { r, names, year } = props;
  return (
    <ListRow
      testID="asset-transaction"
      last={props.last}
      title={
        <T variant="headline" numberOfLines={1}>
          {TRANSACTION_TYPE_LABELS[r.type]}
          <T variant="sub" tone="muted">
            {'  '}
            {r.monthOnly ? `${formatDate(r.date, year)} · month only` : formatDate(r.date, year)}
          </T>
        </T>
      }
      subtitle={
        <View>
          <T variant="sub" tone="muted">
            {brokerLabel(names, r.accountId)}
            {r.transferToAccountId ? ` → ${brokerLabel(names, r.transferToAccountId)}` : ''}
          </T>
          {r.quantity || !r.feesEur.isZero() ? (
            <T variant="caption" tone="muted">
              {r.quantity ? <Amount kind="units" value={r.quantity} /> : null}
              {r.quantity && r.unitPrice ? (
                <>
                  {' @ '}
                  <Amount value={r.unitPrice} currency={r.currency} />
                </>
              ) : null}
              {r.feesEur.isZero() ? null : (
                <>
                  {r.quantity ? ' · fees ' : 'fees '}
                  <Amount value={r.feesEur} />
                </>
              )}
            </T>
          ) : null}
        </View>
      }
      right={<Amount value={r.totalEur} variant="headline" />}
    />
  );
}
