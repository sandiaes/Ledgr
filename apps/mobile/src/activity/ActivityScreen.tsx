import { transactionRows, type AssetTransactionRow, type TransactionType } from '@ledgr/core';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { useLedger, useToday } from '../data/usePortfolio';
import { formatDate, formatPeriod } from '../format';
import { useRootNavigation } from '../navigation';
import { AssetPicker } from '../transactions/AssetPicker';
import {
  assetLabel,
  brokerLabel,
  TRANSACTION_TYPE_LABELS,
  useNames,
  type Names,
} from '../ui/labels';
import { Money, Units } from '../ui/Money';
import { Banner, Button, Card, Chip, Field, Segmented } from '../ui/parts';
import { colors, space } from '../ui/theme';
import {
  activeActivityFilters,
  DATE_RANGES,
  filterActivity,
  groupByMonth,
  NO_ACTIVITY_FILTERS,
  type ActivityFilters,
} from './listing';

/**
 * Every ledger row, newest first, grouped by month, with filters (asset, broker, type,
 * dates). Tap a row for its detail (edit, delete). Reads the ledger only: the totals are
 * each row's own (EUR at its rate), no prices needed.
 */
export function ActivityScreen() {
  const ledger = useLedger();
  const today = useToday();
  const names = useNames(ledger.data ?? null);
  const [filters, setFilters] = useState<ActivityFilters>(NO_ACTIVITY_FILTERS);
  const [open, setOpen] = useState(false);
  const all = useMemo(
    () => (ledger.data ? transactionRows(ledger.data.transactions) : []),
    [ledger.data],
  );
  const rows = useMemo(() => filterActivity(all, filters, today), [all, filters, today]);
  const groups = useMemo(() => groupByMonth(rows), [rows]);
  const set = (change: Partial<ActivityFilters>) => setFilters((f) => ({ ...f, ...change }));

  let body;
  if (ledger.isError) {
    body = (
      <Banner tone="error">
        Could not load the transactions ({errorCode(ledger.error)}). Pull down to retry.
      </Banner>
    );
  } else if (!ledger.data) {
    body = <Text style={styles.status}>Loading…</Text>;
  } else {
    const count = activeActivityFilters(filters);
    body = (
      <>
        <View style={styles.bar}>
          <Button
            label={count > 0 ? `Filter (${count})` : 'Filter'}
            kind="plain"
            onPress={() => setOpen((o) => !o)}
          />
          {count > 0 ? (
            <Button
              label="Clear filters"
              kind="plain"
              onPress={() => setFilters(NO_ACTIVITY_FILTERS)}
            />
          ) : null}
        </View>
        {open ? <FilterPanel filters={filters} set={set} all={all} names={names} /> : null}
        {all.length === 0 ? (
          <Card>
            <Text style={styles.muted}>No transactions yet.</Text>
          </Card>
        ) : groups.length === 0 ? (
          <Card>
            <Text style={styles.muted}>No transactions match.</Text>
          </Card>
        ) : (
          groups.map((g) => (
            <Card key={g.month} title={formatPeriod(g.month)}>
              {g.rows.map((r) => (
                <ActivityRow key={r.id} row={r} names={names} year={today.slice(0, 4)} />
              ))}
            </Card>
          ))
        )}
      </>
    );
  }
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={ledger.isRefetching} onRefresh={() => void ledger.refetch()} />
      }
    >
      {body}
    </ScrollView>
  );
}

