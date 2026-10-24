import {
  ASSET_EXCHANGES,
  listingCurrencyFor,
  validateNewAsset,
  type AssetField,
  type AssetForm,
  type FormAssetType,
} from '@ledgr/core';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { useLedger, useRefreshAfterWrite } from '../data/usePortfolio';
import { useServices } from '../services';
import { Banner, Button, Card, Chip, Field, Segmented } from '../ui/parts';
import { colors, space } from '../ui/theme';
import { assetIssueText } from './messages';

const TYPES: { value: FormAssetType; label: string }[] = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'crypto', label: 'Crypto' },
];

const EXCHANGE_NAMES: Record<string, string> = {
  XNAS: 'Nasdaq',
  XNYS: 'NYSE',
  XASE: 'NYSE American',
  XETR: 'Xetra',
};

/**
 * The minimal "Add asset" flow (docs/app-plan.md §1): name, type, ticker, ISIN (check digit
 * verified), exchange and listing currency (prefilled from the exchange, must match it).
 * Saved with price_source 'manual': "price pending" until prices-daily resolves the symbol.
 */
export function AddAssetForm(props: { onDone(assetId: string): void; onCancel(): void }) {
  const { data: api, newId } = useServices();
  const ledger = useLedger();
  const refresh = useRefreshAfterWrite();
  const [id] = useState(() => newId());
  const [form, setForm] = useState<AssetForm>({
    name: '',
    assetType: 'stock',
    ticker: '',
    isin: '',
    exchange: null,
    currency: '',
  });
  const [currencyEdited, setCurrencyEdited] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<AssetField>>(new Set());
  const saving = useRef(false);
  const mutation = useMutation({
    mutationFn: (asset: Parameters<typeof api.insertAsset>[0]) => api.insertAsset(asset),
  });

  const prefilled = listingCurrencyFor(form.assetType, form.exchange, form.ticker) ?? '';
  const effective = { ...form, currency: currencyEdited ? form.currency : prefilled };
  const existing = useMemo(() => ledger.data?.assets ?? [], [ledger.data]);
  const check = validateNewAsset(effective, existing);
  const errorOf = (field: AssetField) => {
    if (!touched.has(field)) return undefined;
    const issue = check.issues.find((i) => i.field === field);
    return issue ? assetIssueText(issue) : undefined;
  };
  const set = (field: AssetField, change: Partial<AssetForm>) => {
    setForm((f) => ({ ...f, ...change }));
    setTouched((t) => new Set([...t, field]));
  };

  const save = async () => {
    if (saving.current || !check.ok) return;
    saving.current = true;
    try {
      await mutation.mutateAsync({ ...check.asset, id });
      await refresh();
      props.onDone(id);
    } catch {
      // shown from mutation.error; the same id makes a retry safe
    } finally {
      saving.current = false;
    }
  };

  return (
    <Card title="Add asset">
      <Field
        label="Name"
        value={form.name}
        onChangeText={(name) => set('name', { name })}
        error={errorOf('name')}
      />
      <Text style={styles.label}>Type</Text>
      <Segmented
        options={TYPES}
        value={form.assetType}
        onChange={(assetType) =>
          set('assetType', { assetType, exchange: assetType === 'crypto' ? null : form.exchange })
        }
      />
      <Field
        label="Ticker"
        value={form.ticker}
        onChangeText={(ticker) => set('ticker', { ticker })}
        autoCapitalize="characters"
        hint={form.assetType === 'crypto' ? 'The pair in EUR or USD, e.g. BTCEUR.' : undefined}
        error={errorOf('ticker')}
      />
      <Field
        label={form.assetType === 'crypto' ? 'ISIN (optional)' : 'ISIN'}
        value={form.isin}
        onChangeText={(isin) => set('isin', { isin })}
        autoCapitalize="characters"
        error={errorOf('isin')}
      />
      {form.assetType === 'crypto' ? null : (
        <>
          <Text style={styles.label}>Exchange</Text>
          <View style={styles.chips}>
            {ASSET_EXCHANGES.map((mic) => (
              <Chip
                key={mic}
                label={`${EXCHANGE_NAMES[mic]} (${mic})`}
                selected={form.exchange === mic}
                onPress={() => set('exchange', { exchange: mic })}
              />
            ))}
          </View>
          {errorOf('exchange') ? <Text style={styles.error}>{errorOf('exchange')}</Text> : null}
        </>
      )}
      <Field
        label="Listing currency"
        value={effective.currency}
        onChangeText={(currency) => {
          setCurrencyEdited(true);
          set('currency', { currency });
        }}
        autoCapitalize="characters"
        hint="The currency the exchange quotes it in (not what you paid in)."
        error={touched.has('currency') || effective.currency ? errorOf('currency') : undefined}
      />
      <Text style={styles.note}>
        Saved as “price pending”: it is valued at your trade price until the next daily price run
        finds its symbol and fetches its closes.
      </Text>
      {mutation.error ? (
        <Banner tone="error">
          Not saved ({errorCode(mutation.error)}). Tap Save to try again: it will not add the asset
          twice.
        </Banner>
      ) : null}
      <Button
        label="Save asset"
        onPress={() => {
          setTouched(new Set(['name', 'ticker', 'isin', 'exchange', 'currency']));
          void save();
        }}
        disabled={!check.ok}
        busy={mutation.isPending}
      />
      <Button label="Cancel" kind="plain" onPress={props.onCancel} />
    </Card>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.md },
  error: { fontSize: 13, color: colors.loss, marginTop: -space.sm, marginBottom: space.md },
  note: { fontSize: 12, color: colors.muted, marginBottom: space.sm },
});
