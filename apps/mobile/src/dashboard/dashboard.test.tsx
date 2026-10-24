import { dec, localDate, type ValueSnapshot } from '@ledgr/core';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { fakeAuth, fakeData, fakeServices, portfolioLedger } from '../test/fakes';
import { MASK } from '../ui/Amount';

jest.mock('react-native-gifted-charts', () => ({
  LineChart: () => null,
  PieChart: () => null,
  BarChart: () => null,
}));

const today = localDate(new Date(), TIME_ZONE);

// The portfolio fixture (test/fakes.ts), by hand: V 6,590.82, net invested 6,050, so
// V - NI = 540.82 = R 90 + U 450.82. One snapshot at the end of last year: V 6,520, NI 6,050.
const snapshots: ValueSnapshot[] = [
  {
    date: `${Number(today.slice(0, 4)) - 1}-12-31`,
    valueEur: dec('6520'),
    netInvestedEur: dec('6050'),
    valueByTypeEur: {
      stock: dec('720'),
      etf: dec('2100'),
      crypto: dec('2600'),
      certificado_aforro: dec('1100'),
    },
  },
];

async function openDashboard(settings: Record<string, unknown> = {}) {
  const data = fakeData({ ...portfolioLedger(today), snapshots });
  const { auth } = fakeAuth({ level: 'aal2' });
  await render(<AppRoot services={fakeServices({ auth, data, settings })} />);
  await screen.findByText('Total gain');
}

const fontSize = (el: Parameters<typeof expect>[0]) =>
  (StyleSheet.flatten((el as { props: { style: never } }).props.style) as { fontSize: number })
    .fontSize;

describe('Dashboard: top movers', () => {
  const rows = () => screen.getAllByTestId('mover-row');
  const row = (ticker: string) => rows().find((r) => within(r).queryByText(ticker))!;
  const figures = (r: ReturnType<typeof row>) =>
    within(r)
      .getAllByTestId(/money|pct/)
      .map((f) => [f.props.testID as string, String(f.props.children), fontSize(f)] as const);

  it('with € selected the € change is the main figure and the % sits under it', async () => {
    await openDashboard();
    // Day: only VWCE moved, +150 on 2,100 (+7.14%).
    expect(rows()).toHaveLength(1);
    expect(figures(row('VWCE'))).toEqual([
      ['money', '+150,00 €', 16], // headline
      ['pct', '+7,14%', 13], // sub
    ]);
    const [main, other] = within(row('VWCE')).getAllByTestId(/money|pct/);
    expect(main!).toHaveStyle({ fontWeight: '600' });
    expect(other!).not.toHaveStyle({ fontWeight: '600' });
  });

  it('with % selected the % is the main figure and the € change is under it', async () => {
    await openDashboard();
    await fireEvent.press(screen.getByText('%'));
    expect(figures(row('VWCE'))).toEqual([
      ['pct', '+7,14%', 16],
      ['money', '+150,00 €', 13],
    ]);
  });

  it('keeps the ranking and the order of the figures when the span changes', async () => {
    await openDashboard();
    await fireEvent.press(screen.getByText('Total'));
    // Unrealized: VWCE +650, AAPL +196, CA +104.82 up; BTC -500 down.
    expect(rows().map((r) => within(r).getAllByText(/./)[0]?.props.children)).toEqual([
      'VWCE',
      'AAPL',
      'Certificados de Aforro E',
      'BTC',
    ]);
    expect(figures(row('BTC'))[0]).toEqual(['money', '−500,00 €', 16]);
    expect(figures(row('BTC'))[1]![0]).toBe('pct');
    await fireEvent.press(screen.getByText('%'));
    expect(figures(row('BTC'))[0]![0]).toBe('pct');
    expect(figures(row('BTC'))[1]).toEqual(['money', '−500,00 €', 13]);
    expect(figures(row('VWCE'))[0]).toEqual(['pct', '+40,63%', 16]); // 650 / 1,600
  });

  it('masks both figures with privacy on, whichever is the main one', async () => {
    await openDashboard({ hideValues: true });
    for (const unit of ['€', '%']) {
      await fireEvent.press(screen.getByText(unit));
      for (const r of rows()) {
        for (const f of within(r).getAllByTestId(/money|pct/)) expect(f).toHaveTextContent(MASK);
      }
    }
  });
});

