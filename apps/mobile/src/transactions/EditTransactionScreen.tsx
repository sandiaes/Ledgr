import { ScrollView, StyleSheet } from 'react-native';
import { errorCode } from '../auth/errors';
import { useLedger } from '../data/usePortfolio';
import { useRootNavigation, useRootRoute } from '../navigation';
import { Banner } from '../ui/parts';
import { SkeletonRows } from '../ui/Skeleton';
import { space } from '../ui/theme';
import { TransactionFlow } from './TransactionFlow';

/** Edit: the same form, prefilled, then confirm; back to the row's detail when saved. */
export function EditTransactionScreen() {
  const { id } = useRootRoute<'EditTransaction'>().params;
  const navigation = useRootNavigation();
  const ledger = useLedger();
  const original = ledger.data?.transactions.find((t) => t.id === id);
  if (ledger.isError) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Banner tone="error">
          Could not load the ledger ({errorCode(ledger.error)}). Go back and try again.
        </Banner>
      </ScrollView>
    );
  }
  if (ledger.data && !original) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Banner tone="warning">This row no longer exists.</Banner>
      </ScrollView>
    );
  }
  if (!original) return <SkeletonRows n={6} />;
  return <TransactionFlow original={original} onSaved={() => navigation.goBack()} />;
}

const styles = StyleSheet.create({
  content: { paddingTop: space.md },
});
