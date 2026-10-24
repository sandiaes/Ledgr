import {
  buildPositions,
  priceSeries,
  SERIES_RANGES,
  type IsoDate,
  type PositionDetail,
  type PositionsView,
  type SeriesRange,
} from '@ledgr/core';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { usePortfolio, usePriceHistory } from '../data/usePortfolio';
import { formatDate, formatPeriod } from '../format';
import { useRootNavigation, useRootRoute } from '../navigation';
import type { Market } from '../services';
import { assetLabel, assetName, brokerLabel, typeLabel, useNames, type Names } from '../ui/labels';
import { Amount } from '../ui/Amount';
import { Money, Pct, Units } from '../ui/Money';
import { Banner, Button, Card, Line, Segmented } from '../ui/parts';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { excludesCertificados } from '../ui/Scope';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import { Badge, ValuationBadge } from './PositionRowView';
import { PriceChart } from './PriceChart';

export function PositionDetailScreen() {
  const { assetId } = useRootRoute<'PositionDetail'>().params;
  const state = usePortfolio(buildPositions);
  const names = useNames(state.status === 'ready' ? state.ledger : null);
  const navigation = useRootNavigation();
  useEffect(() => {
    navigation.setOptions({ title: assetLabel(names, assetId) });
  }, [navigation, names, assetId]);
  return (
    <PortfolioScreen state={state} what="position">
      {(view, ready) => (
        <Detail view={view} market={ready.market} assetId={assetId} names={names} />
      )}
    </PortfolioScreen>
  );
}

function Detail(props: { view: PositionsView; market: Market; assetId: string; names: Names }) {
  const styles = useStyles(makeStyles);
  const { view, assetId, names } = props;
  const navigation = useRootNavigation();
  const p = view.details[assetId];
  const row = view.positions.find((r) => r.assetId === assetId);
  const type = names.assets.get(assetId)?.assetType;
  if (type && excludesCertificados(view.excludeTypes) && type === 'certificado_aforro') {
    return (
      <Card>
        <Text style={styles.muted}>
          Not included: certificados are excluded (Dashboard, “Include certificados de aforro”).
          They stay under More › Certificados.
        </Text>
      </Card>
    );
  }
  if (!p || !row) {
    return (
      <Card>
        <Text style={styles.muted}>
          {assetLabel(names, assetId)} is not held today. Its realized result is under Closed
          positions.
        </Text>
        <Button
          label="Transactions"
          onPress={() => navigation.navigate('AssetTransactions', { assetId })}
        />
      </Card>
    );
  }
  const asset = names.assets.get(assetId);
  const year = view.today.slice(0, 4);
  return (
    <>
      <Card>
        <Text style={styles.caption}>
          {assetName(names, assetId)} · {typeLabel(row.assetType)}
          {asset?.isin ? ` · ${asset.isin}` : ''}
        </Text>
        <Money value={p.valueEur} style={styles.total} />
        <View style={styles.figures}>
          {p.dayChange?.openedToday ? (
            <Text style={styles.muted}>new today</Text>
          ) : (
            <>
              <Money value={p.dayChange?.changeEur ?? null} sign colored style={styles.day} />
              <Pct value={p.dayChange?.changePct ?? null} sign colored style={styles.day} />
              <Text style={styles.muted}> today</Text>
            </>
          )}
        </View>
        <View style={[styles.figures, styles.priceLine]}>
          <ValuationBadge row={row} />
          {p.price ? (
            <>
              <Text style={styles.muted}>
                {row.valuation.source === 'trade' ? 'last trade price' : 'price'}
              </Text>
              <Amount value={p.price.close} currency={p.price.currency} style={styles.muted} />
              <Text style={styles.muted}>{formatDate(p.price.date, year)}</Text>
            </>
          ) : null}
        </View>
      </Card>

      <Card title="Position">
        <Line label="Units">
          <Units value={p.units} />
        </Line>
        <Line label="Average cost">
          <Amount value={p.averageCostEur} currency="EUR" />
        </Line>
        <Line label="Cost basis">
          <Money value={p.costBasisEur} />
        </Line>
        <Line label="Weight">
          <Pct value={p.weight} />
        </Line>
        <Line label="Unrealized gain">
          <Money value={p.unrealizedEur} sign colored />
          <Pct value={p.unrealizedPct} sign style={styles.muted} />
        </Line>
        <Line label="Realized gain">
          <Money value={p.realizedEur} sign />
        </Line>
        <Line label="Income">
          <Money value={p.incomeEur} sign />
        </Line>
      </Card>

      {row.assetType === 'certificado_aforro' ? (
        <Subscriptions detail={p} today={view.today} />
      ) : (
        <PriceCard
          assetId={assetId}
          currency={asset?.tradingCurrency ?? p.price?.currency ?? 'EUR'}
          market={props.market}
          today={view.today}
        />
      )}

      <Card title="Split by broker">
        {p.accounts.map((a) => (
          <View key={a.accountId} style={styles.block} testID="broker-split">
            <Line label={brokerLabel(names, a.accountId)} strong>
              <Money value={a.valueEur} style={styles.strong} />
            </Line>
            <Line label="Units · cost">
              <Units value={a.units} style={styles.small} />
              <Text style={styles.muted}>·</Text>
              <Money value={a.costBasisEur} style={styles.small} />
            </Line>
            <Line label="Unrealized · realized">
              <Money value={a.unrealizedEur} sign colored style={styles.small} />
              <Text style={styles.muted}>·</Text>
              <Money value={a.realizedEur} sign colored style={styles.small} />
            </Line>
          </View>
        ))}
      </Card>

      <Card title="Open lots (FIFO per broker)">
        {p.lots.map((l) => (
          <View key={l.lotId} style={styles.block} testID="open-lot">
            <Line label={`${formatDate(l.acquiredOn, year)} · ${brokerLabel(names, l.accountId)}`}>
              <Money value={l.costEur} style={styles.small} />
            </Line>
            <Line label="Units · unit cost">
              <Units value={l.units} style={styles.small} />
              <Text style={styles.muted}>@</Text>
              <Amount value={l.unitCostEur} currency="EUR" style={styles.small} />
            </Line>
          </View>
        ))}
      </Card>

      <View style={styles.buttons}>
        <Button
          label="Transactions"
          onPress={() => navigation.navigate('AssetTransactions', { assetId })}
        />
      </View>
    </>
  );
}

