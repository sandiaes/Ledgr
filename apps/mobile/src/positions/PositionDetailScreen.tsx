import {
  buildPositions,
  priceSeries,
  SERIES_RANGES,
  type IsoDate,
  type PositionDetail,
  type PositionsView,
  type SeriesRange,
} from '@ledgr/core';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { usePortfolio, usePriceHistory } from '../data/usePortfolio';
import { formatDate, formatPeriod } from '../format';
import { useRootNavigation, useRootRoute } from '../navigation';
import type { Market } from '../services';
import { Amount } from '../ui/Amount';
import { ChartFrame } from '../ui/ChartFrame';
import { EmptyState, ErrorState } from '../ui/EmptyState';
import { FigureLine } from '../ui/FigureLine';
import { assetLabel, assetName, brokerLabel, typeLabel, useNames, type Names } from '../ui/labels';
import { Banner, Button } from '../ui/parts';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { excludesCertificados } from '../ui/Scope';
import { Section } from '../ui/Section';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Skeleton, SkeletonChart } from '../ui/Skeleton';
import { T } from '../ui/T';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import { Badge, ValuationBadge } from './PositionRowView';
import { PriceChart, PRICE_CHART_HEIGHT } from './PriceChart';

export function PositionDetailScreen() {
  const { assetId } = useRootRoute<'PositionDetail'>().params;
  const state = usePortfolio(buildPositions);
  const names = useNames(state.status === 'ready' ? state.ledger : null);
  return (
    <PortfolioScreen state={state} what="position" skeleton={<DetailSkeleton />}>
      {(view, ready) => (
        <Detail view={view} market={ready.market} assetId={assetId} names={names} />
      )}
    </PortfolioScreen>
  );
}

/** The hero figure, a few figure rows and the chart: the shape of the loaded screen. */
function DetailSkeleton() {
  return (
    <View style={styles.skeleton}>
      <Skeleton width="50%" height={16} />
      <Skeleton width="60%" height={34} />
      <Skeleton width="40%" height={14} />
      <View style={styles.gap} />
      <SkeletonChart />
    </View>
  );
}

function Detail(props: { view: PositionsView; market: Market; assetId: string; names: Names }) {
  const { view, assetId, names } = props;
  const navigation = useRootNavigation();
  const p = view.details[assetId];
  const row = view.positions.find((r) => r.assetId === assetId);
  const type = names.assets.get(assetId)?.assetType;
  if (type && excludesCertificados(view.excludeTypes) && type === 'certificado_aforro') {
    return (
      <EmptyState
        icon="noMatch"
        title="Not included"
        line="Certificados are excluded (Dashboard, “Include certificados de aforro”). They stay under the drawer’s Certificados."
      />
    );
  }
  if (!p || !row) {
    return (
      <EmptyState
        title={`${assetLabel(names, assetId)} is not held today`}
        line="Its realized result is under Closed positions."
        action={{
          label: 'Transactions',
          onPress: () => navigation.navigate('AssetTransactions', { assetId }),
        }}
      />
    );
  }
  const asset = names.assets.get(assetId);
  const year = view.today.slice(0, 4);
  return (
    <>
      <View style={styles.hero}>
        <T variant="headline" numberOfLines={1}>
          {assetLabel(names, assetId)}
        </T>
        <T variant="sub" tone="muted">
          {assetName(names, assetId)} · {typeLabel(row.assetType)}
          {asset?.isin ? ` · ${asset.isin}` : ''}
        </T>
        <Amount value={p.valueEur} variant="title1" style={styles.total} />
        <View style={styles.inline}>
          {p.dayChange?.openedToday ? (
            <T variant="sub" tone="muted">
              new today
            </T>
          ) : (
            <>
              <Amount value={p.dayChange?.changeEur ?? null} sign tone variant="body" />
              <Amount kind="pct" value={p.dayChange?.changePct ?? null} sign tone variant="body" />
              <T variant="sub" tone="muted">
                today
              </T>
            </>
          )}
        </View>
        <View style={[styles.inline, styles.priceLine]}>
          <ValuationBadge row={row} />
          {p.price ? (
            <>
              <T variant="caption" tone="muted">
                {row.valuation.source === 'trade' ? 'last trade price' : 'price'}
              </T>
              <Amount value={p.price.close} currency={p.price.currency} variant="caption" />
              <T variant="caption" tone="muted">
                {formatDate(p.price.date, year)}
              </T>
            </>
          ) : null}
        </View>
      </View>

      <Section title="Position">
        <FigureLine label="Units">
          <Amount kind="units" value={p.units} />
        </FigureLine>
        <FigureLine label="Average cost">
          <Amount value={p.averageCostEur} currency="EUR" />
        </FigureLine>
        <FigureLine label="Cost basis">
          <Amount value={p.costBasisEur} />
        </FigureLine>
        <FigureLine label="Weight">
          <Amount kind="pct" value={p.weight} />
        </FigureLine>
        <FigureLine label="Unrealized gain">
          <Amount value={p.unrealizedEur} sign tone />
          <T variant="sub" tone="muted">
            <Amount kind="pct" value={p.unrealizedPct} sign />
          </T>
        </FigureLine>
        <FigureLine label="Realized gain">
          <Amount value={p.realizedEur} sign />
        </FigureLine>
        <FigureLine label="Income">
          <Amount value={p.incomeEur} sign />
        </FigureLine>
      </Section>

      {row.assetType === 'certificado_aforro' ? (
        <Subscriptions detail={p} today={view.today} />
      ) : (
        <PriceSection
          assetId={assetId}
          currency={asset?.tradingCurrency ?? p.price?.currency ?? 'EUR'}
          market={props.market}
          today={view.today}
        />
      )}

      <Section title="Split by broker">
        {p.accounts.map((a) => (
          <Block key={a.accountId} testID="broker-split">
            <FigureLine label={brokerLabel(names, a.accountId)} strong>
              <Amount value={a.valueEur} variant="headline" />
            </FigureLine>
            <FigureLine label="Units · cost" sub>
              <Amount kind="units" value={a.units} />
              <T variant="sub" tone="faint">
                ·
              </T>
              <Amount value={a.costBasisEur} />
            </FigureLine>
            <FigureLine label="Unrealized · realized" sub>
              <Amount value={a.unrealizedEur} sign tone />
              <T variant="sub" tone="faint">
                ·
              </T>
              <Amount value={a.realizedEur} sign tone />
            </FigureLine>
          </Block>
        ))}
      </Section>

      <Section title="Open lots (FIFO per broker)">
        {p.lots.map((l) => (
          <Block key={l.lotId} testID="open-lot">
            <FigureLine
              label={`${formatDate(l.acquiredOn, year)} · ${brokerLabel(names, l.accountId)}`}
            >
              <Amount value={l.costEur} />
            </FigureLine>
            <FigureLine label="Units · unit cost" sub>
              <Amount kind="units" value={l.units} />
              <T variant="sub" tone="faint">
                @
              </T>
              <Amount value={l.unitCostEur} currency="EUR" />
            </FigureLine>
          </Block>
        ))}
      </Section>

      <View style={styles.buttons}>
        <Button
          label="Transactions"
          onPress={() => navigation.navigate('AssetTransactions', { assetId })}
        />
      </View>
    </>
  );
}

