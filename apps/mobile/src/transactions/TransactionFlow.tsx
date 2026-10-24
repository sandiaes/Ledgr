import {
  assertIsoDate,
  addDays,
  formFromTransaction,
  mostUsedAccount,
  parseDecimalInput,
  previewTransaction,
  sellableAccounts,
  unitPriceFromTotal,
  validateNewTransaction,
  type Decimal,
  type FormCheck,
  type FormTransactionType,
  type IsoDate,
  type LedgerContext,
  type PositionFigures,
  type Transaction,
  type TransactionField,
  type TransactionForm,
  type TransactionIssue,
} from '@ledgr/core';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { useLedger, useRefreshAfterWrite, useToday } from '../data/usePortfolio';
import { formatDate } from '../format';
import { useServices, type Ledger } from '../services';
import { assetLabel, assetName, brokerLabel, useNames, type Names } from '../ui/labels';
import { Amount } from '../ui/Amount';
import { Money, Units } from '../ui/Money';
import { Banner, Button, Card, Chip, Field, FieldError, Line } from '../ui/parts';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import { AddAssetForm } from './AddAssetForm';
import { AssetPicker, pricePending } from './AssetPicker';
import { FORM_TYPE_LABELS, issueText } from './messages';

type Step = 'form' | 'asset' | 'confirm';

