import {
  buildPositions,
  type AllocationSlice,
  type BrokerView,
  type ClosedPosition,
  type PortfolioTotals,
  type PositionRow,
  type PositionsView,
} from '@ledgr/core';
import { useScrollToTop } from '@react-navigation/native';
import { useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { usePortfolio } from '../data/usePortfolio';
import { useRootNavigation } from '../navigation';
import { Amount } from '../ui/Amount';
import { Chip } from '../ui/Chip';
import { EmptyState } from '../ui/EmptyState';
import { brokerLabel, typeLabel, useNames, type Names } from '../ui/labels';
import { ListRow } from '../ui/ListRow';
import { Banner, Input, Switch } from '../ui/parts';
import { PortfolioScreen, type ListFrame } from '../ui/PortfolioScreen';
import { SegmentedControl } from '../ui/SegmentedControl';
import { SkeletonRows } from '../ui/Skeleton';
import { T } from '../ui/T';
import { radius, space, TOUCH_TARGET, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import { ClosedItem } from './ClosedList';
import {
  activeFilterCount,
  DEFAULT_SORT,
  filterClosed,
  filterOptions,
  filterPositions,
  NO_FILTERS,
  offeredFilters,
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

/** What the list shows: one kind of row per segment, plus the states in between. */
type Item =
  | { kind: 'position'; row: PositionRow }
  | { kind: 'broker'; broker: BrokerView }
  | { kind: 'brokerTotal' }
  | { kind: 'closed'; closed: ClosedPosition }
  | { kind: 'none'; title: string };

/** A run of rows; "By type" gives each type one, with a sticky header. */
interface Group {
  key: string;
  head?: AllocationSlice;
  data: Item[];
}

export function PositionsScreen() {
  const state = usePortfolio(buildPositions);
  const names = useNames(state.status === 'ready' ? state.ledger : null);
  return (
    <PortfolioScreen state={state} what="positions" list skeleton={<SkeletonRows n={7} />}>
      {(view, _ready, frame) => <Positions view={view} names={names} frame={frame} />}
    </PortfolioScreen>
  );
}

function Positions({
  view,
  names,
  frame,
}: {
  view: PositionsView;
  names: Names;
  frame: ListFrame;
}) {
  const styles = useStyles(makeStyles);
  const [segment, setSegment] = useState<Segment>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [chosen, setFilters] = useState<Filters>(NO_FILTERS);
  const [panel, setPanel] = useState<'sort' | 'filter' | null>(null);
  const list = useRef<SectionList<Item, Group>>(null);
  useScrollToTop(list);
  const options = useMemo(() => filterOptions(view, names), [view, names]);
  const filters = useMemo(() => offeredFilters(chosen, options), [chosen, options]);

  const rows = useMemo(
    () => sortPositions(filterPositions(view.positions, names, query, filters), sort),
    [view.positions, names, query, filters, sort],
  );
  const closed = useMemo(
    () => filterClosed(view.closed, names, query, filters),
    [view.closed, names, query, filters],
  );
  const groups = useMemo<Group[]>(() => {
    const none = (title: string): Group[] => [{ key: 'none', data: [{ kind: 'none', title }] }];
    switch (segment) {
      case 'all':
        return rows.length === 0
          ? none('No positions match.')
          : [{ key: 'all', data: rows.map((row) => ({ kind: 'position', row })) }];
      case 'type': {
        const made = view.types.flatMap((head) => {
          const own = rows.filter((r) => r.assetType === head.key);
          return own.length === 0
            ? []
            : [{ key: head.key, head, data: own.map((row): Item => ({ kind: 'position', row })) }];
        });
        return made.length === 0 ? none('No positions match.') : made;
      }
      case 'broker':
        return [
          {
            key: 'brokers',
            data: [
              ...view.brokers.map((broker): Item => ({ kind: 'broker', broker })),
              { kind: 'brokerTotal' },
            ],
          },
        ];
      case 'closed':
        return closed.length === 0
          ? none('No closed positions.')
          : [{ key: 'closed', data: closed.map((c): Item => ({ kind: 'closed', closed: c })) }];
    }
  }, [segment, rows, closed, view.types, view.brokers]);

  if (view.empty) {
    return frame.plain(<EmptyState title="No transactions yet" line="Add your first one with +" />);
  }
  const listed = segment !== 'broker';
  // A panel opens at the top of the list: bring it into view.
  const toggle = (which: 'sort' | 'filter') => {
    const next = panel === which ? null : which;
    setPanel(next);
    if (next) list.current?.getScrollResponder()?.scrollTo?.({ y: 0, animated: true });
  };
  const filterCount = activeFilterCount(filters);

  const header = (
    <>
      {frame.intro}
      {listed && panel === 'sort' && segment !== 'closed' ? (
        <SortPanel sort={sort} onChange={setSort} />
      ) : null}
      {listed && panel === 'filter' ? (
        <FilterPanel
          options={options}
          names={names}
          filters={filters}
          onChange={setFilters}
          closed={segment === 'closed'}
        />
      ) : null}
      {segment === 'broker' && !view.brokersReconcile ? (
        <View style={styles.gutter}>
          <Banner tone="warning">
            The brokers do not add up to the portfolio totals. Please report this.
          </Banner>
        </View>
      ) : null}
      {segment === 'closed' ? (
        <T variant="caption" tone="faint" style={styles.note}>
          Performance, not tax: realized gains here use FIFO per broker over the ledger. Tax figures
          come from the brokers’ reports.
        </T>
      ) : null}
    </>
  );

  return (
    <>
      <View style={styles.controls}>
        <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} />
        {listed ? (
          <View style={styles.searchRow}>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search ticker, name or ISIN"
              accessibilityLabel="Search"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.search}
            />
            {segment !== 'closed' ? (
              <Chip
                label={`Sort: ${SORT_LABELS[sort.key]} ${sort.dir === 'desc' ? '↓' : '↑'}`}
                selected={panel === 'sort'}
                onPress={() => toggle('sort')}
              />
            ) : null}
            <Chip
              label={`Filter${filterCount ? ` (${filterCount})` : ''}`}
              selected={panel === 'filter'}
              onPress={() => toggle('filter')}
            />
          </View>
        ) : null}
      </View>
      <SectionList<Item, Group>
        ref={list}
        testID="positions-list"
        sections={groups}
        keyExtractor={keyOf}
        renderItem={({ item, index, section }) => (
          <View style={styles.gutter}>
            <ItemRow
              item={item}
              names={names}
              view={view}
              last={index === section.data.length - 1}
            />
          </View>
        )}
        renderSectionHeader={({ section }) =>
          section.head ? <GroupHeader head={section.head} /> : null
        }
        stickySectionHeadersEnabled
        ListHeaderComponent={header}
        refreshControl={frame.refreshControl}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        initialNumToRender={20}
        windowSize={7}
      />
    </>
  );
}

const keyOf = (item: Item): string => {
  switch (item.kind) {
    case 'position':
      return `p:${item.row.assetId}`;
    case 'broker':
      return `b:${item.broker.accountId}`;
    case 'brokerTotal':
      return 'b:total';
    case 'closed':
      return `c:${item.closed.assetId}`;
    case 'none':
      return 'none';
  }
};

function ItemRow(props: { item: Item; names: Names; view: PositionsView; last: boolean }) {
  const { item, names, view } = props;
  switch (item.kind) {
    case 'position':
      return <PositionRowView row={item.row} names={names} last={props.last} />;
    case 'broker':
      return <BrokerRow broker={item.broker} names={names} />;
    case 'brokerTotal':
      return <BrokerTotal totals={view.brokerTotals} />;
    case 'closed':
      return <ClosedItem c={item.closed} names={names} last={props.last} />;
    case 'none':
      return <EmptyState icon="noMatch" title={item.title} testID="positions-none" />;
  }
}

/** A type's name with its value and weight, pinned while its rows scroll. */
function GroupHeader({ head }: { head: AllocationSlice }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.groupHead}>
      <T variant="overline" tone="muted" accessibilityRole="header">
        {typeLabel(head.key)}
      </T>
      <View style={styles.inline}>
        <Amount value={head.valueEur} variant="sub" />
        <Amount kind="pct" value={head.weight} variant="sub" style={styles.faint} />
      </View>
    </View>
  );
}

