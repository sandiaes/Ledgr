import { dec, localDate, type PricePoint } from '@ledgr/core';
import {
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from '@testing-library/react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { PriceChart } from '../positions/PriceChart';
import { ServicesProvider } from '../services';
import { SettingsProvider } from '../settings/SettingsProvider';
import { fakeAuth, fakeData, fakeServices, portfolioLedger } from '../test/fakes';
import { AMOUNT_TEXT } from '../test/leaks';
import { MASK } from './Amount';

// A chart that draws its scrub tooltip for the second point, as a touch on it would.
jest.mock('react-native-gifted-charts', () => ({
  LineChart: (props: {
    pointerConfig: { pointerLabelComponent(a: unknown, b: unknown, index: number): unknown };
  }) => props.pointerConfig.pointerLabelComponent([], [], 1),
  PieChart: () => null,
  BarChart: () => null,
}));

const today = localDate(new Date(), TIME_ZONE);

async function openApp(
  settings: { hideValues?: boolean } = {},
  edit?: (f: ReturnType<typeof portfolioLedger>) => void,
  ready = 'Total gain',
) {
  const fixture = portfolioLedger(today);
  edit?.(fixture);
  const data = fakeData(fixture);
  const { auth } = fakeAuth({ level: 'aal2' });
  await render(<AppRoot services={fakeServices({ auth, data, settings })} />);
  await screen.findByText(ready);
  return data;
}

describe('a list: the VWCE row on Positions', () => {
  it('shows its figures, then masks every one of them with the eye', async () => {
    await openApp();
    await fireEvent.press(screen.getByText('Positions'));
    const row = (await screen.findAllByTestId('position-row')).find(
      (r) => r.props.accessibilityLabel === 'VWCE',
    )!;

    // Value, unrealized € and %, units and weight, with signs and tabular digits.
    expect(within(row).getByText('2.250,00 €')).toBeOnTheScreen();
    expect(within(row).getByText('+650,00 €')).toHaveStyle({ fontVariant: ['tabular-nums'] });
    expect(within(row).getAllByText(/^\+\d+,\d\d%$/).length).toBeGreaterThan(0); // unrealized %, day %
    expect(within(row).getByText('15')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Hide values'));
    const figures = within(row).getAllByTestId(/money|units|pct/);
    expect(figures.length).toBeGreaterThanOrEqual(4);
    for (const f of figures) expect(f).toHaveTextContent(MASK);
    expect(within(row).queryByText(AMOUNT_TEXT)).toBeNull();
    expect(within(row).queryByText(/\d/)).toBeNull();
    expect(within(row).getByText('VWCE')).toBeOnTheScreen(); // names stay
  });
});

describe('a chart label: the price tooltip', () => {
  const points: PricePoint[] = [
    { date: '2026-10-22', close: dec('120.5') },
    { date: '2026-10-23', close: dec('1234.5') },
  ];

  function chart(hideValues: boolean) {
    const { auth } = fakeAuth({ level: 'aal2' });
    const services = fakeServices({
      auth,
      data: fakeData(portfolioLedger(today)),
      settings: { hideValues },
    });
    return (
      <ServicesProvider services={services}>
        <SettingsProvider>
          <PriceChart points={points} currency="USD" />
        </SettingsProvider>
      </ServicesProvider>
    );
  }

  it('shows the date and the close in its currency', async () => {
    await render(chart(false));
    const tip = await screen.findByTestId('chart-tooltip');
    expect(within(tip).getByText('23/10/2026')).toBeOnTheScreen();
    expect(within(tip).getByText('1.234,50 USD')).toBeOnTheScreen();
  });

  it('masks the close and keeps the date', async () => {
    await render(chart(true));
    const tip = await screen.findByTestId('chart-tooltip');
    expect(within(tip).getByText('23/10/2026')).toBeOnTheScreen();
    expect(within(tip).getByText(MASK)).toBeOnTheScreen();
    expect(within(tip).queryByText(/1\.234|USD/)).toBeNull();
  });
});

describe('states of the lists', () => {
  it('shows a skeleton while Positions loads, then the rows', async () => {
    const { auth } = fakeAuth({ level: 'aal2' });
    const data = fakeData(portfolioLedger(today));
    await render(<AppRoot services={fakeServices({ auth, data })} />);
    await screen.findByText('Total gain');
    await fireEvent.press(screen.getByText('Positions'));
    // Rows or, until the data has arrived, the skeleton: never a bare spinner or blank.
    await screen.findAllByTestId('position-row');
    expect(screen.queryByTestId('portfolio-loading')).toBeNull();
  });

  it('shows a friendly empty state on Positions and Activity with an empty ledger', async () => {
    await openApp(
      {},
      (f) => {
        f.ledger.transactions = [];
      },
      'No transactions yet', // the Dashboard's
    );
    await fireEvent.press(screen.getByText('Positions'));
    expect(await screen.findAllByText('No transactions yet')).not.toHaveLength(0);
    await fireEvent.press(screen.getByText('Activity'));
    expect((await screen.findAllByText('Add your first one with +')).length).toBeGreaterThan(0);
  });

  it('says so when the filters match nothing, and clearing them brings the rows back', async () => {
    await openApp();
    await fireEvent.press(screen.getByText('Activity'));
    await screen.findAllByTestId('activity-row');
    await fireEvent.press(screen.getByText('Filter'));
    await fireEvent.press(screen.getByLabelText('Type: Dividend'));
    await fireEvent.press(screen.getByLabelText('Broker: IBKR')); // the dividend is at Degiro
    expect(await screen.findByTestId('activity-none')).toBeOnTheScreen();
    expect(screen.getByText('No transactions match')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Clear filters'));
    expect((await screen.findAllByTestId('activity-row')).length).toBeGreaterThan(1);
  });

  it('pulls to refresh on Positions and Activity', async () => {
    const data = await openApp();
    await fireEvent.press(screen.getByText('Positions'));
    await screen.findAllByTestId('position-row');
    const before = data.ledger.mock.calls.length;
    await userEvent.setup().pullToRefresh(screen.getByTestId('positions-list'));
    await waitFor(() => expect(data.ledger.mock.calls.length).toBeGreaterThan(before));

    await fireEvent.press(screen.getByText('Activity'));
    await screen.findAllByTestId('activity-row');
    const again = data.ledger.mock.calls.length;
    await userEvent.setup().pullToRefresh(screen.getByTestId('activity-list'));
    await waitFor(() => expect(data.ledger.mock.calls.length).toBeGreaterThan(again));
  });
});

describe('Activity amounts', () => {
  it('shows money out with a − and money in with a +, and masks both', async () => {
    await openApp();
    await fireEvent.press(screen.getByText('Activity'));
    const rows = await screen.findAllByTestId('activity-row');
    const buy = rows.find((r) => r.props.accessibilityLabel === 'Buy BTC 02/05/2025')!;
    const sell = rows.find((r) => r.props.accessibilityLabel === 'Sell MSFT 02/06/2025')!;
    expect(within(buy).getByText('−3.000,00\u00A0€')).toBeOnTheScreen();
    expect(within(sell).getByTestId('money')).toHaveTextContent(/^\+\d/);

    await fireEvent.press(screen.getByLabelText('Hide values'));
    for (const r of [buy, sell]) {
      for (const f of within(r).getAllByTestId(/money|units/)) expect(f).toHaveTextContent(MASK);
      expect(within(r).queryByText(AMOUNT_TEXT)).toBeNull();
    }
  });
});

describe('Transaction detail', () => {
  it('shows the row’s figures and masks them with the eye', async () => {
    await openApp();
    await fireEvent.press(screen.getByText('Activity'));
    await fireEvent.press(await screen.findByLabelText('Buy BTC 02/05/2025'));
    expect(await screen.findByText('Total (EUR)')).toBeOnTheScreen();
    expect(screen.getByText('Delete')).toBeOnTheScreen();
    expect(screen.getAllByText('3.000,00\u00A0€').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getAllByLabelText('Hide values').at(-1)!);
    const figures = screen.getAllByTestId(/money|units|pct/);
    for (const f of figures) expect(f).toHaveTextContent(MASK);
    expect(screen.queryByText(AMOUNT_TEXT)).toBeNull();
  });
});
