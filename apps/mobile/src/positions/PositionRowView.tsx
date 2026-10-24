import type { PositionRow } from '@ledgr/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPeriod } from '../format';
import { useRootNavigation } from '../navigation';
import { assetLabel, assetName, type Names } from '../ui/labels';
import { Amount } from '../ui/Amount';
import { Money, Pct, Units } from '../ui/Money';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';

export function Badge({
  text,
  tone = 'warning',
}: {
  text: string;
  tone?: 'warning' | 'muted' | 'danger';
}) {
  const styles = useStyles(makeStyles);
  const toneStyle =
    tone === 'muted'
      ? styles.badgeMuted
      : tone === 'danger'
        ? styles.badgeDanger
        : styles.badgeWarning;
  return <Text style={[styles.badge, toneStyle]}>{text}</Text>;
}

/** "price pending", "stale" or "factor old" for a row's valuation. */
export function ValuationBadge({ row }: { row: Pick<PositionRow, 'valuation'> }) {
  const v = row.valuation;
  if (v.source === 'trade') return <Badge text="price pending" />;
  if (!v.stale) return null;
  return <Badge text={v.source === 'price' ? 'stale' : 'factor old'} />;
}

/**
 * One position (or one broker's units of it): ticker and name, value, weight, unrealized
 * € and %, day %; certificados with their latest factor. Tap → Position detail.
 */
export function PositionRowView(props: {
  row: PositionRow;
  names: Names;
  /** False in a broker's rows: day change is per asset. */
  showDay?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const { row, names } = props;
  const navigation = useRootNavigation();
  const ca = row.certificado;
  return (
    <Pressable
      onPress={() => navigation.navigate('PositionDetail', { assetId: row.assetId })}
      accessibilityRole="button"
      accessibilityLabel={assetLabel(names, row.assetId)}
      style={styles.row}
      testID="position-row"
    >
      <View style={styles.line}>
        <View style={styles.title}>
          <Text style={styles.ticker} numberOfLines={1}>
            {assetLabel(names, row.assetId)}
          </Text>
          <ValuationBadge row={row} />
        </View>
        <Money value={row.valueEur} style={styles.value} />
      </View>
      <View style={styles.line}>
        <Text style={styles.name} numberOfLines={1}>
          {assetName(names, row.assetId)}
        </Text>
        <View style={styles.figures}>
          <Money value={row.unrealizedEur} sign colored style={styles.small} />
          <Pct value={row.unrealizedPct} sign colored style={styles.small} />
        </View>
      </View>
      <View style={styles.line}>
        <View style={styles.figures}>
          <Units value={row.units} style={styles.muted} />
          <Text style={styles.muted}>units</Text>
          {ca ? (
            <>
              <Text style={styles.muted}>· factor</Text>
              <Amount value={ca.unitValueEur} currency="EUR" dp={5} style={styles.muted} />
              {ca.factorMonth ? (
                <Text style={styles.muted}>({formatPeriod(ca.factorMonth.slice(0, 7))})</Text>
              ) : (
                <Text style={styles.muted}>(no factor yet)</Text>
              )}
            </>
          ) : null}
          <Text style={styles.muted}>·</Text>
          <Pct value={row.weight} style={styles.muted} />
        </View>
        {props.showDay === false ? null : row.openedToday ? (
          <Text style={styles.muted}>new today</Text>
        ) : (
          <View style={styles.figures}>
            <Text style={styles.muted}>day</Text>
            <Pct value={row.dayChangePct} sign colored style={styles.small} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: {
      paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 2,
    },
    line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    title: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 },
    ticker: { fontSize: 15, fontWeight: '600', color: colors.text, flexShrink: 1 },
    value: { fontSize: 15, fontWeight: '600', color: colors.text },
    name: { flex: 1, color: colors.muted, fontSize: 12, marginRight: space.sm },
    figures: { flexDirection: 'row', gap: 4, alignItems: 'baseline', flexWrap: 'wrap' },
    small: { fontSize: 13 },
    muted: { color: colors.muted, fontSize: 12 },
    badge: {
      fontSize: 10,
      fontWeight: '600',
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 8,
      overflow: 'hidden',
    },
    badgeWarning: { backgroundColor: colors.warningBg, color: colors.warningText },
    badgeMuted: { backgroundColor: colors.background, color: colors.muted },
    badgeDanger: { backgroundColor: colors.errorBg, color: colors.loss },
  });
