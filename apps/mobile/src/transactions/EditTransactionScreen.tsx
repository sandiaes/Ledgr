import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLedger } from '../data/usePortfolio';
import { useRootNavigation, useRootRoute } from '../navigation';
import { Banner } from '../ui/parts';
import { colors, space } from '../ui/theme';
import { TransactionFlow } from './TransactionFlow';

/** Edit: the same form, prefilled, then confirm; back to the row's detail when saved. */
export function EditTransactionScreen() {
  const { id } = useRootRoute<'EditTransaction'>().params;
  const navigation = useRootNavigation();
  const ledger = useLedger();
  const original = ledger.data?.transactions.find((t) => t.id === id);
  if (ledger.data && !original) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Banner tone="warning">This row no longer exists.</Banner>
      </ScrollView>
    );
  }
  if (!original) return <Text style={styles.status}>Loading…</Text>;
  return <TransactionFlow original={original} onSaved={() => navigation.goBack()} />;
}

const styles = StyleSheet.create({
  content: { paddingTop: space.md },
  status: { textAlign: 'center', color: colors.muted, marginTop: space.xl },
});