const isDate = (text: string) => {
  try {
    assertIsoDate(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * New transaction and Edit (docs/app-plan.md §1): type, form, optional "Add asset", confirm
 * with the resulting position, save. Every rule is core's validateNewTransaction; the row's
 * id is created when the form opens, so a retried save never makes a second row.
 */
export function TransactionFlow(props: {
  /** The row being edited; a new row when absent. */
  original?: Transaction;
  onSaved(row: Transaction): void;
  /** Above the form (e.g. "Saved."). */
  notice?: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const ledger = useLedger();
  if (ledger.isError) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Banner tone="error">
          Could not load the ledger ({errorCode(ledger.error)}). Go back and try again.
        </Banner>
      </ScrollView>
    );
  }
  if (!ledger.data) return <Text style={styles.status}>Loading…</Text>;
  return <Flow {...props} ledger={ledger.data} />;
}

function Flow(props: {
  ledger: Ledger;
  original?: Transaction;
  onSaved(row: Transaction): void;
  notice?: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const { ledger, original } = props;
  const { newId } = useServices();
  const today = useToday();
  const names = useNames(ledger);
  const [id] = useState(() => original?.id ?? newId());
  const [form, setForm] = useState<TransactionForm>(() =>
    original
      ? formFromTransaction(original)
      : {
          type: 'buy',
          accountId: null,
          assetId: null,
          date: today,
          quantity: '',
          total: '',
          fee: '',
        },
  );
  // The broker follows the default rule until the owner picks one.
  const [accountPicked, setAccountPicked] = useState(original !== undefined);
  const [touched, setTouched] = useState<ReadonlySet<TransactionField>>(new Set());
  const [step, setStep] = useState<Step>('form');
  const [more, setMore] = useState(original?.type === 'interest');

  const accountIds = useMemo(
    () => ledger.accounts.filter((a) => !a.deleted).map((a) => a.id),
    [ledger.accounts],
  );
  const context: LedgerContext = useMemo(
    () => ({
      transactions: ledger.transactions,
      assets: ledger.assets,
      accountIds,
      caSubscriptions: ledger.ca.subscriptions,
    }),
    [ledger, accountIds],
  );
  const date = isDate(form.date) && form.date <= today ? form.date : today;
  const sell = form.type === 'sell';
  const trade = sell || form.type === 'buy';

  const defaultAccount = useMemo(
    () =>
      mostUsedAccount({
        transactions: ledger.transactions,
        type: form.type,
        today,
        accountIds,
        assetId: form.assetId,
        date,
      }),
    [ledger.transactions, form.type, form.assetId, today, accountIds, date],
  );
  const effective: TransactionForm = {
    ...form,
    accountId: accountPicked ? form.accountId : defaultAccount,
  };

  // FIFO over the ledger on every change: a few hundred rows, well under a millisecond.
  let check: FormCheck | { crashed: string };
  try {
    check = validateNewTransaction({ form: effective, id, ledger: context, today, original });
  } catch (e) {
    check = { crashed: errorCode(e) };
  }

  const offered = useMemo(() => {
    const assets = ledger.assets.filter((a) => a.assetType !== 'certificado_aforro');
    if (!sell) return assets;
    return assets.filter(
      (a) =>
        a.id === original?.assetId ||
        sellableAccounts(ledger.transactions, { assetId: a.id, date }).length > 0,
    );
  }, [ledger, sell, date, original]);
  const sellable = useMemo(
    () =>
      sell && form.assetId
        ? sellableAccounts(
            original
              ? ledger.transactions.filter((t) => t.id !== original.id)
              : ledger.transactions,
            { assetId: form.assetId, date },
          )
        : [],
    [sell, form.assetId, date, ledger.transactions, original],
  );

  const update = (field: TransactionField, change: Partial<TransactionForm>) => {
    setForm((f) => ({ ...f, ...change }));
    setTouched((t) => new Set([...t, field]));
  };
  const chooseType = (type: FormTransactionType) => {
    setForm((f) => ({
      ...f,
      type,
      assetId: type === 'interest' ? null : f.assetId,
      fee: type === 'buy' || type === 'sell' ? f.fee : '',
    }));
    setAccountPicked(false);
  };

  if ('crashed' in check) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Banner tone="error">The ledger could not be checked ({check.crashed}).</Banner>
      </ScrollView>
    );
  }

  const issues = check.issues;
  const shown = (field: TransactionField) =>
    issues.filter(
      (i) =>
        i.field === field && (touched.has(field) || (i.code !== 'required' && field !== 'asset')),
    );
  const fieldError = (field: TransactionField) => {
    const list = shown(field);
    return list.length > 0 ? (
      <IssueText issue={list[0] as TransactionIssue} names={names} date={date} />
    ) : undefined;
  };

  if (step === 'asset') {
    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AddAssetForm
          onCancel={() => setStep('form')}
          onDone={(assetId) => {
            update('asset', { assetId });
            setStep('form');
          }}
        />
      </ScrollView>
    );
  }

  if (step === 'confirm' && check.ok) {
    return (
      <Confirm
        row={check.row}
        ledger={ledger}
        names={names}
        today={today}
        original={original}
        onBack={() => setStep('form')}
        onSaved={props.onSaved}
      />
    );
  }

  const asset = form.assetId ? (names.assets.get(form.assetId) ?? null) : null;
  const unitPrice = (() => {
    if (!trade) return null;
    const q = parseDecimalInput(form.quantity);
    const t = parseDecimalInput(form.total);
    return q.ok && t.ok && q.value.gt(0) && t.value.gt(0)
      ? unitPriceFromTotal(t.value, q.value)
      : null;
  })();

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {props.notice}
      {step === 'confirm' && !check.ok ? (
        <Banner tone="warning">The ledger changed: check the form again.</Banner>
      ) : null}
      <Card>
        {original ? (
          <Text style={styles.heading}>
            Edit {FORM_TYPE_LABELS[original.type as FormTransactionType]}
          </Text>
        ) : (
          <>
            <View style={styles.types}>
              {(['buy', 'sell', 'dividend'] as const).map((t) => (
                <TypeButton
                  key={t}
                  type={t}
                  selected={form.type === t}
                  onPress={() => chooseType(t)}
                />
              ))}
            </View>
            {more ? (
              <View style={styles.types}>
                <TypeButton
                  type="interest"
                  selected={form.type === 'interest'}
                  onPress={() => chooseType('interest')}
                />
              </View>
            ) : (
              <Button
                label="More"
                kind="plain"
                accessibilityLabel="More types"
                onPress={() => setMore(true)}
              />
            )}
          </>
        )}
        {shown('type').length > 0 ? (
          <FieldError>{issueText(shown('type')[0] as TransactionIssue)}</FieldError>
        ) : null}
      </Card>

      <Card>
        {form.type === 'interest' ? null : (
          <AssetPicker
            assets={offered}
            selected={asset}
            onSelect={(assetId) => {
              update('asset', { assetId });
              if (!original) setAccountPicked(false);
            }}
            onAddAsset={sell || original ? undefined : () => setStep('asset')}
            error={
              shown('asset').length > 0
                ? issueText(shown('asset')[0] as TransactionIssue)
                : undefined
            }
            emptyText={sell ? 'You hold nothing to sell on this date.' : 'No assets yet: add one.'}
          />
        )}

        {trade ? (
          <Field
            label="Quantity"
            value={form.quantity}
            onChangeText={(quantity) => update('quantity', { quantity })}
            keyboardType="decimal-pad"
            placeholder="0"
            error={fieldError('quantity')}
          />
        ) : null}

        <Field
          label={trade ? 'Total value (€)' : 'Amount received (€)'}
          value={form.total}
          onChangeText={(total) => update('total', { total })}
          keyboardType="decimal-pad"
          placeholder="0.00"
          hint={
            form.type === 'buy'
              ? 'Enter the EUR amount your broker actually charged for the units, without the fee.'
              : sell
                ? 'Enter the EUR amount your broker actually paid you for the units, before the fee.'
                : 'The net amount that arrived, in EUR.'
          }
          error={fieldError('total')}
        />
        {unitPrice ? (
          <View style={styles.inline}>
            <Text style={styles.muted}>=</Text>
            <Amount
              value={unitPrice}
              currency="EUR"
              dp={unitPrice.lt(1) ? 6 : 2}
              style={styles.muted}
            />
            <Text style={styles.muted}>per unit</Text>
          </View>
        ) : null}

        <DateField
          value={form.date}
          today={today}
          onChange={(d) => update('date', { date: d })}
          error={fieldError('date')}
        />

        <Text style={styles.label}>Broker</Text>
        {sell ? (
          form.assetId ? (
            sellable.length === 0 ? (
              <Text style={styles.muted}>No broker holds units of this asset on this date.</Text>
            ) : (
              <View style={styles.chips}>
                {sellable.map((a) => (
                  <Chip
                    key={a.accountId}
                    selected={effective.accountId === a.accountId}
                    onPress={() => {
                      setAccountPicked(true);
                      update('account', { accountId: a.accountId });
                    }}
                    accessibilityLabel={`Broker ${brokerLabel(names, a.accountId)}`}
                    label={
                      <View style={styles.inline}>
                        <Text style={styles.chipText}>
                          {brokerLabel(names, a.accountId)} · holds
                        </Text>
                        <Units value={a.held} style={styles.chipText} />
                        <Text style={styles.chipText}>· can sell</Text>
                        <Units value={a.available} style={styles.chipText} />
                      </View>
                    }
                  />
                ))}
              </View>
            )
          ) : (
            <Text style={styles.muted}>Choose the asset first.</Text>
          )
        ) : (
          <View style={styles.chips}>
            {ledger.accounts
              .filter((a) => !a.deleted)
              .map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  selected={effective.accountId === a.id}
                  accessibilityLabel={`Broker ${a.name}`}
                  onPress={() => {
                    setAccountPicked(true);
                    update('account', { accountId: a.id });
                  }}
                />
              ))}
          </View>
        )}
        {fieldError('account') ? <FieldError>{fieldError('account')}</FieldError> : null}

        {trade ? (
          <Field
            label="Fee (€, optional)"
            value={form.fee}
            onChangeText={(fee) => update('fee', { fee })}
            keyboardType="decimal-pad"
            placeholder="0.00"
            error={fieldError('fee')}
          />
        ) : null}

        {shown('ledger').map((i) => (
          <FieldError key={i.code}>
            <IssueText issue={i} names={names} date={date} />
          </FieldError>
        ))}
        <Button label="Review" onPress={() => setStep('confirm')} disabled={!check.ok} />
      </Card>
    </ScrollView>
  );
}

