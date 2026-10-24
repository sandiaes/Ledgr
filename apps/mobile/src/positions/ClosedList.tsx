import type { ClosedPosition } from '@ledgr/core';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDate } from '../format';
import { Amount } from '../ui/Amount';
import { FigureLine } from '../ui/FigureLine';
import { assetLabel, assetName, brokerLabel, type Names } from '../ui/labels';
import { ListRow } from '../ui/ListRow';
import { T } from '../ui/T';
import { space } from '../ui/theme';

/**
 * One closed position (docs/kpis.md §8): realized € and % on the right, the name and the
 * dates held under the ticker; tap for its figures and the split by broker.
 */
export function ClosedItem(props: { c: ClosedPosition; names: Names; last?: boolean }) {
  const { c, names } = props;
  const [open, setOpen] = useState(false);
  return (
    <ListRow
      testID="closed-row"
      accessibilityLabel={assetLabel(names, c.assetId)}
      onPress={() => setOpen(!open)}
      last={props.last}
      title={assetLabel(names, c.assetId)}
      subtitle={`${assetName(names, c.assetId)} · ${formatDate(c.firstBuy)} → ${formatDate(c.lastSale)}`}
      right={<Amount value={c.realizedEur} sign tone variant="headline" />}
      rightSub={<Amount kind="pct" value={c.realizedPct} sign tone variant="sub" />}
      footer={
        open ? (
          <View style={styles.details}>
            <FigureLine label="Units bought / sold" sub>
              <Amount kind="units" value={c.unitsBought} />
              <T variant="sub" tone="faint">
                /
              </T>
              <Amount kind="units" value={c.unitsSold} />
            </FigureLine>
            <FigureLine label="Cost of units sold (FIFO)" sub>
              <Amount value={c.costEur} />
            </FigureLine>
            <FigureLine label="Proceeds (net of fees)" sub>
              <Amount value={c.proceedsEur} />
            </FigureLine>
            <FigureLine label="Income while held" sub>
              <Amount value={c.incomeEur} />
            </FigureLine>
            <T variant="overline" tone="muted" style={styles.subtitle}>
              By broker
            </T>
            {c.accounts.map((a) => (
              <FigureLine key={a.accountId} label={brokerLabel(names, a.accountId)} sub>
                <Amount kind="units" value={a.unitsSold} />
                <T variant="sub" tone="faint">
                  sold ·
                </T>
                <Amount value={a.realizedEur} sign tone />
              </FigureLine>
            ))}
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  details: { gap: space.hairline },
  subtitle: { marginTop: space.sm },
});
