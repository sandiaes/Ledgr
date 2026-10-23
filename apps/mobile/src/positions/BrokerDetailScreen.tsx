import { buildPositions } from '@ledgr/core';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { usePortfolio } from '../data/usePortfolio';
import { useRootNavigation, useRootRoute } from '../navigation';
import { brokerLabel, useNames } from '../ui/labels';
import { Money, Pct } from '../ui/Money';
import { Card, Line } from '../ui/parts';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { colors } from '../ui/theme';
import { DEFAULT_SORT, sortPositions, type Sort } from './listing';
import { PositionRowView } from './PositionRowView';
import { SortPanel } from './PositionsScreen';

/** One broker: its figures and its own units of each position (FIFO per account). */
export function BrokerDetailScreen() {
  const { accountId } = useRootRoute<'BrokerDetail'>().params;
  const state = usePortfolio(buildPositions);
  const names = useNames(state.status === 'ready' ? state.ledger : null);
  const navigation = useRootNavigation();
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  useEffect(() => {
    navigation.setOptions({ title: brokerLabel(names, accountId) });
  }, [navigation, names, accountId]);
  const view = state.status === 'ready' && state.view.status === 'ok' ? state.view : null;
  const broker = view?.brokers.find((b) => b.accountId === accountId);
  const rows = useMemo(() => (broker ? sortPositions(broker.positions, sort) : []), [broker, sort]);
  return (
    <PortfolioScreen state={state} what="broker">
      {() =>
        !broker ? (
          <Card>
            <Text style={styles.muted}>Nothing held or realized at this broker.</Text>
          </Card>
        ) : (
          <>
            <Card>
              <Line label="Value" strong>
                <Money value={broker.valueEur} style={styles.strong} />
              </Line>
              <Line label="Weight">
                <Pct value={broker.weight} />
              </Line>
              <Line label="Cost basis">
                <Money value={broker.costBasisEur} />
              </Line>
              <Line label="Unrealized">
                <Money value={broker.unrealizedEur} sign />
              </Line>
              <Line label="Realized">
                <Money value={broker.realizedEur} sign />
              </Line>
              <Line label="Income">
                <Money value={broker.incomeNetEur} sign />
              </Line>
              <Line label="Other costs">
                <Money value={broker.otherCostsEur.neg()} sign />
              </Line>
              <Line label="Gain" strong>
                <Money value={broker.totalGainEur} sign colored style={styles.strong} />
              </Line>
            </Card>
            <SortPanel sort={sort} onChange={setSort} keys={['value', 'weight', 'gain']} />
            <Card title="Holdings at this broker">
              {rows.length === 0 ? <Text style={styles.muted}>No units held here.</Text> : null}
              {rows.map((r) => (
                <PositionRowView key={r.assetId} row={r} names={names} showDay={false} />
              ))}
            </Card>
          </>
        )
      }
    </PortfolioScreen>
  );
}

const styles = StyleSheet.create({
  strong: { fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
});