function TypeButton(props: { type: FormTransactionType; selected: boolean; onPress(): void }) {
  return (
    <Chip
      label={FORM_TYPE_LABELS[props.type]}
      selected={props.selected}
      onPress={props.onPress}
      accessibilityLabel={`Type ${FORM_TYPE_LABELS[props.type]}`}
    />
  );
}

/** YYYY-MM-DD, today by default; Today / −1 day for the usual cases. */
function DateField(props: {
  value: string;
  today: IsoDate;
  onChange(date: string): void;
  error?: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const valid = isDate(props.value);
  return (
    <View>
      <Field
        label="Date"
        value={props.value}
        onChangeText={props.onChange}
        keyboardType="numbers-and-punctuation"
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
        hint={valid ? formatDate(props.value, props.today.slice(0, 4)) : undefined}
        error={props.error}
      />
      <View style={[styles.chips, styles.dateChips]}>
        <Chip
          label="Today"
          selected={props.value === props.today}
          onPress={() => props.onChange(props.today)}
        />
        <Chip
          label="− 1 day"
          selected={false}
          accessibilityLabel="One day earlier"
          onPress={() => props.onChange(addDays(valid ? props.value : props.today, -1))}
        />
      </View>
    </View>
  );
}

/** An issue's text; the units in it go through <Units>, so hiding values masks them. */
function IssueText(props: { issue: TransactionIssue; names: Names; date: IsoDate }) {
  const styles = useStyles(makeStyles);
  const { issue, names } = props;
  if (issue.code === 'exceeds_holdings') {
    return (
      <Text style={styles.error}>
        More than {brokerLabel(names, issue.accountId)} can sell on {formatDate(props.date)}: holds{' '}
        <Units value={issue.held} style={styles.error} /> · can sell{' '}
        <Units value={issue.available} style={styles.error} />
        {issue.available.lt(issue.held) ? ' (a later sale needs the rest)' : ''}.
      </Text>
    );
  }
  if (issue.field === 'ledger') {
    return (
      <Text style={styles.error}>
        This would leave the sale of <Units value={issue.requested} style={styles.error} />{' '}
        {assetLabel(names, issue.assetId)} at {brokerLabel(names, issue.accountId)} on{' '}
        {formatDate(issue.date)} with only <Units value={issue.available} style={styles.error} />{' '}
        units.
      </Text>
    );
  }
  return <Text style={styles.error}>{issueText(issue)}</Text>;
}

function Confirm(props: {
  row: Transaction;
  ledger: Ledger;
  names: Names;
  today: IsoDate;
  original?: Transaction;
  onBack(): void;
  onSaved(row: Transaction): void;
}) {
  const styles = useStyles(makeStyles);
  const { row, names, original } = props;
  const { data: api } = useServices();
  const refresh = useRefreshAfterWrite();
  const mutation = useMutation({
    mutationFn: (r: Transaction) =>
      original ? api.updateTransaction(r) : api.insertTransaction(r),
  });
  // A second tap before React re-renders the disabled button must not save twice.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(
    () =>
      previewTransaction({
        transactions: props.ledger.transactions,
        row,
        asOf: props.today,
        replaceId: original?.id,
        caSubscriptions: props.ledger.ca.subscriptions,
      }),
    [props.ledger, row, props.today, original],
  );
  const asset = row.assetId ? names.assets.get(row.assetId) : undefined;

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await mutation.mutateAsync(row);
      await refresh();
      props.onSaved(row);
    } catch {
      // shown below from mutation.error; the same id makes a retry safe
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const year = props.today.slice(0, 4);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card title={original ? 'Check the change' : 'Check and save'}>
        <Line label="Type" strong>
          <Text style={styles.value}>{FORM_TYPE_LABELS[row.type as FormTransactionType]}</Text>
        </Line>
        {row.assetId ? (
          <Line label="Asset">
            <Text style={styles.value}>
              {assetLabel(names, row.assetId)} · {assetName(names, row.assetId)}
            </Text>
          </Line>
        ) : null}
        <Line label="Broker">
          <Text style={styles.value}>{brokerLabel(names, row.accountId)}</Text>
        </Line>
        <Line label="Date">
          <Text style={styles.value}>{formatDate(row.tradeDate, year)}</Text>
        </Line>
        {row.quantity && row.unitPrice ? (
          <>
            <Line label="Quantity">
              <Units value={row.quantity} style={styles.value} />
            </Line>
            <Line label="Unit price">
              <Amount
                value={row.unitPrice}
                currency="EUR"
                dp={row.unitPrice.lt(1) ? 6 : 2}
                style={styles.value}
              />
            </Line>
            <Line label="Fee">
              <Money value={row.fees} style={styles.value} />
            </Line>
          </>
        ) : null}
        <Line
          label={
            row.type === 'buy'
              ? 'Cost with fee'
              : row.type === 'sell'
                ? 'Proceeds after fee'
                : 'Amount received'
          }
          strong
        >
          <Money value={preview.totalEur} style={styles.strong} />
        </Line>
        {asset && pricePending(asset) ? (
          <Text style={styles.note}>
            Price pending: valued at this trade price until the daily price run finds its symbol.
          </Text>
        ) : null}
      </Card>

      {preview.account && preview.overall ? (
        <Card title="Resulting position">
          <Figures title={`At ${brokerLabel(names, row.accountId)}`} figures={preview.account} />
          <Figures title="All brokers" figures={preview.overall} />
          {preview.realizedGainEur ? (
            <Line label="Realized gain of this sale" strong>
              <Money value={preview.realizedGainEur} sign colored style={styles.strong} />
            </Line>
          ) : null}
        </Card>
      ) : null}

      {mutation.error ? (
        <Banner tone="error">
          Not saved ({errorCode(mutation.error)}). Tap Save to try again: it cannot create a second
          row.
        </Banner>
      ) : null}
      <View style={styles.buttons}>
        <Button label="Save" onPress={() => void save()} busy={busy} />
        <Button label="Back" kind="plain" onPress={props.onBack} disabled={busy} />
      </View>
    </ScrollView>
  );
}