describe('Dashboard: the chart', () => {
  const returnLine = () => screen.getByTestId('period-return');
  const shown = () =>
    within(returnLine())
      .getAllByTestId(/money|pct/)
      .map((f) => String(f.props.children));

  it('shows only the return of the range: market gain in € and the time-weighted %', async () => {
    await openDashboard();
    expect(within(returnLine()).getByText('Return 1Y')).toBeOnTheScreen();
    // From the last-year-end snapshot: (6,590.82 - 6,520) - (6,050 - 6,050) = 70.82, and
    // 6,590.82 / 6,520 - 1 = 1.09% (no flows since).
    expect(shown()).toEqual(['+70,82 €', '+1,09%']);
    await fireEvent.press(within(screen.getByTestId('chart-section')).getByText('YTD'));
    expect(within(returnLine()).getByText('Return YTD')).toBeOnTheScreen();
    expect(shown()).toEqual(['+70,82 €', '+1,09%']);
    // 1M has no snapshot in it: no window, so dashes rather than zeros.
    await fireEvent.press(within(screen.getByTestId('chart-section')).getByText('1M'));
    expect(shown()).toEqual(['—', '—']);
  });

  it('All starts the day before the first row: gain = value - net invested, TWR since start', async () => {
    await openDashboard();
    await fireEvent.press(within(screen.getByTestId('chart-section')).getByText('All'));
    expect(within(returnLine()).getByText('Return All')).toBeOnTheScreen();
    expect(shown()[0]).toBe('+540,82 €'); // 6,590.82 - 6,050 = R 90 + U 450.82
    // The same % as Total result in the header (the TWR since start).
    await fireEvent.press(screen.getByLabelText('Portfolio value, show details'));
    const panel = await screen.findByTestId('header-panel');
    const totalPct = within(panel).getAllByTestId('pct')[1]!;
    expect(shown()[1]).toBe(String(totalPct.props.children));
  });

  it('no longer shows the changes in value and in net invested', async () => {
    await openDashboard();
    expect(screen.queryByText('Value change')).toBeNull();
    expect(screen.queryByText('Net invested change')).toBeNull();
    expect(screen.getByText('Value vs net invested')).toBeOnTheScreen();
    expect(within(screen.getByTestId('chart-section')).getByText('Net invested')).toBeOnTheScreen(); // legend
    expect(within(screen.getByTestId('period-return')).getAllByTestId(/money|pct/)).toHaveLength(2);
  });

  it('masks the return with privacy on', async () => {
    await openDashboard({ hideValues: true });
    expect(shown()).toEqual([MASK, MASK]);
  });
});

describe('Dashboard: states', () => {
  it('shows skeletons in the layout of the content while loading, never an amount', async () => {
    const { auth } = fakeAuth({ level: 'aal2' });
    const data = fakeData(portfolioLedger(today));
    data.ledger.mockImplementation(() => new Promise(() => undefined));
    await render(<AppRoot services={fakeServices({ auth, data })} />);
    expect(await screen.findByTestId('dashboard-loading')).toBeOnTheScreen();
    expect(screen.getByTestId('skeleton-rows', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('skeleton-chart', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryAllByTestId('money')).toEqual([]);
  });

  it('shows an error in place with its code and how to retry, never an amount', async () => {
    const { auth } = fakeAuth({ level: 'aal2' });
    const data = fakeData(portfolioLedger(today));
    data.snapshots.mockRejectedValue({ code: 'PGRST301' });
    await render(<AppRoot services={fakeServices({ auth, data })} />);
    const error = await screen.findByTestId('error-state', {}, { timeout: 8000 });
    expect(within(error).getByText('Could not load the dashboard')).toBeOnTheScreen();
    expect(within(error).getByText('PGRST301')).toBeOnTheScreen();
    expect(within(error).getByText('Pull down to retry')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('money')).toEqual([]);
  }, 15000);

  it('shows a friendly empty state with the next step when there are no transactions', async () => {
    const fixture = portfolioLedger(today);
    fixture.ledger.transactions = [];
    const { auth } = fakeAuth({ level: 'aal2' });
    await render(<AppRoot services={fakeServices({ auth, data: fakeData(fixture) })} />);
    const empty = await screen.findByTestId('empty-state');
    expect(within(empty).getByText('No transactions yet')).toBeOnTheScreen();
    expect(within(empty).getByText('Add your first one with +')).toBeOnTheScreen();
  });

  it('keeps the freshness notes on the Dashboard now that the header card is gone', async () => {
    await openDashboard();
    // BTC's last close is ten days old.
    expect(screen.getByText(/1 price stale/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(/1 price stale/));
    expect(screen.getByText(/BTC: last price/)).toBeOnTheScreen();
  });
});
