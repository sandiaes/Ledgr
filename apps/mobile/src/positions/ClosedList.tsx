import type { ClosedPosition } from '@ledgr/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDate } from '../format';
import { assetLabel, assetName, brokerLabel, type Names } from '../ui/labels';
import { Money, Pct, Units } from '../ui/Money';
import { Banner } from '../ui/parts';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';

function Line(props: { label: string; children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.line}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.figures}>{props.children}</View>
    </View>
  );
}

/** One closed position: realized € and %; tap for its figures and broker split. */
function ClosedItem({ c, names }: { c: ClosedPosition; names: Names }) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen(!open)}
      accessibilityRole="button"
      accessibilityLabel={assetLabel(names, c.assetId)}
      style={styles.item}
      testID="closed-row"
    >
      <View style={styles.line}>
        <Text style={styles.ticker}>{assetLabel(names, c.assetId)}</Text>
        <View style={styles.figures}>
          <Money value={c.realizedEur} sign colored style={styles.strong} />
          <Pct value={c.realizedPct} sign colored style={styles.small} />
        </View>
      </View>
      <View style={styles.line}>
        <Text style={styles.name} numberOfLines={1}>
          {assetName(names, c.assetId)}
        </Text>
        <Text style={styles.muted}>
          {formatDate(c.firstBuy)} {c.firstBuy.slice(0, 4)} → {formatDate(c.lastSale)}{' '}
          {c.lastSale.slice(0, 4)}
        </Text>
      </View>
      {open ? (
        <View style={styles.details}>
          <Line label="Units bought / sold">
            <Units value={c.unitsBought} style={styles.small} />
            <Text style={styles.muted}>/</Text>
            <Units value={c.unitsSold} style={styles.small} />
          </Line>
          <Line label="Cost of units sold (FIFO)">
            <Money value={c.costEur} style={styles.small} />
          </Line>
          <Line label="Proceeds (net of fees)">
            <Money value={c.proceedsEur} style={styles.small} />
          </Line>
          <Line label="Income while held">
            <Money value={c.incomeEur} style={styles.small} />
          </Line>
          <Text style={styles.subtitle}>By broker</Text>
          {c.accounts.map((a) => (
            <Line key={a.accountId} label={brokerLabel(names, a.accountId)}>
              <Units value={a.unitsSold} style={styles.muted} />
              <Text style={styles.muted}>sold ·</Text>
              <Money value={a.realizedEur} sign colored style={styles.small} />
            </Line>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

/** Realized results per fully closed asset (docs/kpis.md §8). */
export function ClosedList(props: { closed: readonly ClosedPosition[]; names: Names }) {
  const styles = useStyles(makeStyles);
  return (
    <>
      <Banner tone="warning">
        Performance, not tax: realized gains here use FIFO per broker over the ledger. Tax figures
        come from the brokers’ reports.
      </Banner>
      <View style={styles.list}>
        {props.closed.length === 0 ? (
          <Text style={styles.muted}>No closed positions.</Text>
        ) : (
          props.closed.map((c) => <ClosedItem key={c.assetId} c={c} names={props.names} />)
        )}
      </View>
    </>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: space.lg,
      paddingVertical: space.xs,
      marginHorizontal: space.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    item: {
      paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    line: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      paddingVertical: 1,
    },
    figures: { flexDirection: 'row', gap: 4, alignItems: 'baseline' },
    ticker: { fontSize: 15, fontWeight: '600', color: colors.text },
    name: { flex: 1, color: colors.muted, fontSize: 12, marginRight: space.sm },
    strong: { fontSize: 15, fontWeight: '600', color: colors.text },
    small: { fontSize: 13, color: colors.text },
    muted: { color: colors.muted, fontSize: 12 },
    label: { color: colors.text, fontSize: 13 },
    details: { marginTop: space.sm, gap: 2 },
    subtitle: { fontSize: 12, fontWeight: '600', color: colors.muted, marginTop: space.xs },
  });
