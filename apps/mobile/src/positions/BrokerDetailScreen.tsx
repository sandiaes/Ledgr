import { buildPositions } from '@ledgr/core';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePortfolio } from '../data/usePortfolio';
import { useRootRoute } from '../navigation';
import { Amount } from '../ui/Amount';
import { EmptyState } from '../ui/EmptyState';
import { FigureLine } from '../ui/FigureLine';
import { brokerLabel, useNames } from '../ui/labels';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { excludesCertificados } from '../ui/Scope';
import { Section } from '../ui/Section';
import { SkeletonRows } from '../ui/Skeleton';
import { T } from '../ui/T';
import { space } from '../ui/theme';
import { DEFAULT_SORT, sortPositions, type Sort } from './listing';
import { PositionRowView } from './PositionRowView';
import { SortPanel } from './PositionsScreen';

/** One broker: its figures and its own units of each position (FIFO per account). */
export function BrokerDetailScreen() {
  const { accountId } = useRootRoute<'BrokerDetail'>().params;
  const state = usePortfolio(buildPositions);
  const names = useNames(state.status === 'ready' ? state.ledger : null);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const view = state.status === 'ready' && state.view.status === 'ok' ? state.view : null;
  const broker = view?.brokers.find((b) => b.accountId === accountId);
  const rows = useMemo(() => (broker ? sortPositions(broker.positions, sort) : []), [broker, sort]);
  return (
    <PortfolioScreen state={state} what="broker" skeleton={<SkeletonRows n={8} />}>
      {() =>
        !broker ? (
          <EmptyState
            title={
              excludesCertificados(view?.excludeTypes)
                ? 'Nothing at this broker without certificados'
                : 'Nothing held or realized at this broker'
            }
          />
        ) : (
          <>
            <View style={styles.hero}>
              <T variant="headline">{brokerLabel(names, accountId)}</T>
              <Amount value={broker.valueEur} variant="title1" />
            </View>
            <Section title="Figures">
              <FigureLine label="Weight">
                <Amount kind="pct" value={broker.weight} />
              </FigureLine>
              <FigureLine label="Cost basis">
                <Amount value={broker.costBasisEur} />
              </FigureLine>
              <FigureLine label="Unrealized">
                <Amount value={broker.unrealizedEur} sign />
              </FigureLine>
              <FigureLine label="Realized">
                <Amount value={broker.realizedEur} sign />
              </FigureLine>
              <FigureLine label="Income">
                <Amount value={broker.incomeNetEur} sign />
              </FigureLine>
              <FigureLine label="Other costs">
                <Amount value={broker.otherCostsEur.neg()} sign />
              </FigureLine>
              <FigureLine label="Gain" strong>
                <Amount value={broker.totalGainEur} sign tone variant="headline" />
              </FigureLine>
            </Section>
            <SortPanel sort={sort} onChange={setSort} keys={['value', 'weight', 'gain']} />
            <Section title="Holdings at this broker">
              {rows.length === 0 ? (
                <T variant="sub" tone="muted">
                  No units held here.
                </T>
              ) : null}
              {rows.map((r, i) => (
                <PositionRowView
                  key={r.assetId}
                  row={r}
                  names={names}
                  showDay={false}
                  last={i === rows.length - 1}
                />
              ))}
            </Section>
          </>
        )
      }
    </PortfolioScreen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: space.lg, marginBottom: space.xl, gap: space.hairline },
});
