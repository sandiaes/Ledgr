import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLedger } from '../data/usePortfolio';
import { useRootNavigation, useRootRoute } from '../navigation';
import { Banner } from '../ui/parts';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import { TransactionFlow } from './TransactionFlow';

/** Edit: the same form, prefilled, then confirm; back to the row's detail when saved. */
export function EditTransactionScreen() {
  const styles = useStyles(makeStyles);
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

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    content: { paddingTop: space.md },
    status: { textAlign: 'center', color: colors.muted, marginTop: space.xl },
  });
