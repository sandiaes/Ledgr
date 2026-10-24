import { dec, localDate, type Decimal } from '@ledgr/core';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { fakeAuth, fakeData, fakeServices, portfolioLedger } from '../test/fakes';
import { AMOUNT_TEXT } from '../test/leaks';
import { MASK } from '../ui/Amount';

jest.mock('react-native-gifted-charts', () => ({
  LineChart: () => null,
  PieChart: () => null,
  BarChart: () => null,
}));

const today = localDate(new Date(), TIME_ZONE);
const CA = 'Certificados de Aforro E';

async function openApp(settings: { hideValues?: boolean } = {}) {
  const fixture = portfolioLedger(today);
  const data = fakeData(fixture);
  const { auth } = fakeAuth({ level: 'aal2' });
  await render(<AppRoot services={fakeServices({ auth, data, settings })} />);
  await screen.findByText('Total gain');
  return data;
}

async function openPositions(settings: { hideValues?: boolean } = {}) {
  const data = await openApp(settings);
  await fireEvent.press(screen.getByText('Positions'));
  await screen.findAllByTestId('position-row');
  return data;
}

const order = () =>
  screen.getAllByTestId('position-row').map((r) => r.props.accessibilityLabel as string);

/** "1.486,00 €" / "+12,00 €" / "−5,00 €" -> Decimal (the test reads what is on screen). */
const amount = (text: string): Decimal =>
  dec(
    text
      .replace(/[€\s\u00A0+.]/g, '')
      .replace(',', '.')
      .replace('−', '-'),
  );
const shown = (el: Parameters<typeof within>[0]) =>
  within(el)
    .getAllByTestId('money')
    .map((m) => amount(String(m.props.children)));

