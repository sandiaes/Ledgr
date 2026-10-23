import { buildPositions } from '@ledgr/core';
import { usePortfolio } from '../data/usePortfolio';
import { useNames } from '../ui/labels';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { ClosedList } from './ClosedList';

/** Closed positions on their own (from More); the same list as Positions › Closed. */
export function ClosedPositionsScreen() {
  const state = usePortfolio(buildPositions);
  const names = useNames(state.status === 'ready' ? state.ledger : null);
  return (
    <PortfolioScreen state={state} what="closed positions">
      {(view) => <ClosedList closed={view.closed} names={names} />}
    </PortfolioScreen>
  );
}
