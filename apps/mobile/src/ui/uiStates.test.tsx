import { dec } from '@ledgr/core';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { CertificadosScreen } from '../certificados/CertificadosScreen';
import { FactorUpdateScreen } from '../certificados/FactorUpdateScreen';
import { unitPriceDp } from '../format';
import { EditTransactionScreen } from '../transactions/EditTransactionScreen';
import { NewTransactionScreen } from '../transactions/NewTransactionScreen';
import { SegmentedControl } from './SegmentedControl';
import { space, TOUCH_TARGET } from './theme';

const mockLedger = jest.fn();
jest.mock('../data/usePortfolio', () => ({
  ...jest.requireActual('../data/usePortfolio'),
  useLedger: () => mockLedger(),
}));
jest.mock('../navigation', () => ({
  useRootNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRootRoute: () => ({ params: { id: 'missing' } }),
}));

const loading = { data: undefined, isError: false, error: null };
const failed = { data: undefined, isError: true, error: new Error('503') };

// A screen waiting for the ledger shows the shared skeleton (docs/design.md §6.10), not a
// "Loading…" line; one whose ledger failed shows the error and the code, never a spinner.
describe.each([
  ['Edit transaction', EditTransactionScreen],
  ['New transaction', NewTransactionScreen],
  ['Certificados', CertificadosScreen],
  ['Factor update', FactorUpdateScreen],
])('%s while the ledger loads', (_name, Screen) => {
  it('shows a skeleton, not a "Loading…" line', async () => {
    mockLedger.mockReturnValue(loading);
    await render(<Screen />);
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByTestId('skeleton-rows')).toBeOnTheScreen();
  });
});

describe.each([
  ['Edit transaction', EditTransactionScreen],
  ['New transaction', NewTransactionScreen],
  ['Certificados', CertificadosScreen],
  ['Factor update', FactorUpdateScreen],
])('%s when the ledger fails', (_name, Screen) => {
  it('says so, with the error code', async () => {
    mockLedger.mockReturnValue(failed);
    await render(<Screen />);
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByText(/Could not load/)).toBeOnTheScreen();
  });
});

describe('SegmentedControl touch area', () => {
  it('is at least 48 dp tall: the segment plus its hit slop', async () => {
    await render(
      <SegmentedControl
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        value={'a' as string}
        onChange={() => undefined}
      />,
    );
    for (const tab of screen.getAllByRole('tab')) {
      const style = StyleSheet.flatten(tab.props.style) as { height: number };
      const slop = tab.props.hitSlop as { top: number; bottom: number };
      expect(style.height + slop.top + slop.bottom).toBeGreaterThanOrEqual(TOUCH_TARGET);
    }
  });
});

describe('unit price decimals', () => {
  // The display rule the confirm screen and the form's "= x per unit" line share: a price
  // under 1 € shows 6 decimals so a cheap coin's price is not rounded away; else 2.
  it('is 6 under 1 and 2 from 1 up', () => {
    expect(unitPriceDp(dec('0.000123'))).toBe(6);
    expect(unitPriceDp(dec('0.999999'))).toBe(6);
    expect(unitPriceDp(dec('1'))).toBe(2);
    expect(unitPriceDp(dec('412.37'))).toBe(2);
  });
});

describe('space tokens', () => {
  it('has a hairline step for the 2 dp of a tight stack, below the 4 dp grid', () => {
    expect((space as Record<string, number>).hairline).toBe(2);
  });
});
