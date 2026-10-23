import {
  buildPositions,
  type AssetType,
  type BrokerView,
  type PositionsView,
  type PortfolioTotals,
} from '@ledgr/core';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { usePortfolio } from '../data/usePortfolio';
import { useRootNavigation } from '../navigation';
import { brokerLabel, typeLabel, useNames, type Names } from '../ui/labels';
import { Money, Pct } from '../ui/Money';
import { Banner, Card, Segmented } from '../ui/parts';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { colors, space } from '../ui/theme';
import { ClosedList } from './ClosedList';
import {
  activeFilterCount,
  DEFAULT_SORT,
  filterClosed,
  filterPositions,
  NO_FILTERS,
  SORT_LABELS,
  sortPositions,
  type Filters,
  type Sort,
  type SortKey,
} from './listing';
import { PositionRowView } from './PositionRowView';

type Segment = 'all' | 'broker' | 'type' | 'closed';
const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'broker', label: 'By broker' },
  { value: 'type', label: 'By type' },
  { value: 'closed', label: 'Closed' },
];

export function PositionsScreen() {
  const state = usePortfolio(buildPositions);
  const names = useNames(state.status === 'ready' ? state.ledger : null);
  return (
    <PortfolioScreen state={state} what="positions">
      {(view) => <Positions view={view} names={names} />}
    </PortfolioScreen>
  );
}

function Positions({ view, names }: { view: PositionsView; names: Names }) {
  const [segment, setSegment] = useState<Segment>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [panel, setPanel] = useState<'sort' | 'filter' | null>(null);

  const rows = useMemo(
    () => sortPositions(filterPositions(view.positions, names, query, filters), sort),
    [view.positions, names, query, filters, sort],
  );

  if (view.empty) {
    return (
      <Card>
        <Text style={styles.muted}>No transactions yet.</Text>
      </Card>
    );
  }
  const listed = segment === 'all' || segment === 'type' || segment === 'closed';
  return (
    <>
      <View style={styles.segments}>
        <Segmented options={SEGMENTS} value={segment} onChange={setSegment} />
      </View>
      {listed ? (
        <View style={styles.controls}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search ticker, name or ISIN"
            accessibilityLabel="Search"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.search}
          />
          {segment !== 'closed' ? (
            <ControlButton
              label={`Sort: ${SORT_LABELS[sort.key]} ${sort.dir === 'desc' ? '↓' : '↑'}`}
              on={panel === 'sort'}
              onPress={() => setPanel(panel === 'sort' ? null : 'sort')}
            />
          ) : null}
          <ControlButton
            label={`Filter${activeFilterCount(filters) ? ` (${activeFilterCount(filters)})` : ''}`}
            on={panel === 'filter'}
            onPress={() => setPanel(panel === 'filter' ? null : 'filter')}
          />
        </View>
      ) : null}
      {listed && panel === 'sort' && segment !== 'closed' ? (
        <SortPanel sort={sort} onChange={setSort} />
      ) : null}
      {listed && panel === 'filter' ? (
        <FilterPanel
          view={view}
          names={names}
          filters={filters}
          onChange={setFilters}
          closed={segment === 'closed'}
        />
      ) : null}

      {segment === 'all' ? (
        <Card>
          {rows.length === 0 ? <Text style={styles.muted}>No positions match.</Text> : null}
          {rows.map((r) => (
            <PositionRowView key={r.assetId} row={r} names={names} />
          ))}
        </Card>
      ) : null}
      {segment === 'type'
        ? view.types.map((t) => {
            const own = rows.filter((r) => r.assetType === t.key);
            if (own.length === 0) return null;
            return (
              <Card key={t.key}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>{typeLabel(t.key)}</Text>
                  <View style={styles.figures}>
                    <Money value={t.valueEur} style={styles.strong} />
                    <Pct value={t.weight} style={styles.muted} />
                  </View>
                </View>
                {own.map((r) => (
                  <PositionRowView key={r.assetId} row={r} names={names} />
                ))}
              </Card>
            );
          })
        : null}
      {segment === 'broker' ? <Brokers view={view} names={names} /> : null}
      {segment === 'closed' ? (
        <ClosedList closed={filterClosed(view.closed, names, query, filters)} names={names} />
      ) : null}
    </>
  );
}

function ControlButton(props: { label: string; on: boolean; onPress(): void }) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      style={[styles.control, props.on && styles.controlOn]}
    >
      <Text style={[styles.controlText, props.on && styles.controlTextOn]}>{props.label}</Text>
    </Pressable>
  );
}

const SORT_KEYS: SortKey[] = ['value', 'weight', 'gain', 'day'];

export function SortPanel(props: {
  sort: Sort;
  onChange(sort: Sort): void;
  keys?: readonly SortKey[];
}) {
  return (
    <Card>
      <Segmented
        options={(props.keys ?? SORT_KEYS).map((k) => ({ value: k, label: SORT_LABELS[k] }))}
        value={props.sort.key}
        onChange={(key) => props.onChange({ ...props.sort, key })}
      />
      <Segmented
        options={[
          { value: 'desc', label: 'Highest first' },
          { value: 'asc', label: 'Lowest first' },
        ]}
        value={props.sort.dir}
        onChange={(dir) => props.onChange({ ...props.sort, dir })}
      />
    </Card>
  );
}

