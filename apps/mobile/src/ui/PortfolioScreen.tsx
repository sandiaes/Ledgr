import type { IsoDate, PortfolioUnvalued, ScopedView } from '@ledgr/core';
import { useScrollToTop } from '@react-navigation/native';
import { useRef, type ReactElement, type ReactNode, type ComponentRef } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { PortfolioResult, PortfolioState } from '../data/usePortfolio';
import { formatDate, formatTime } from '../format';
import { ErrorState } from './EmptyState';
import { Banner } from './parts';
import { NothingInScope, ScopeNote } from './Scope';
import { SkeletonRows } from './Skeleton';
import { T } from './T';
import { space } from './theme';
import { useColors } from './ThemeProvider';

type Ready<V> = Extract<PortfolioState<V>, { status: 'ready' }>;
type Valued<V> = Exclude<V, PortfolioUnvalued>;

/**
 * What a screen that scrolls itself (a virtualized list) takes from the frame: the same
 * pull to refresh and the same "as of" / scope lines as every other screen.
 */
export interface ListFrame {
  /** For the list's `refreshControl`. */
  refreshControl: ReactElement;
  /** The "as of" line and the scope note, for the top of the list. */
  intro: ReactNode;
  /** Plain scrolling content in the same frame (a list screen with nothing to list). */
  plain(content: ReactNode): ReactNode;
}

/**
 * The frame of every screen built from the portfolio: pull to refresh, loading, an error in
 * place (a code, never an amount), "as of" with the price date, the "no FX rate" case in
 * which no figure is shown, and the asset scope: "Excluding certificados" while they are
 * left out, and an empty state when nothing else is held.
 *
 * With `list`, the screen is a virtualized list that scrolls itself: it gets a `ListFrame`
 * and the frame no longer wraps it in a ScrollView (a list inside a ScrollView is not
 * virtualized). Loading, error and the other states still use the plain frame.
 */
export function PortfolioScreen<V extends { status: string; today: IsoDate }>(props: {
  state: PortfolioResult<V>;
  /** "positions", "allocation"... for the error message. */
  what: string;
  /** Shown while loading; left out, six list rows. Mirror the final layout. */
  skeleton?: ReactNode;
  list?: boolean;
  children: (view: Valued<V>, ready: Ready<V>, frame: ListFrame) => ReactNode;
}) {
  const colors = useColors();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  // Pressing the current tab again scrolls to the top (only on a tab screen).
  useScrollToTop(scrollRef);
  const { state } = props;
  const refresh = (
    <RefreshControl
      refreshing={state.refreshing}
      onRefresh={() => void state.refresh()}
      colors={[colors.accent]}
      progressBackgroundColor={colors.raised}
    />
  );
  const scroll = (content: ReactNode) => (
    <ScrollView
      ref={scrollRef}
      refreshControl={refresh}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View>{content}</View>
    </ScrollView>
  );

  if (state.status === 'loading') {
    return scroll(
      <View style={styles.pad} testID="portfolio-loading">
        {props.skeleton ?? <SkeletonRows n={6} />}
      </View>,
    );
  }
  if (state.status === 'error') {
    return scroll(<ErrorState title={`Could not load the ${props.what}`} code={state.code} />);
  }

  const view = state.view;
  const year = view.today.slice(0, 4);
  if (view.status === 'unvalued') {
    const u = view as unknown as PortfolioUnvalued;
    return scroll(
      <Banner tone="warning">
        No exchange rate for {u.currencies.join(', ')} on {formatDate(u.date, year)}: the figures
        cannot be shown until the next rate is stored.
      </Banner>,
    );
  }
  const newest = (view as { newestPriceDate?: IsoDate | null }).newestPriceDate;
  const scoped = view as unknown as Partial<ScopedView>;
  const intro = (
    <>
      <T variant="caption" tone="faint" style={styles.asOf}>
        as of {formatTime(state.asOf)}
        {newest ? ` · prices ${formatDate(newest, year)}` : ''}
        {state.liveUnavailable ? ' · live prices unavailable' : ''}
      </T>
      <ScopeNote excludeTypes={scoped.excludeTypes} />
    </>
  );
  const frame: ListFrame = {
    refreshControl: refresh,
    intro,
    plain: (content) =>
      scroll(
        <>
          {intro}
          {content}
        </>,
      ),
  };
  if (scoped.emptyInScope) {
    return scroll(
      <>
        {intro}
        <NothingInScope />
      </>,
    );
  }
  const body = props.children(view as Valued<V>, state as Ready<V>, frame);
  if (props.list) return <View style={styles.fill}>{body}</View>;
  return scroll(
    <>
      {intro}
      {body}
    </>,
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: space.md, paddingBottom: space.xl },
  pad: { paddingHorizontal: space.lg },
  asOf: { marginHorizontal: space.lg, marginBottom: space.sm },
});
