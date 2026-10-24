import {
  editableInApp,
  transactionRows,
  validateLedgerChange,
  type LedgerChangeIssue,
} from '@ledgr/core';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { useLedger, useRefreshAfterWrite, useToday } from '../data/usePortfolio';
import { formatDate } from '../format';
import { useRootNavigation, useRootRoute } from '../navigation';
import { useServices } from '../services';
import {
  assetLabel,
  assetName,
  brokerLabel,
  TRANSACTION_TYPE_LABELS,
  useNames,
  type Names,
} from '../ui/labels';
import { Amount } from '../ui/Amount';
import { Money, Units } from '../ui/Money';
import { Banner, Button, Card, Line } from '../ui/parts';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';

/** One ledger row: its fields, Edit (form rows only) and Delete (soft, with confirmation). */
export function TransactionDetailScreen() {
  const styles = useStyles(makeStyles);
  const { id } = useRootRoute<'TransactionDetail'>().params;
  const navigation = useRootNavigation();
  const ledger = useLedger();
  const today = useToday();
  const names = useNames(ledger.data ?? null);
  const [confirming, setConfirming] = useState(false);

  const tx = ledger.data?.transactions.find((t) => t.id === id);
  const row = useMemo(
    () => (ledger.data && tx ? transactionRows([tx])[0] : undefined),
    [ledger.data, tx],
  );
  // Deleting is refused when a later sale would no longer be covered (FIFO per broker).
  const blocked = useMemo(
    () =>
      ledger.data && tx
        ? validateLedgerChange({
            transactions: ledger.data.transactions,
            change: { kind: 'delete', id: tx.id },
            caSubscriptions: ledger.data.ca.subscriptions,
          })
        : null,
    [ledger.data, tx],
  );

  if (ledger.isError) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Banner tone="error">Could not load the row ({errorCode(ledger.error)}).</Banner>
      </ScrollView>
    );
  }
  if (!ledger.data) return <Text style={styles.status}>Loading…</Text>;
  if (!tx || !row) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Banner tone="warning">This row no longer exists (deleted).</Banner>
      </ScrollView>
    );
  }

  const year = today.slice(0, 4);
  const title = describe(names, tx.type, tx.assetId, tx.accountId, formatDate(tx.tradeDate, year));
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card title={TRANSACTION_TYPE_LABELS[tx.type]}>
        {tx.assetId ? (
          <Line label="Asset">
            <Text style={styles.value}>
              {assetLabel(names, tx.assetId)} · {assetName(names, tx.assetId)}
            </Text>
          </Line>
        ) : null}
        <Line label="Broker">
          <Text style={styles.value}>
            {brokerLabel(names, tx.accountId)}
            {tx.transferToAccountId ? ` → ${brokerLabel(names, tx.transferToAccountId)}` : ''}
          </Text>
        </Line>
        <Line label="Date">
          <Text style={styles.value}>
            {formatDate(tx.tradeDate, year)}
            {row.monthOnly ? ' (month only)' : ''}
          </Text>
        </Line>
        {tx.quantity ? (
          <Line label="Quantity">
            <Units value={tx.quantity} style={styles.value} />
          </Line>
        ) : null}
        {tx.unitPrice ? (
          <Line label="Unit price">
            <Amount value={tx.unitPrice} currency={tx.currency} style={styles.value} />
          </Line>
        ) : null}
        {tx.amount ? (
          <Line label="Amount">
            <Amount value={tx.amount} currency={tx.currency} style={styles.value} />
          </Line>
        ) : null}
        {tx.withholdingTax && !tx.withholdingTax.isZero() ? (
          <Line label="Tax withheld">
            <Amount value={tx.withholdingTax} currency={tx.currency} style={styles.value} />
          </Line>
        ) : null}
        <Line label="Fee">
          <Money value={row.feesEur} style={styles.value} />
        </Line>
        <Line label="Total (EUR)" strong>
          <Money value={row.totalEur} style={styles.strong} />
        </Line>
      </Card>

      <View style={styles.buttons}>
        {editableInApp(tx) ? (
          <Button
            label="Edit"
            onPress={() => navigation.navigate('EditTransaction', { id: tx.id })}
          />
        ) : (
          <Text style={styles.note}>
            Rows of this kind are not edited in the app (it would drop fields the form does not
            have); you can delete it.
          </Text>
        )}
        <Button label="Delete" kind="plain" onPress={() => setConfirming(true)} />
      </View>

      <DeleteDialog
        visible={confirming}
        id={tx.id}
        title={title}
        blocked={blocked}
        names={names}
        year={year}
        onClose={() => setConfirming(false)}
        onDeleted={() => {
          setConfirming(false);
          navigation.goBack();
        }}
      />
    </ScrollView>
  );
}

function describe(
  names: Names,
  type: keyof typeof TRANSACTION_TYPE_LABELS,
  assetId: string | null,
  accountId: string,
  date: string,
) {
  return [
    TRANSACTION_TYPE_LABELS[type],
    assetId ? assetLabel(names, assetId) : null,
    brokerLabel(names, accountId),
    date,
  ]
    .filter(Boolean)
    .join(' · ');
}

function DeleteDialog(props: {
  visible: boolean;
  id: string;
  title: string;
  blocked: LedgerChangeIssue | null;
  names: Names;
  year: string;
  onClose(): void;
  onDeleted(): void;
}) {
  const styles = useStyles(makeStyles);
  const { data: api } = useServices();
  const refresh = useRefreshAfterWrite();
  const mutation = useMutation({ mutationFn: (id: string) => api.deleteTransaction(id) });
  const busy = useRef(false);
  const remove = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await mutation.mutateAsync(props.id);
      await refresh();
      props.onDeleted();
    } catch {
      // shown below
    } finally {
      busy.current = false;
    }
  };
  const b = props.blocked;
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>Delete this row?</Text>
          <Text style={styles.value}>{props.title}</Text>
          {b ? (
            <Text style={styles.error}>
              It cannot be deleted: the sale of <Units value={b.requested} style={styles.error} />{' '}
              {assetLabel(props.names, b.assetId)} at {brokerLabel(props.names, b.accountId)} on{' '}
              {formatDate(b.date, props.year)} would have only{' '}
              <Units value={b.available} style={styles.error} /> units. Change or delete that sale
              first.
            </Text>
          ) : (
            <Text style={styles.note}>
              It is removed from every figure (kept in the database as deleted).
            </Text>
          )}
          {mutation.error ? (
            <Text style={styles.error}>Not deleted ({errorCode(mutation.error)}). Try again.</Text>
          ) : null}
          <Button
            label="Delete"
            kind="danger"
            onPress={() => void remove()}
            disabled={b !== null}
            busy={mutation.isPending}
          />
          <Button label="Cancel" kind="plain" onPress={props.onClose} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    content: { paddingTop: space.md, paddingBottom: space.xl },
    status: { textAlign: 'center', color: colors.muted, marginTop: space.xl },
    value: { fontSize: 14, color: colors.text },
    strong: { fontSize: 15, fontWeight: '700', color: colors.text },
    note: { fontSize: 12, color: colors.muted, marginTop: space.sm },
    error: { fontSize: 13, color: colors.loss, marginTop: space.sm },
    buttons: { marginHorizontal: space.lg },
    backdrop: {
      flex: 1,
      backgroundColor: colors.modal.backdrop,
      justifyContent: 'center',
      padding: space.xl,
    },
    dialog: { backgroundColor: colors.modal.surface, borderRadius: 12, padding: space.lg },
    dialogTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: space.sm },
  });