function Figures(props: {
  title: string;
  figures: { before: PositionFigures; after: PositionFigures };
}) {
  const styles = useStyles(makeStyles);
  const { before, after } = props.figures;
  const pair = (render: (f: PositionFigures) => ReactNode) => (
    <>
      {render(before)}
      <Text style={styles.muted}>→</Text>
      {render(after)}
    </>
  );
  const avg = (v: Decimal | null) => <Amount value={v} currency="EUR" style={styles.value} />;
  return (
    <View style={styles.block} testID="resulting-position">
      <Text style={styles.subheading}>{props.title}</Text>
      <Line label="Units">
        {pair((f) => (
          <Units value={f.units} style={styles.value} />
        ))}
      </Line>
      <Line label="Average cost">{pair((f) => avg(f.averageCostEur))}</Line>
      <Line label="Cost basis">
        {pair((f) => (
          <Money value={f.costBasisEur} style={styles.value} />
        ))}
      </Line>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    content: { paddingTop: space.md, paddingBottom: space.xl },
    status: { textAlign: 'center', color: colors.muted, marginTop: space.xl },
    heading: { fontSize: 17, fontWeight: '700', color: colors.text },
    subheading: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 2 },
    types: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginBottom: space.xs },
    label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.md },
    dateChips: { marginTop: -space.sm },
    chipText: { fontSize: 13, color: colors.text },
    inline: {
      flexDirection: 'row',
      gap: 4,
      alignItems: 'baseline',
      flexWrap: 'wrap',
      marginBottom: space.md,
    },
    muted: { fontSize: 13, color: colors.muted },
    value: { fontSize: 14, color: colors.text },
    strong: { fontSize: 15, fontWeight: '700', color: colors.text },
    error: { fontSize: 13, color: colors.loss },
    note: { fontSize: 12, color: colors.muted, marginTop: space.sm },
    block: { marginBottom: space.sm },
    buttons: { marginHorizontal: space.lg },
  });
