import type { PositionRow } from '@ledgr/core';
import { StyleSheet, View } from 'react-native';
import { formatPeriod } from '../format';
import { useRootNavigation } from '../navigation';
import { Amount } from '../ui/Amount';
import { Badge as Tag } from '../ui/Chip';
import { assetLabel, assetName, type Names } from '../ui/labels';
import { ListRow } from '../ui/ListRow';
import { T } from '../ui/T';
import { space } from '../ui/theme';

/** A small tag ("stale", "price pending", "approx."); the one `ui/Chip` Badge. */
export function Badge({ text, tone }: { text: string; tone?: 'warning' | 'muted' | 'danger' }) {
  return <Tag label={text} tone={tone} />;
}

/** "price pending", "stale" or "factor old" for a row's valuation. */
export function ValuationBadge({ row }: { row: Pick<PositionRow, 'valuation'> }) {
  const v = row.valuation;
  if (v.source === 'trade') return <Badge text="price pending" />;
  if (!v.stale) return null;
  return <Badge text={v.source === 'price' ? 'stale' : 'factor old'} />;
}

/**
 * One position (or one broker's units of it) as a list row: ticker and valuation tag over
 * the name over its units and weight; value, unrealized € and %, and the day change on the
 * right. Certificados show their latest factor beside the units. Tap → Position detail.
 */
export function PositionRowView(props: {
  row: PositionRow;
  names: Names;
  /** False in a broker's rows: day change is per asset. */
  showDay?: boolean;
  last?: boolean;
}) {
  const { row, names } = props;
  const navigation = useRootNavigation();
  const ca = row.certificado;
  const showDay = props.showDay !== false;
  return (
    <ListRow
      testID="position-row"
      accessibilityLabel={assetLabel(names, row.assetId)}
      onPress={() => navigation.navigate('PositionDetail', { assetId: row.assetId })}
      last={props.last}
      title={
        <View style={styles.inline}>
          <T variant="headline" numberOfLines={1} style={styles.ticker}>
            {assetLabel(names, row.assetId)}
          </T>
          <ValuationBadge row={row} />
        </View>
      }
      subtitle={
        <View style={styles.stack}>
          <T variant="sub" tone="muted" numberOfLines={1}>
            {assetName(names, row.assetId)}
          </T>
          <T variant="caption" tone="muted">
            <Amount kind="units" value={row.units} /> units
            {ca ? (
              <>
                {' · factor '}
                <Amount value={ca.unitValueEur} currency="EUR" dp={5} />
                {ca.factorMonth
                  ? ` (${formatPeriod(ca.factorMonth.slice(0, 7))})`
                  : ' (no factor yet)'}
              </>
            ) : null}
            {' · '}
            <Amount kind="pct" value={row.weight} />
          </T>
        </View>
      }
      right={<Amount value={row.valueEur} variant="headline" />}
      rightSub={
        <View style={styles.figures}>
          <View style={styles.inline}>
            <Amount value={row.unrealizedEur} sign tone variant="sub" />
            <Amount kind="pct" value={row.unrealizedPct} sign tone variant="sub" />
          </View>
          {showDay ? (
            row.openedToday ? (
              <T variant="caption" tone="muted">
                new today
              </T>
            ) : (
              <T variant="caption" tone="muted">
                day <Amount kind="pct" value={row.dayChangePct} sign tone />
              </T>
            )
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  ticker: { flexShrink: 1 },
  stack: { gap: space.hairline },
  figures: { alignItems: 'flex-end', gap: space.hairline },
});
