import {
  editableInApp,
  transactionRows,
  validateLedgerChange,
  type LedgerChangeIssue,
} from '@ledgr/core';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Modal, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
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
import { ErrorState } from '../ui/EmptyState';
import { FigureLine } from '../ui/FigureLine';
import { Banner, Button } from '../ui/parts';
import { Section } from '../ui/Section';
import { SkeletonRows } from '../ui/Skeleton';
import { T } from '../ui/T';
import { radius, space, type Colors } from '../ui/theme';
import { useColors, useStyles } from '../ui/ThemeProvider';

/** One ledger row: its fields, Edit (form rows only) and Delete (soft, with confirmation). */
export function TransactionDetailScreen() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
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

  const refresh = (
    <RefreshControl
      refreshing={ledger.isRefetching}
      onRefresh={() => void ledger.refetch()}
      colors={[colors.accent]}
      progressBackgroundColor={colors.raised}
    />
  );
  if (ledger.isError) {
    return (
      <ScrollView contentContainerStyle={styles.content} refreshControl={refresh}>
        <ErrorState title="Could not load the row" code={errorCode(ledger.error)} />
      </ScrollView>
    );
  }
  if (!ledger.data) {
    return (
      <View style={styles.loading} testID="transaction-loading">
        <SkeletonRows n={6} />
      </View>
    );
  }
  if (!tx || !row) {
    return (
      <ScrollView contentContainerStyle={styles.content} refreshControl={refresh}>
        <Section>
          <Banner tone="warning">This row no longer exists (deleted).</Banner>
        </Section>
      </ScrollView>
    );
  }

  const year = today.slice(0, 4);
  const title = describe(names, tx.type, tx.assetId, tx.accountId, formatDate(tx.tradeDate, year));
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={refresh}
      keyboardShouldPersistTaps="handled"
    >
      <Section title={TRANSACTION_TYPE_LABELS[tx.type]}>
        {tx.assetId ? (
          <FigureLine label="Asset">
            <T variant="body" style={styles.right}>
              {assetLabel(names, tx.assetId)} · {assetName(names, tx.assetId)}
            </T>
          </FigureLine>
        ) : null}
        <FigureLine label="Broker">
          <T variant="body">
            {brokerLabel(names, tx.accountId)}
            {tx.transferToAccountId ? ` → ${brokerLabel(names, tx.transferToAccountId)}` : ''}
          </T>
        </FigureLine>
        <FigureLine label="Date">
          <T variant="body">
            {formatDate(tx.tradeDate, year)}
            {row.monthOnly ? ' (month only)' : ''}
          </T>
        </FigureLine>
        {tx.quantity ? (
          <FigureLine label="Quantity">
            <Amount kind="units" value={tx.quantity} />
          </FigureLine>
        ) : null}
        {tx.unitPrice ? (
          <FigureLine label="Unit price">
            <Amount value={tx.unitPrice} currency={tx.currency} />
          </FigureLine>
        ) : null}
        {tx.amount ? (
          <FigureLine label="Amount">
            <Amount value={tx.amount} currency={tx.currency} />
          </FigureLine>
        ) : null}
        {tx.withholdingTax && !tx.withholdingTax.isZero() ? (
          <FigureLine label="Tax withheld">
            <Amount value={tx.withholdingTax} currency={tx.currency} />
          </FigureLine>
        ) : null}
        <FigureLine label="Fee">
          <Amount value={row.feesEur} />
        </FigureLine>
        <FigureLine label="Total (EUR)" strong>
          <Amount value={row.totalEur} variant="headline" />
        </FigureLine>
      </Section>

      <View style={styles.buttons}>
        {editableInApp(tx) ? (
          <Button
            label="Edit"
            onPress={() => navigation.navigate('EditTransaction', { id: tx.id })}
          />
        ) : (
          <T variant="caption" tone="muted" style={styles.note}>
            Rows of this kind are not edited in the app (it would drop fields the form does not
            have); you can delete it.
          </T>
        )}
        <Button label="Delete" kind="dangerText" onPress={() => setConfirming(true)} />
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
          <T variant="title2" style={styles.dialogTitle}>
            Delete this row?
          </T>
          <T variant="body">{props.title}</T>
          {b ? (
            <T variant="sub" tone="loss" style={styles.message}>
              It cannot be deleted: the sale of <Amount kind="units" value={b.requested} />{' '}
              {assetLabel(props.names, b.assetId)} at {brokerLabel(props.names, b.accountId)} on{' '}
              {formatDate(b.date, props.year)} would have only{' '}
              <Amount kind="units" value={b.available} /> units. Change or delete that sale first.
            </T>
          ) : (
            <T variant="sub" tone="muted" style={styles.message}>
              It is removed from every figure (kept in the database as deleted).
            </T>
          )}
          {mutation.error ? (
            <T variant="sub" tone="loss" style={styles.message}>
              Not deleted ({errorCode(mutation.error)}). Try again.
            </T>
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
    loading: { paddingHorizontal: space.lg, paddingTop: space.md },
    right: { textAlign: 'right', flexShrink: 1 },
    note: { marginTop: space.sm },
    message: { marginTop: space.sm },
    buttons: { marginHorizontal: space.lg },
    backdrop: {
      flex: 1,
      backgroundColor: colors.modal.backdrop,
      justifyContent: 'center',
      padding: space.xl,
    },
    dialog: {
      backgroundColor: colors.modal.surface,
      borderRadius: radius.md,
      padding: space.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    dialogTitle: { marginBottom: space.sm },
  });