describe('Positions: sorting', () => {
  it('lists by value, highest first, by default', async () => {
    await openPositions();
    expect(order()).toEqual(['BTC', 'VWCE', CA, 'AAPL']);
  });

  it('sorts by gain, weight and day change in both directions', async () => {
    await openPositions();
    await fireEvent.press(screen.getByText('Sort: Value ↓'));

    await fireEvent.press(screen.getByText('Gain €'));
    expect(order()).toEqual(['VWCE', 'AAPL', CA, 'BTC']); // +650, +196, +104.82, −500
    await fireEvent.press(screen.getByText('Lowest first'));
    expect(order()).toEqual(['BTC', CA, 'AAPL', 'VWCE']);
    expect(screen.getByText('Sort: Gain € ↑')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Weight'));
    expect(order()).toEqual(['AAPL', CA, 'VWCE', 'BTC']);

    // Day %: VWCE +7,14%, the others 0 (ties by asset id).
    await fireEvent.press(screen.getByText('Day change %'));
    expect(order()).toEqual(['AAPL', 'BTC', CA, 'VWCE']);
    await fireEvent.press(screen.getByText('Highest first'));
    expect(order()).toEqual(['VWCE', 'AAPL', 'BTC', CA]);
  });
});

describe('Positions: search and filters', () => {
  it('searches ticker, name and ISIN', async () => {
    await openPositions();
    const search = screen.getByLabelText('Search');
    await fireEvent.changeText(search, 'apple');
    expect(order()).toEqual(['AAPL']);
    await fireEvent.changeText(search, 'ie00bk5');
    expect(order()).toEqual(['VWCE']);
    await fireEvent.changeText(search, 'btc');
    expect(order()).toEqual(['BTC']);
    await fireEvent.changeText(search, 'nothing like it');
    expect(screen.getByText('No positions match.')).toBeOnTheScreen();
    await fireEvent.changeText(search, '');
    expect(order()).toHaveLength(4);
  });

  it('filters by type, broker, listing currency and stale prices', async () => {
    await openPositions();
    await fireEvent.press(screen.getByText('Filter'));

    await fireEvent.press(screen.getByLabelText('Type: Crypto'));
    expect(order()).toEqual(['BTC']);
    expect(screen.getByText('Filter (1)')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Type: Stocks'));
    expect(order()).toEqual(['BTC', 'AAPL']); // either type
    await fireEvent.press(screen.getByText('Clear filters'));
    expect(order()).toHaveLength(4);

    // A broker filter keeps the positions with units there.
    await fireEvent.press(screen.getByLabelText('Broker: IBKR'));
    expect(order()).toEqual(['VWCE', 'AAPL']);
    await fireEvent.press(screen.getByLabelText('Listing currency: USD'));
    expect(order()).toEqual(['AAPL']); // and the currency
    await fireEvent.press(screen.getByText('Clear filters'));

    await fireEvent(screen.getByLabelText('Stale only'), 'valueChange', true);
    expect(order()).toEqual(['BTC']);
    expect(within(screen.getAllByTestId('position-row')[0]!).getByText('stale')).toBeOnTheScreen();
  });

  it('applies search and filters inside the type sections', async () => {
    await openPositions();
    await fireEvent.press(screen.getByText('By type'));
    expect(screen.getByText('ETFs')).toBeOnTheScreen();
    expect(screen.getByText('Certificados')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Search'), 'aapl');
    expect(order()).toEqual(['AAPL']);
    expect(screen.getByText('Stocks')).toBeOnTheScreen();
    expect(screen.queryByText('ETFs')).toBeNull();
  });

  it('shows certificados with units, latest factor and value', async () => {
    await openPositions();
    const row = screen.getAllByTestId('position-row')[2]!;
    expect(row.props.accessibilityLabel).toBe(CA);
    expect(within(row).getByText('1.104,82\u00A0€')).toBeOnTheScreen();
    expect(within(row).getByText('1.000')).toBeOnTheScreen();
    expect(within(row).getByText('1,10482\u00A0€')).toBeOnTheScreen();
  });
});

describe('Positions: by broker', () => {
  it('broker values and gains add up exactly to the portfolio totals', async () => {
    await openApp();
    // The Dashboard's total value and total gain.
    expect(screen.getAllByText('6.590,82\u00A0€').length).toBeGreaterThan(0);
    expect(screen.getByText('+547,82\u00A0€')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Positions'));
    await fireEvent.press(await screen.findByText('By broker'));

    const cards = screen.getAllByTestId('broker-card');
    expect(cards.map((c) => c.props.accessibilityLabel)).toEqual(['Degiro', 'IBKR', 'AforroNet']);
    const [values, gains] = [0, 1].map((i) =>
      cards.map((c) => shown(c)[i] as Decimal).reduce((s, v) => s.plus(v), dec('0')),
    );
    expect(values?.toString()).toBe('6590.82');
    expect(gains?.toString()).toBe('547.82');

    const total = shown(screen.getByText('All brokers').parent!.parent!);
    expect(total.map(String)).toEqual(['6590.82', '547.82']);
    expect(screen.queryByText(/do not add up/)).toBeNull();
  });

  it('drills into a broker: its own units, realized, income and costs', async () => {
    await openPositions();
    await fireEvent.press(screen.getByText('By broker'));
    await fireEvent.press(screen.getByLabelText('IBKR'));

    expect(await screen.findByText('Holdings at this broker')).toBeOnTheScreen();
    const rows = screen.getAllByTestId('position-row');
    const ibkr = rows.slice(-2); // the Positions tab stays mounted underneath
    expect(ibkr.map((r) => r.props.accessibilityLabel)).toEqual(['VWCE', 'AAPL']);
    expect(within(ibkr[0]!).getByText('750,00\u00A0€')).toBeOnTheScreen();
    expect(within(ibkr[0]!).getByText('5')).toBeOnTheScreen();
    expect(screen.getByText('+90,00\u00A0€')).toBeOnTheScreen(); // realized (MSFT)
    expect(screen.getByText('−5,00\u00A0€')).toBeOnTheScreen(); // other costs
    expect(screen.getAllByText('+431,00\u00A0€').length).toBeGreaterThan(0); // gain
  });
});

describe('Position detail', () => {
  it('shows the split by broker, the open lots, the price history and the transactions', async () => {
    const data = await openPositions();
    await fireEvent.press(screen.getByLabelText('VWCE'));

    expect(await screen.findByText('Split by broker')).toBeOnTheScreen();
    const split = screen.getAllByTestId('broker-split');
    expect(split.map((s) => shown(s)[0]?.toString())).toEqual(['1500', '750']);
    expect(screen.getAllByTestId('open-lot')).toHaveLength(2);
    expect(screen.getByText('+650,00\u00A0€')).toBeOnTheScreen(); // unrealized
    expect(screen.getByText('+12,00\u00A0€')).toBeOnTheScreen(); // income
    expect(data.priceHistory).toHaveBeenCalledWith('vwce');

    await fireEvent.press(screen.getByText('Transactions'));
    const rows = await screen.findAllByTestId('asset-transaction');
    expect(rows.map((r) => within(r).getAllByText(/Buy|Dividend/)[0]?.props.children[0])).toEqual([
      'Dividend',
      'Buy',
      'Buy',
    ]);
  });

  it('lists each certificado subscription with its factor instead of a price chart', async () => {
    const data = await openPositions();
    await fireEvent.press(screen.getByLabelText(CA));
    const subs = await screen.findAllByTestId('ca-subscription');
    expect(subs).toHaveLength(1);
    expect(within(subs[0]!).getByText('1,10482\u00A0€')).toBeOnTheScreen();
    expect(within(subs[0]!).getByText('1.104,82\u00A0€')).toBeOnTheScreen();
    expect(data.priceHistory).not.toHaveBeenCalled();
  });
});

describe('Closed positions', () => {
  it('shows realized results per asset, labeled performance, not tax', async () => {
    await openPositions();
    await fireEvent.press(screen.getByText('Closed'));
    expect(screen.getByText(/Performance, not tax/)).toBeOnTheScreen();
    const rows = screen.getAllByTestId('closed-row');
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual(['MSFT']);
    expect(within(rows[0]!).getByText('+90,00\u00A0€')).toBeOnTheScreen();
    expect(within(rows[0]!).getByText('+16,67%')).toBeOnTheScreen();
    await fireEvent.press(rows[0]!);
    expect(within(rows[0]!).getByText('IBKR')).toBeOnTheScreen();
  });
});

describe('hide values on every new screen', () => {
  const expectMasked = () => {
    const figures = screen.queryAllByTestId(/money|units|pct/);
    expect(figures.length).toBeGreaterThan(0);
    for (const f of figures) expect(f).toHaveTextContent(MASK);
    expect(screen.queryByText(AMOUNT_TEXT)).toBeNull();
    expect(screen.queryByText(/\d%/)).toBeNull(); // percentages are masked too
  };

  it('Positions (all segments), Position detail, Transactions', async () => {
    await openPositions({ hideValues: true });
    expectMasked();
    for (const segment of ['By broker', 'By type', 'Closed', 'All']) {
      await fireEvent.press(screen.getByText(segment));
      expectMasked();
    }
    await fireEvent.press(screen.getByLabelText('VWCE'));
    await screen.findByText('Split by broker');
    expectMasked();
    await fireEvent.press(screen.getByText('Transactions'));
    await screen.findAllByTestId('asset-transaction');
    expectMasked();
  });

  it('Broker detail', async () => {
    await openPositions({ hideValues: true });
    await fireEvent.press(screen.getByText('By broker'));
    await fireEvent.press(screen.getByLabelText('Degiro'));
    await screen.findByText('Holdings at this broker');
    expectMasked();
  });

  it.each([
    ['Allocation', 'By broker, currency and asset ›'],
    ['Performance', 'Monthly and yearly returns ›'],
  ])('%s (from the Dashboard)', async (_name, link) => {
    await openApp({ hideValues: true });
    await fireEvent.press(screen.getByText(link));
    await screen.findAllByText(/as of/);
    expectMasked();
  });
});

describe('Allocation', () => {
  it('groups by broker and gives the top 5', async () => {
    await openApp();
    await fireEvent.press(screen.getByText('By broker, currency and asset ›'));
    await screen.findByText('Concentration');
    await fireEvent.press(screen.getByText('Broker'));
    const rows = screen.getAllByTestId('allocation-row');
    expect(rows.map((r) => within(r).getAllByText(/./)[0]?.props.children)).toEqual([
      'Degiro',
      'IBKR',
      'AforroNet',
    ]);
    expect(screen.getByText('4 largest positions')).toBeOnTheScreen();
    expect(screen.getAllByText('100,00%').length).toBeGreaterThan(0);
  });
});
