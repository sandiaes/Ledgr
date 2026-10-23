import { assetTransactions, buildPositions, type TransactionType } from '@ledgr/core';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePortfolio } from '../data/usePortfolio';
import { formatDate } from '../format';
import { useRootNavigation, useRootRoute } from '../navigation';
import { assetLabel, brokerLabel, useNames } from '../ui/labels';
import { Amount, Money, Units } from '../ui/Money';
import { Card } from '../ui/parts';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { colors, space } from '../ui/theme';

const TYPE_NAMES: Record<TransactionType, string> = {
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  interest: 'Interest',
  fee: 'Fee',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  subscription: 'Subscription',
  redemption: 'Redemption',
  transfer: 'Transfer',
};

/** The asset's ledger rows, newest first. */
export function AssetTransactionsScreen() {
  const { assetId } = useRootRoute<'AssetTransactions'>().params;
  const state = usePortfolio(buildPositions);
  const ledger = state.status === 'ready' ? state.ledger : null;
  const names = useNames(ledger);
  const navigation = useRootNavigation();
  useEffect(() => {
    navigation.setOptions({ title: `${assetLabel(names, assetId)} transactions` });
  }, [navigation, names, assetId]);
  const rows = useMemo(
    () => (ledger ? assetTransactions(ledger.transactions, assetId) : []),
    [ledger, assetId],
  );
  return (
    <PortfolioScreen state={state} what="transactions">
      {(view) => (
        <Card>
          {rows.length === 0 ? <Text style={styles.muted}>No transactions.</Text> : null}
          {rows.map((r) => (
            <View key={r.id} style={styles.row} testID="asset-transaction">
              <View style={styles.line}>
                <Text style={styles.type}>
                  {TYPE_NAMES[r.type]}
                  <Text style={styles.muted}>
                    {'  '}
                    {r.monthOnly
                      ? `${formatDate(r.date, view.today.slice(0, 4))} · month only`
                      : formatDate(r.date, view.today.slice(0, 4))}
                  </Text>
                </Text>
                <Money value={r.totalEur} style={styles.total} />
              </View>
              <View style={styles.line}>
                <Text style={styles.muted}>
                  {brokerLabel(names, r.accountId)}
                  {r.transferToAccountId ? ` → ${brokerLabel(names, r.transferToAccountId)}` : ''}
                </Text>
                <View style={styles.figures}>
                  {r.quantity ? <Units value={r.quantity} style={styles.muted} /> : null}
                  {r.quantity && r.unitPrice ? (
                    <>
                      <Text style={styles.muted}>@</Text>
                      <Amount value={r.unitPrice} currency={r.currency} style={styles.muted} />
                    </>
                  ) : null}
                  {r.feesEur.isZero() ? null : (
                    <>
                      <Text style={styles.muted}>· fees</Text>
                      <Money value={r.feesEur} style={styles.muted} />
                    </>
                  )}
                </View>
              </View>
            </View>
          ))}
        </Card>
      )}
    </PortfolioScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  figures: { flexDirection: 'row', gap: 4, alignItems: 'baseline' },
  type: { fontSize: 14, fontWeight: '600', color: colors.text },
  total: { fontSize: 14, color: colors.text },
  muted: { color: colors.muted, fontSize: 12, fontWeight: '400' },
});