/** Split-adjusted closes from the asset's whole (paginated) price history. */
function PriceCard(props: { assetId: string; currency: string; market: Market; today: IsoDate }) {
  const styles = useStyles(makeStyles);
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
  return (
    <Card title="Price">
      <Segmented
        options={SERIES_RANGES.map((r) => ({ value: r, label: r }))}
        value={range}
        onChange={setRange}
      />
      {history.isError ? (
        <Text style={styles.muted}>Could not load the prices ({errorCode(history.error)}).</Text>
      ) : !series ? (
        <Text style={styles.muted}>Loading prices…</Text>
      ) : (
        <>
          <PriceChart points={series.chart} currency={series.currency} />
          <Line label="Change in range">
            {series.change ? (
              <Amount value={series.change} currency={series.currency} sign style={styles.small} />
            ) : (
              <Text style={styles.small}>—</Text>
            )}
            <Pct value={series.changePct} sign colored style={styles.small} />
          </Line>
          <Text style={styles.note}>Split-adjusted closes in {series.currency}.</Text>
        </>
      )}
    </Card>
  );
}

/** Certificados: each held subscription with its units, latest factor and value. */
function Subscriptions({ detail, today }: { detail: PositionDetail; today: IsoDate }) {
  const styles = useStyles(makeStyles);
  const year = today.slice(0, 4);
  return (
    <Card title="Subscriptions (value from factor)">
      {detail.certificados.length === 0 ? (
        <Banner tone="warning">These units are not linked to a subscription.</Banner>
      ) : null}
      {detail.certificados.map((s) => (
        <View key={s.subscriptionId} style={styles.block} testID="ca-subscription">
          <Line label={`Subscribed ${formatDate(s.subscribedOn, year)}`} strong>
            <Money value={s.valueEur} style={styles.strong} />
          </Line>
          <Line label="Units · factor">
            <Units value={s.units} style={styles.small} />
            <Text style={styles.muted}>×</Text>
            <Amount value={s.unitValueEur} currency="EUR" dp={5} style={styles.small} />
          </Line>
          <View style={styles.figures}>
            <Text style={styles.muted}>
              {s.factorMonth
                ? `factor of ${formatPeriod(s.factorMonth.slice(0, 7))}, ${s.ageDays} days old`
                : 'no factor yet: subscription price'}
            </Text>
            {s.stale ? <Badge text="factor old" /> : null}
          </View>
          <Line label="Gain">
            <Money value={s.gainEur} sign colored style={styles.small} />
          </Line>
        </View>
      ))}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    caption: { fontSize: 13, color: colors.muted },
    total: { fontSize: 28, fontWeight: '700', color: colors.text, marginVertical: space.xs },
    day: { fontSize: 15, fontWeight: '600' },
    priceLine: { marginTop: space.xs },
    figures: { flexDirection: 'row', gap: 4, alignItems: 'baseline', flexWrap: 'wrap' },
    strong: { fontWeight: '700', color: colors.text },
    small: { fontSize: 13, color: colors.text },
    muted: { color: colors.muted, fontSize: 12 },
    note: { color: colors.muted, fontSize: 11, marginTop: space.xs },
    block: {
      paddingVertical: space.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    buttons: { marginHorizontal: space.lg },
  });