function FilterPanel(props: {
  filters: ActivityFilters;
  set(change: Partial<ActivityFilters>): void;
  all: readonly AssetTransactionRow[];
  names: Names;
}) {
  const { filters, set, all, names } = props;
  const used = useMemo(() => {
    const assets = new Set<string>();
    const accounts = new Set<string>();
    const types = new Set<TransactionType>();
    for (const r of all) {
      if (r.assetId) assets.add(r.assetId);
      accounts.add(r.accountId);
      if (r.transferToAccountId) accounts.add(r.transferToAccountId);
      types.add(r.type);
    }
    return { assets, accounts: [...accounts], types: [...types] };
  }, [all]);
  const assets = [...names.assets.values()].filter((a) => used.assets.has(a.id));
  return (
    <Card>
      {filters.assetId ? (
        <View style={styles.chips}>
          <Text style={styles.label}>Asset</Text>
          <Chip
            label={`${assetLabel(names, filters.assetId)} ✕`}
            selected
            accessibilityLabel="Any asset"
            onPress={() => set({ assetId: null })}
          />
        </View>
      ) : (
        <AssetPicker
          assets={assets}
          selected={null}
          onSelect={(assetId) => set({ assetId })}
          emptyText="No assets in the ledger."
        />
      )}
      <Text style={styles.label}>Broker</Text>
      <View style={styles.chips}>
        {used.accounts.map((id) => (
          <Chip
            key={id}
            label={brokerLabel(names, id)}
            selected={filters.accountId === id}
            accessibilityLabel={`Broker: ${brokerLabel(names, id)}`}
            onPress={() => set({ accountId: filters.accountId === id ? null : id })}
          />
        ))}
      </View>
      <Text style={styles.label}>Type</Text>
      <View style={styles.chips}>
        {used.types.map((t) => (
          <Chip
            key={t}
            label={TRANSACTION_TYPE_LABELS[t]}
            selected={filters.type === t}
            accessibilityLabel={`Type: ${TRANSACTION_TYPE_LABELS[t]}`}
            onPress={() => set({ type: filters.type === t ? null : t })}
          />
        ))}
      </View>
      <Text style={styles.label}>Date</Text>
      <Segmented options={DATE_RANGES} value={filters.range} onChange={(range) => set({ range })} />
      {filters.range === 'custom' ? (
        <View style={styles.dates}>
          <Field
            label="From"
            value={filters.from}
            onChangeText={(from) => set({ from })}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            style={styles.date}
          />
          <Field
            label="To"
            value={filters.to}
            onChangeText={(to) => set({ to })}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            style={styles.date}
          />
        </View>
      ) : null}
    </Card>
  );
}

function ActivityRow(props: { row: AssetTransactionRow; names: Names; year: string }) {
  const { row: r, names } = props;
  const navigation = useRootNavigation();
  const what = r.assetId ? assetLabel(names, r.assetId) : 'Cash';
  return (
    <Pressable
      onPress={() => navigation.navigate('TransactionDetail', { id: r.id })}
      accessibilityRole="button"
      accessibilityLabel={`${TRANSACTION_TYPE_LABELS[r.type]} ${what} ${r.date}`}
      style={styles.row}
      testID="activity-row"
    >
      <View style={styles.line}>
        <Text style={styles.type}>
          {TRANSACTION_TYPE_LABELS[r.type]} · {what}
        </Text>
        <Money value={r.totalEur} style={styles.total} />
      </View>
      <View style={styles.line}>
        <Text style={styles.muted}>
          {formatDate(r.date, props.year)}
          {r.monthOnly ? ' · month only' : ''} · {brokerLabel(names, r.accountId)}
          {r.transferToAccountId ? ` → ${brokerLabel(names, r.transferToAccountId)}` : ''}
        </Text>
        {r.quantity ? <Units value={r.quantity} style={styles.muted} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.md, paddingBottom: space.xl },
  status: { textAlign: 'center', color: colors.muted, marginTop: space.xl },
  bar: { flexDirection: 'row', gap: space.md, marginHorizontal: space.lg, marginTop: -space.md },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    marginBottom: space.md,
    alignItems: 'center',
  },
  dates: { flexDirection: 'row', gap: space.md },
  date: { minWidth: 130 },
  row: {
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  type: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
  total: { fontSize: 14, color: colors.text },
  muted: { color: colors.muted, fontSize: 12 },
});
