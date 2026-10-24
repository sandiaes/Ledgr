import { assetScope, transactionRows, type AssetTransactionRow } from '@ledgr/core';
import { useScrollToTop } from '@react-navigation/native';
import { memo, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { useLedger, useToday } from '../data/usePortfolio';
import { formatDate, formatPeriod, formatTime } from '../format';
import { useRootNavigation } from '../navigation';
import { useExcludeTypes } from '../settings/SettingsProvider';
import { AssetPicker } from '../transactions/AssetPicker';
import { Amount } from '../ui/Amount';
import { Chip } from '../ui/Chip';
import { EmptyState, ErrorState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import {
  assetLabel,
  brokerLabel,
  TRANSACTION_TYPE_LABELS,
  useNames,
  type Names,
} from '../ui/labels';
import { ListRow } from '../ui/ListRow';
import { Field } from '../ui/parts';
import { NothingInScope, ScopeNote } from '../ui/Scope';
import { SkeletonRows } from '../ui/Skeleton';
import { T } from '../ui/T';
import { radius, space, type Colors } from '../ui/theme';
import { useColors, useStyles } from '../ui/ThemeProvider';
import {
  ACTIVITY_ICONS,
  activeActivityFilters,
  activityOptions,
  DATE_RANGES,
  filterActivity,
  groupByMonth,
  listedTotal,
  NO_ACTIVITY_FILTERS,
  offeredActivityFilters,
  type ActivityFilters,
} from './listing';

interface MonthSection {
  key: string;
  month: string;
  data: AssetTransactionRow[];
}

/**
 * Every ledger row, newest first, grouped by month (sticky month headers) in a virtualized
 * list, with filters (asset, broker, type, dates). Tap a row for its detail (edit, delete).
 * Reads the ledger only: the totals are each row's own (EUR at its rate), no prices needed.
 * Certificado rows are left out while "Include certificados" is off.
 */
export function ActivityScreen() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const ledger = useLedger();
  const today = useToday();
  const names = useNames(ledger.data ?? null);
  const excludeTypes = useExcludeTypes();
  const [chosen, setFilters] = useState<ActivityFilters>(NO_ACTIVITY_FILTERS);
  const [open, setOpen] = useState(false);
  const listRef = useRef<SectionList<AssetTransactionRow, MonthSection>>(null);
  useScrollToTop(listRef);
  const all = useMemo(() => {
    if (!ledger.data) return [];
    const scope = assetScope({ assets: ledger.data.assets, excludeTypes });
    return transactionRows(ledger.data.transactions, undefined, scope);
  }, [ledger.data, excludeTypes]);
  const options = useMemo(() => activityOptions(all), [all]);
  const filters = useMemo(() => offeredActivityFilters(chosen, options), [chosen, options]);
  const rows = useMemo(() => filterActivity(all, filters, today), [all, filters, today]);
  const sections = useMemo<MonthSection[]>(
    () => groupByMonth(rows).map((g) => ({ key: g.month, month: g.month, data: g.rows })),
    [rows],
  );
  const set = (change: Partial<ActivityFilters>) => setFilters((f) => ({ ...f, ...change }));
  const count = activeActivityFilters(filters);

  let empty;
  if (ledger.isError) {
    empty = <ErrorState title="Could not load the transactions" code={errorCode(ledger.error)} />;
  } else if (!ledger.data) {
    empty = (
      <View style={styles.gutter} testID="activity-loading">
        <SkeletonRows n={8} />
      </View>
    );
  } else if (ledger.data.transactions.length === 0) {
    empty = <EmptyState title="No transactions yet" line="Add your first one with +" />;
  } else if (all.length === 0) {
    empty = <NothingInScope what="transactions" />;
  } else {
    empty = (
      <EmptyState
        icon="noMatch"
        title="No transactions match"
        line="Try other filters."
        testID="activity-none"
      />
    );
  }

  const year = today.slice(0, 4);
  return (
    <>
      {ledger.data && all.length > 0 ? (
        <View style={styles.controls}>
          <Chip
            label={count > 0 ? `Filter (${count})` : 'Filter'}
            selected={open}
            onPress={() => setOpen((o) => !o)}
          />
          {count > 0 ? (
            <Pressable
              onPress={() => setFilters(NO_ACTIVITY_FILTERS)}
              accessibilityRole="button"
              style={styles.clear}
            >
              <T variant="sub" tone="accent">
                Clear filters
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <SectionList<AssetTransactionRow, MonthSection>
        ref={listRef}
        testID="activity-list"
        sections={sections}
        keyExtractor={(r) => r.id}
        renderItem={({ item, index, section }) => (
          <View style={styles.gutter}>
            <ActivityRow
              row={item}
              names={names}
              year={year}
              last={index === section.data.length - 1}
            />
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.monthHead}>
            <T variant="overline" tone="muted" accessibilityRole="header">
              {formatPeriod(section.month)}
            </T>
          </View>
        )}
        stickySectionHeadersEnabled
        ListHeaderComponent={
          <>
            {ledger.data ? (
              <T variant="caption" tone="faint" style={styles.asOf}>
                as of {formatTime(ledger.dataUpdatedAt)}
              </T>
            ) : null}
            <ScopeNote excludeTypes={excludeTypes} />
            {open ? (
              <FilterPanel filters={filters} set={set} options={options} names={names} />
            ) : null}
          </>
        }
        ListEmptyComponent={empty}
        refreshControl={
          <RefreshControl
            refreshing={ledger.isRefetching}
            onRefresh={() => void ledger.refetch()}
            colors={[colors.accent]}
            progressBackgroundColor={colors.raised}
          />
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        initialNumToRender={30}
        windowSize={7}
      />
    </>
  );
}

function FilterPanel(props: {
  filters: ActivityFilters;
  set(change: Partial<ActivityFilters>): void;
  options: ReturnType<typeof activityOptions>;
  names: Names;
}) {
  const styles = useStyles(makeStyles);
  const { filters, set, names, options: used } = props;
  const assets = [...names.assets.values()].filter((a) => used.assets.has(a.id));
  return (
    <View style={styles.panel}>
      {filters.assetId ? (
        <View style={styles.group}>
          <T variant="overline" tone="muted">
            Asset
          </T>
          <View style={styles.chips}>
            <Chip
              label={`${assetLabel(names, filters.assetId)} ✕`}
              selected
              accessibilityLabel="Any asset"
              onPress={() => set({ assetId: null })}
            />
          </View>
        </View>
      ) : (
        <AssetPicker
          assets={assets}
          selected={null}
          onSelect={(assetId) => set({ assetId })}
          emptyText="No assets in the ledger."
        />
      )}
      <View style={styles.group}>
        <T variant="overline" tone="muted">
          Broker
        </T>
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
      </View>
      <View style={styles.group}>
        <T variant="overline" tone="muted">
          Type
        </T>
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
      </View>
      <View style={styles.group}>
        <T variant="overline" tone="muted">
          Date
        </T>
        <View style={styles.chips}>
          {DATE_RANGES.map((r) => (
            <Chip
              key={r.value}
              label={r.label}
              selected={filters.range === r.value}
              onPress={() => set({ range: r.value })}
            />
          ))}
        </View>
      </View>
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
    </View>
  );
}

/**
 * One ledger row: a type icon, "ASSET · Type" over the date, broker and units, and the
 * total with a − for money out and a + for money in (not coloured: a purchase is no loss).
 */
const ActivityRow = memo(function ActivityRow(props: {
  row: AssetTransactionRow;
  names: Names;
  year: string;
  last: boolean;
}) {
  const styles = useStyles(makeStyles);
  const { row: r, names } = props;
  const navigation = useRootNavigation();
  const what = r.assetId ? assetLabel(names, r.assetId) : 'Cash';
  const total = listedTotal(r);
  return (
    <ListRow
      testID="activity-row"
      accessibilityLabel={`${TRANSACTION_TYPE_LABELS[r.type]} ${what} ${r.date}`}
      onPress={() => navigation.navigate('TransactionDetail', { id: r.id })}
      last={props.last}
      leading={
        <View style={styles.icon}>
          <Icon name={ACTIVITY_ICONS[r.type]} size={18} tone="muted" />
        </View>
      }
      title={`${what} · ${TRANSACTION_TYPE_LABELS[r.type]}`}
      subtitle={
        <T variant="sub" tone="muted" numberOfLines={1}>
          {formatDate(r.date, props.year)}
          {r.monthOnly ? ' · month only' : ''} · {brokerLabel(names, r.accountId)}
          {r.transferToAccountId ? ` → ${brokerLabel(names, r.transferToAccountId)}` : ''}
          {r.quantity ? (
            <>
              {' · '}
              <Amount kind="units" value={r.quantity} /> units
            </>
          ) : null}
        </T>
      }
      right={<Amount value={total.value} sign={total.sign} variant="headline" />}
    />
  );
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    content: { paddingBottom: space.xl },
    gutter: { paddingHorizontal: space.lg },
    asOf: { marginHorizontal: space.lg, marginBottom: space.sm, marginTop: space.md },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    clear: { minHeight: 32, justifyContent: 'center' },
    // Opaque, so the rows do not show through while it is pinned.
    monthHead: {
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      backgroundColor: colors.background,
    },
    panel: { paddingHorizontal: space.lg, marginBottom: space.md, gap: space.md },
    group: { gap: space.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
    dates: { flexDirection: 'row', gap: space.md },
    date: { minWidth: 130 },
    icon: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: colors.pressed,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