function GainFigure({ t }: { t: Pick<PortfolioTotals, 'totalGainEur'> }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.inline}>
      <T variant="caption" tone="muted">
        gain
      </T>
      <Amount value={t.totalGainEur} sign tone variant="sub" />
    </View>
  );
}

/** One broker: value and weight, and its gain. Tap → Broker detail. */
function BrokerRow({ broker: b, names }: { broker: BrokerView; names: Names }) {
  const navigation = useRootNavigation();
  return (
    <ListRow
      testID="broker-card"
      accessibilityLabel={brokerLabel(names, b.accountId)}
      title={brokerLabel(names, b.accountId)}
      subtitle={<Amount kind="pct" value={b.weight} variant="sub" />}
      right={<Amount value={b.valueEur} variant="headline" />}
      rightSub={<GainFigure t={b} />}
      onPress={() => navigation.navigate('BrokerDetail', { accountId: b.accountId })}
    />
  );
}

/** The brokers' total, which equals the portfolio total (the reconcile check). */
function BrokerTotal({ totals }: { totals: PortfolioTotals }) {
  return (
    <ListRow
      title="All brokers"
      subtitle="= portfolio total"
      right={<Amount value={totals.valueEur} variant="headline" />}
      rightSub={<GainFigure t={totals} />}
      last
    />
  );
}