/** A group of figure lines with a hairline under it, in a compact table. */
function Block(props: { children: ReactNode; testID: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.block} testID={props.testID}>
      {props.children}
    </View>
  );
}

/** Split-adjusted closes from the asset's whole (paginated) price history. */
function PriceSection(props: {
  assetId: string;
  currency: string;
  market: Market;
  today: IsoDate;
}) {
  const [range, setRange] = useState<SeriesRange>('1Y');
  const history = usePriceHistory(props.assetId, true);
  const series = useMemo(
    () =>
      history.data
        ? priceSeries({
            assetId: props.assetId,
            currency: props.currency,
            prices: history.data,
            liveQuotes: props.market.liveQuotes,
            today: props.today,
            range,
          })
        : null,
    [history.data, props.assetId, props.currency, props.market, props.today, range],
  );
  const controls = (
    <SegmentedControl
      options={SERIES_RANGES.map((r) => ({ value: r, label: r }))}
      value={range}
      onChange={setRange}
    />
  );
  let body;
  if (history.isError) {
    body = (
      <ErrorState
        title="Could not load the prices"
        code={errorCode(history.error)}
        hint="Open the screen again to retry"
      />
    );
  } else if (!series) {
    body = <SkeletonChart height={PRICE_CHART_HEIGHT} />;
  } else {
    const first = series.chart[0];
    const last = series.chart[series.chart.length - 1];
    body = (
      <ChartFrame
        height={PRICE_CHART_HEIGHT}
        empty={series.chart.length < 2}
        emptyText="Not enough prices for a chart in this range"
        xLabels={first && last ? [formatDate(first.date), formatDate(last.date)] : undefined}
        controls={controls}
        summary={
          <View style={styles.change}>
            <T variant="body">Change in range</T>
            <View style={styles.inline}>
              {series.change ? (
                <Amount value={series.change} currency={series.currency} sign tone variant="body" />
              ) : (
                <T variant="body">—</T>
              )}
              <Amount kind="pct" value={series.changePct} sign tone variant="body" />
            </View>
          </View>
        }
        legend={
          <T variant="caption" tone="faint">
            Split-adjusted closes in {series.currency}.
          </T>
        }
      >
        <PriceChart points={series.chart} currency={series.currency} />
      </ChartFrame>
    );
  }
  return <Section title="Price">{body}</Section>;
}

/** Certificados: each held subscription with its units, latest factor and value. */
function Subscriptions({ detail, today }: { detail: PositionDetail; today: IsoDate }) {
  const year = today.slice(0, 4);
  return (
    <Section title="Subscriptions (value from factor)">
      {detail.certificados.length === 0 ? (
        <Banner tone="warning">These units are not linked to a subscription.</Banner>
      ) : null}
      {detail.certificados.map((s) => (
        <Block key={s.subscriptionId} testID="ca-subscription">
          <FigureLine label={`Subscribed ${formatDate(s.subscribedOn, year)}`} strong>
            <Amount value={s.valueEur} variant="headline" />
          </FigureLine>
          <FigureLine label="Units · factor" sub>
            <Amount kind="units" value={s.units} />
            <T variant="sub" tone="faint">
              ×
            </T>
            <Amount value={s.unitValueEur} currency="EUR" dp={5} />
          </FigureLine>
          <View style={styles.inline}>
            <T variant="caption" tone="muted">
              {s.factorMonth
                ? `factor of ${formatPeriod(s.factorMonth.slice(0, 7))}, ${s.ageDays} days old`
                : 'no factor yet: subscription price'}
            </T>
            {s.stale ? <Badge text="factor old" /> : null}
          </View>
          <FigureLine label="Gain" sub>
            <Amount value={s.gainEur} sign tone />
          </FigureLine>
        </Block>
      ))}
    </Section>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    block: {
      paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
  });

const styles = StyleSheet.create({
  hero: { paddingHorizontal: space.lg, marginBottom: space.xl, gap: 2 },
  total: { marginVertical: space.xs },
  inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  priceLine: { marginTop: space.xs },
  change: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: space.md,
  },
  buttons: { marginHorizontal: space.lg },
  skeleton: { gap: space.sm },
  gap: { height: space.md },
});
