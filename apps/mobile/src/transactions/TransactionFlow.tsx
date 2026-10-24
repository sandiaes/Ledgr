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
import { useScrollToTop } from '@react-navigation/native';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { useLedger, useRefreshAfterWrite, useToday } from '../data/usePortfolio';
import { formatDate, unitPriceDp } from '../format';
import { useServices, type Ledger } from '../services';
import { assetLabel, assetName, brokerLabel, useNames, type Names } from '../ui/labels';
import { Amount } from '../ui/Amount';
import { Banner, Button, Chip, Field, FieldError, Line } from '../ui/parts';
import { Section } from '../ui/Section';
import { SegmentedControl } from '../ui/SegmentedControl';
import { T } from '../ui/T';
import { useSettings } from '../settings/SettingsProvider';
import { SkeletonRows } from '../ui/Skeleton';
import { space, weight, type Colors } from '../ui/theme';
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
  if (!ledger.data) return <SkeletonRows n={6} />;
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
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useScrollToTop(scroll);
  const { newTxOptions: options } = useSettings().settings;

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
  // The Fee field is the drawer's switch; an edit also shows it for a row that has a fee, so
  // saving it never drops the stored fee. Hidden, the fee is empty, which is saved as 0.
  const feeShown = trade && (options.fee || (original !== undefined && !original.fees.isZero()));
  const effective: TransactionForm = {
    ...form,
    accountId: accountPicked ? form.accountId : defaultAccount,
    fee: feeShown ? form.fee : '',
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

  // A type switched off in the drawer while it is selected falls back to Buy.
  const types: FormTransactionType[] = [
    'buy',
    'sell',
    ...(options.dividend ? (['dividend'] as const) : []),
    ...(options.interest ? (['interest'] as const) : []),
  ];
  const typeOffered = original !== undefined || types.includes(form.type);
  useEffect(() => {
    if (!typeOffered) chooseType('buy');
  }, [typeOffered]);

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
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'android' ? 'padding' : 'height'}
    >
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {props.notice}
        {step === 'confirm' && !check.ok ? (
          <Banner tone="warning">The ledger changed: check the form again.</Banner>
        ) : null}
        <Section>
          {original ? (
            <T variant="headline">Edit {FORM_TYPE_LABELS[original.type as FormTransactionType]}</T>
          ) : (
            <SegmentedControl
              accessibilityLabel="Type"
              options={types.map((t) => ({
                value: t,
                label: FORM_TYPE_LABELS[t],
                accessibilityLabel: `Type ${FORM_TYPE_LABELS[t]}`,
              }))}
              value={form.type}
              onChange={chooseType}
            />
          )}
          {shown('type').length > 0 ? (
            <FieldError>{issueText(shown('type')[0] as TransactionIssue)}</FieldError>
          ) : null}
        </Section>

        <Section>
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
              emptyText={
                sell ? 'You hold nothing to sell on this date.' : 'No assets yet: add one.'
              }
            />
          )}

          <DateField
            value={form.date}
            today={today}
            onChange={(d) => update('date', { date: d })}
            error={fieldError('date')}
          />

          <T variant="overline" tone="muted" style={styles.label}>
            Broker
          </T>
          {sell ? (
            form.assetId ? (
              sellable.length === 0 ? (
                <T variant="sub" tone="muted" style={styles.gap}>
                  No broker holds units of this asset on this date.
                </T>
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
                          <T variant="sub">{brokerLabel(names, a.accountId)} · holds</T>
                          <Amount kind="units" variant="sub" value={a.held} />
                          <T variant="sub">· can sell</T>
                          <Amount kind="units" variant="sub" value={a.available} />
                        </View>
                      }
                    />
                  ))}
                </View>
              )
            ) : (
              <T variant="sub" tone="muted" style={styles.gap}>
                Choose the asset first.
              </T>
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
              <T variant="sub" tone="muted">
                =
              </T>
              <Amount
                value={unitPrice}
                currency="EUR"
                dp={unitPriceDp(unitPrice)}
                variant="sub"
                style={styles.mutedFigure}
              />
              <T variant="sub" tone="muted">
                per unit
              </T>
            </View>
          ) : null}

          {feeShown ? (
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
        </Section>
      </ScrollView>
    </KeyboardAvoidingView>
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

/**
 * An issue's text, in the colour of the error around it; the units in it go through
 * <Amount kind="units">, so hiding values masks them.
 */
function IssueText(props: { issue: TransactionIssue; names: Names; date: IsoDate }) {
  const { issue, names } = props;
  if (issue.code === 'exceeds_holdings') {
    return (
      <>
        More than {brokerLabel(names, issue.accountId)} can sell on {formatDate(props.date)}: holds{' '}
        <Amount kind="units" value={issue.held} /> · can sell{' '}
        <Amount kind="units" value={issue.available} />
        {issue.available.lt(issue.held) ? ' (a later sale needs the rest)' : ''}.
      </>
    );
  }
  if (issue.field === 'ledger') {
    return (
      <>
        This would leave the sale of <Amount kind="units" value={issue.requested} />{' '}
        {assetLabel(names, issue.assetId)} at {brokerLabel(names, issue.accountId)} on{' '}
        {formatDate(issue.date)} with only <Amount kind="units" value={issue.available} /> units.
      </>
    );
  }
  return <>{issueText(issue)}</>;
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
      <Section title={original ? 'Check the change' : 'Check and save'}>
        <Line label="Type" strong>
          <T variant="body">{FORM_TYPE_LABELS[row.type as FormTransactionType]}</T>
        </Line>
        {row.assetId ? (
          <Line label="Asset">
            <T variant="body">
              {assetLabel(names, row.assetId)} · {assetName(names, row.assetId)}
            </T>
          </Line>
        ) : null}
        <Line label="Broker">
          <T variant="body">{brokerLabel(names, row.accountId)}</T>
        </Line>
        <Line label="Date">
          <T variant="body">{formatDate(row.tradeDate, year)}</T>
        </Line>
        {row.quantity && row.unitPrice ? (
          <>
            <Line label="Quantity">
              <Amount kind="units" value={row.quantity} variant="body" />
            </Line>
            <Line label="Unit price">
              <Amount
                value={row.unitPrice}
                currency="EUR"
                dp={unitPriceDp(row.unitPrice)}
                variant="body"
              />
            </Line>
            <Line label="Fee">
              <Amount value={row.fees} variant="body" />
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
          <Amount value={preview.totalEur} variant="headline" />
        </Line>
        {asset && pricePending(asset) ? (
          <T variant="caption" tone="muted" style={styles.note}>
            Price pending: valued at this trade price until the daily price run finds its symbol.
          </T>
        ) : null}
      </Section>

      {preview.account && preview.overall ? (
        <Section title="Resulting position">
          <Figures title={`At ${brokerLabel(names, row.accountId)}`} figures={preview.account} />
          <Figures title="All brokers" figures={preview.overall} />
          {preview.realizedGainEur ? (
            <Line label="Realized gain of this sale" strong>
              <Amount value={preview.realizedGainEur} sign tone variant="headline" />
            </Line>
          ) : null}
        </Section>
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
      <T variant="sub" tone="muted">
        →
      </T>
      {render(after)}
    </>
  );
  const avg = (v: Decimal | null) => <Amount value={v} currency="EUR" variant="body" />;
  return (
    <View style={styles.block} testID="resulting-position">
      <T variant="sub" tone="muted" style={styles.subheading}>
        {props.title}
      </T>
      <Line label="Units">
        {pair((f) => (
          <Amount kind="units" value={f.units} variant="body" />
        ))}
      </Line>
      <Line label="Average cost">{pair((f) => avg(f.averageCostEur))}</Line>
      <Line label="Cost basis">
        {pair((f) => (
          <Amount value={f.costBasisEur} variant="body" />
        ))}
      </Line>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    content: { paddingTop: space.md, paddingBottom: space.xl },
    subheading: { fontWeight: weight.semibold, marginBottom: space.hairline },
    label: { marginBottom: space.xs },
    gap: { marginBottom: space.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.md },
    dateChips: { marginTop: -space.sm },
    inline: {
      flexDirection: 'row',
      gap: space.xs,
      alignItems: 'baseline',
      flexWrap: 'wrap',
      marginBottom: space.md,
    },
    mutedFigure: { color: colors.muted },
    note: { marginTop: space.sm },
    block: { marginBottom: space.sm },
    buttons: { marginHorizontal: space.lg },
  });