function Chips<T extends string>(props: {
  title: string;
  options: readonly { value: T; label: string }[];
  chosen: readonly T[];
  onChange(chosen: T[]): void;
}) {
  if (props.options.length === 0) return null;
  return (
    <View>
      <Text style={styles.filterTitle}>{props.title}</Text>
      <View style={styles.chips}>
        {props.options.map((o) => {
          const on = props.chosen.includes(o.value);
          return (
            <Pressable
              key={o.value}
              onPress={() =>
                props.onChange(
                  on ? props.chosen.filter((v) => v !== o.value) : [...props.chosen, o.value],
                )
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${props.title}: ${o.label}`}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function FilterPanel(props: {
  view: PositionsView;
  names: Names;
  filters: Filters;
  onChange(f: Filters): void;
  closed: boolean;
}) {
  const { view, names, filters: f, onChange } = props;
  const types = [
    ...new Set([
      ...view.positions.map((p) => p.assetType),
      ...view.closed.flatMap((c) => names.assets.get(c.assetId)?.assetType ?? []),
    ]),
  ].sort() as AssetType[];
  const brokers = [
    ...new Set([
      ...view.positions.flatMap((p) => p.accountIds),
      ...view.closed.flatMap((c) => c.accounts.map((a) => a.accountId)),
    ]),
  ].sort((a, b) => brokerLabel(names, a).localeCompare(brokerLabel(names, b)));
  const currencies = [
    ...new Set([
      ...view.positions.map((p) => p.currency),
      ...view.closed.flatMap((c) => names.assets.get(c.assetId)?.tradingCurrency ?? []),
    ]),
  ].sort();
  return (
    <Card>
      <Chips
        title="Type"
        options={types.map((t) => ({ value: t, label: typeLabel(t) }))}
        chosen={f.types}
        onChange={(types) => onChange({ ...f, types })}
      />
      <Chips
        title="Broker"
        options={brokers.map((b) => ({ value: b, label: brokerLabel(names, b) }))}
        chosen={f.brokers}
        onChange={(brokers) => onChange({ ...f, brokers })}
      />
      <Chips
        title="Listing currency"
        options={currencies.map((c) => ({ value: c, label: c }))}
        chosen={f.currencies}
        onChange={(currencies) => onChange({ ...f, currencies })}
      />
      {props.closed ? null : (
        <View style={styles.switchRow}>
          <Text style={styles.label}>Stale or pending prices only</Text>
          <Switch
            value={f.staleOnly}
            onValueChange={(staleOnly) => onChange({ ...f, staleOnly })}
            accessibilityLabel="Stale only"
          />
        </View>
      )}
      {activeFilterCount(f) > 0 ? (
        <Pressable onPress={() => onChange(NO_FILTERS)} accessibilityRole="button">
          <Text style={styles.clear}>Clear filters</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function GainLine({ t }: { t: Pick<PortfolioTotals, 'valueEur' | 'totalGainEur'> }) {
  return (
    <View style={styles.figures}>
      <Text style={styles.muted}>gain</Text>
      <Money value={t.totalGainEur} sign colored style={styles.small} />
    </View>
  );
}

/** One card per broker (value, weight, gain), then the brokers' total. */
function Brokers({ view, names }: { view: PositionsView; names: Names }) {
  const navigation = useRootNavigation();
  return (
    <>
      {view.brokersReconcile ? null : (
        <Banner tone="warning">
          The brokers do not add up to the portfolio totals. Please report this.
        </Banner>
      )}
      {view.brokers.map((b: BrokerView) => (
        <Pressable
          key={b.accountId}
          onPress={() => navigation.navigate('BrokerDetail', { accountId: b.accountId })}
          accessibilityRole="button"
          accessibilityLabel={brokerLabel(names, b.accountId)}
          testID="broker-card"
        >
          <Card>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{brokerLabel(names, b.accountId)}</Text>
              <Money value={b.valueEur} style={styles.strong} />
            </View>
            <View style={styles.sectionHead}>
              <Pct value={b.weight} style={styles.muted} />
              <GainLine t={b} />
            </View>
          </Card>
        </Pressable>
      ))}
      <Card style={styles.total}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>All brokers</Text>
          <Money value={view.brokerTotals.valueEur} style={styles.strong} />
        </View>
        <View style={styles.sectionHead}>
          <Text style={styles.muted}>= portfolio total</Text>
          <GainLine t={view.brokerTotals} />
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  segments: { marginHorizontal: space.lg },
  controls: {
    flexDirection: 'row',
    gap: space.xs,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    alignItems: 'center',
  },
  search: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    fontSize: 14,
    color: colors.text,
  },
  control: {
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  controlOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  controlText: { fontSize: 12, color: colors.text },
  controlTextOn: { color: '#fff', fontWeight: '600' },
  filterTitle: { fontSize: 12, fontWeight: '600', color: colors.muted, marginBottom: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: colors.background,
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: { fontSize: 13, color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clear: { color: colors.accent, fontSize: 13, marginTop: space.sm },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  figures: { flexDirection: 'row', gap: 4, alignItems: 'baseline' },
  strong: { fontSize: 15, fontWeight: '600', color: colors.text },
  small: { fontSize: 13 },
  muted: { color: colors.muted, fontSize: 12 },
  label: { color: colors.text, fontSize: 14 },
  total: { borderColor: colors.accent },
});