const SORT_KEYS: SortKey[] = ['value', 'weight', 'gain', 'day'];

/** What to sort by and in which direction (also used in a broker's holdings). */
export function SortPanel(props: {
  sort: Sort;
  onChange(sort: Sort): void;
  keys?: readonly SortKey[];
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.panel}>
      <SegmentedControl
        options={(props.keys ?? SORT_KEYS).map((k) => ({ value: k, label: SORT_LABELS[k] }))}
        value={props.sort.key}
        onChange={(key) => props.onChange({ ...props.sort, key })}
      />
      <SegmentedControl
        options={[
          { value: 'desc', label: 'Highest first' },
          { value: 'asc', label: 'Lowest first' },
        ]}
        value={props.sort.dir}
        onChange={(dir) => props.onChange({ ...props.sort, dir })}
      />
    </View>
  );
}

function ChipGroup<V extends string>(props: {
  title: string;
  options: readonly { value: V; label: string }[];
  chosen: readonly V[];
  onChange(chosen: V[]): void;
}) {
  const styles = useStyles(makeStyles);
  if (props.options.length === 0) return null;
  return (
    <View style={styles.group}>
      <T variant="overline" tone="muted">
        {props.title}
      </T>
      <View style={styles.chips}>
        {props.options.map((o) => {
          const on = props.chosen.includes(o.value);
          return (
            <Chip
              key={o.value}
              label={o.label}
              selected={on}
              accessibilityLabel={`${props.title}: ${o.label}`}
              onPress={() =>
                props.onChange(
                  on ? props.chosen.filter((v) => v !== o.value) : [...props.chosen, o.value],
                )
              }
            />
          );
        })}
      </View>
    </View>
  );
}

function FilterPanel(props: {
  options: ReturnType<typeof filterOptions>;
  names: Names;
  filters: Filters;
  onChange(f: Filters): void;
  closed: boolean;
}) {
  const styles = useStyles(makeStyles);
  const { names, filters: f, onChange } = props;
  const { types, brokers, currencies } = props.options;
  return (
    <View style={styles.panel}>
      <ChipGroup
        title="Type"
        options={types.map((t) => ({ value: t, label: typeLabel(t) }))}
        chosen={f.types}
        onChange={(types) => onChange({ ...f, types })}
      />
      <ChipGroup
        title="Broker"
        options={brokers.map((b) => ({ value: b, label: brokerLabel(names, b) }))}
        chosen={f.brokers}
        onChange={(brokers) => onChange({ ...f, brokers })}
      />
      <ChipGroup
        title="Listing currency"
        options={currencies.map((c) => ({ value: c, label: c }))}
        chosen={f.currencies}
        onChange={(currencies) => onChange({ ...f, currencies })}
      />
      {props.closed ? null : (
        <View style={styles.switchRow}>
          <T variant="body">Stale or pending prices only</T>
          <Switch
            value={f.staleOnly}
            onValueChange={(staleOnly) => onChange({ ...f, staleOnly })}
            accessibilityLabel="Stale only"
          />
        </View>
      )}
      {activeFilterCount(f) > 0 ? (
        <Pressable
          onPress={() => onChange(NO_FILTERS)}
          accessibilityRole="button"
          style={styles.clear}
        >
          <T variant="sub" tone="accent">
            Clear filters
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    controls: {
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: space.sm,
      marginBottom: space.sm,
    },
    // Grows to fill the row; the Sort and Filter chips drop under it on a narrow phone.
    search: { flexGrow: 1, flexBasis: 140, borderRadius: radius.sm, paddingVertical: space.sm },
    content: { paddingBottom: space.xl },
    gutter: { paddingHorizontal: space.lg },
    note: { marginHorizontal: space.lg, marginBottom: space.sm },
    // Opaque, so the rows do not show through while it is pinned.
    groupHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      backgroundColor: colors.background,
    },
    inline: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
    faint: { color: colors.faint },
    panel: { paddingHorizontal: space.lg, marginBottom: space.md, gap: space.sm },
    group: { gap: space.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    switchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    clear: { alignSelf: 'flex-start', minHeight: TOUCH_TARGET, justifyContent: 'center' },
  });
