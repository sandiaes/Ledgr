import { dec, localDate, type ValueSnapshot } from '@ledgr/core';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { parseSettings } from '../settings/settings';
import { fakeAuth, fakeData, fakeServices, portfolioLedger } from '../test/fakes';
import { MASK } from './Money';

jest.mock('react-native-gifted-charts', () => ({
  LineChart: () => null,
  PieChart: () => null,
  BarChart: () => null,
}));

const today = localDate(new Date(), TIME_ZONE);
const CA = 'Certificados de Aforro E';
const SWITCH = 'Include certificados de aforro';

// The portfolio fixture (test/fakes.ts), by hand: V 6,590.82 of which certificados
// 1,104.82; G 547.82 of which certificados 104.82; net invested 6,050 of which 1,000.
// Without certificados: V 5,486.00, G +443.00, net invested 5,050.00.
// One snapshot at the end of last year, with its per-type values.
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

async function openApp(settings: { hideValues?: boolean; includeCertificados?: boolean } = {}) {
  const fixture = portfolioLedger(today);
  const data = fakeData({ ...fixture, snapshots });
  const { auth } = fakeAuth({ level: 'aal2' });
  const services = fakeServices({ auth, data, settings });
  const view = await render(<AppRoot services={services} />);
  await screen.findByText('Total value');
  return { data, services, view };
}

const switchOff = () => fireEvent(screen.getByLabelText(SWITCH), 'valueChange', false);
const switchOn = () => fireEvent(screen.getByLabelText(SWITCH), 'valueChange', true);
const calls = (data: Awaited<ReturnType<typeof openApp>>['data']) =>
  [data.ledger, data.market, data.snapshots, data.valueNow].map((f) => f.mock.calls.length);
const rows = () =>
  screen.getAllByTestId('position-row').map((r) => r.props.accessibilityLabel as string);

describe('Include certificados de aforro', () => {
  it('is on by default; off recomputes the Dashboard at once, without fetching again', async () => {
    const { data } = await openApp();
    expect(screen.getByLabelText(SWITCH)).toHaveProp('value', true);
    expect(screen.getAllByText('€6,590.82').length).toBeGreaterThan(0);
    expect(screen.getByText('+€547.82')).toBeOnTheScreen();
    expect(screen.queryByTestId('scope-note')).toBeNull();
    const before = calls(data);

    await switchOff();
    expect(screen.getByLabelText(SWITCH)).toHaveProp('value', false);
    expect(screen.getAllByText('€5,486.00').length).toBeGreaterThan(0); // 6,590.82 − 1,104.82
    expect(screen.getByText('+€443.00')).toBeOnTheScreen(); // total gain
    expect(screen.getByText('€5,050.00')).toBeOnTheScreen(); // net invested
    expect(screen.queryAllByText('€6,590.82')).toEqual([]);
    expect(screen.getByTestId('scope-note')).toHaveTextContent('Excluding certificados');
    expect(calls(data)).toEqual(before);

    await switchOn();
    expect(screen.getAllByText('€6,590.82').length).toBeGreaterThan(0);
    expect(screen.getByText('+€547.82')).toBeOnTheScreen();
    expect(screen.queryByTestId('scope-note')).toBeNull();
    expect(calls(data)).toEqual(before);
  });

  it('reaches Positions (every segment), brokers and the Position detail', async () => {
    await openApp();
    await switchOff();
    await fireEvent.press(screen.getByText('Positions'));
    await screen.findAllByTestId('position-row');
    expect(rows()).toEqual(['BTC', 'VWCE', 'AAPL']);
    expect(screen.getAllByTestId('scope-note').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByText('Filter'));
    expect(screen.queryByLabelText('Type: Certificados')).toBeNull();
    expect(screen.queryByLabelText('Broker: AforroNet')).toBeNull();

    await fireEvent.press(screen.getByText('By type'));
    expect(screen.queryByText('Certificados')).toBeNull();
    expect(screen.getAllByText('ETFs').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByText('By broker'));
    const cards = screen.getAllByTestId('broker-card');
    expect(cards.map((c) => c.props.accessibilityLabel)).toEqual(['Degiro', 'IBKR']);
    const total = screen.getByText('All brokers').parent!.parent!;
    expect(within(total).getByText('€5,486.00')).toBeOnTheScreen();
    expect(within(total).getByText('+€443.00')).toBeOnTheScreen();
    expect(screen.queryByText(/do not add up/)).toBeNull();

    await fireEvent.press(screen.getByText('Closed'));
    expect(screen.getAllByTestId('closed-row').map((r) => r.props.accessibilityLabel)).toEqual([
      'MSFT',
    ]);

    await fireEvent.press(screen.getByText('All'));
    await fireEvent.press(screen.getByLabelText('VWCE'));
    expect(await screen.findByText('Split by broker')).toBeOnTheScreen();
  });

  it('a type filter on certificados stops filtering once they are left out', async () => {
    await openApp();
    await fireEvent.press(screen.getByText('Positions'));
    await screen.findAllByTestId('position-row');
    await fireEvent.press(screen.getByText('Filter'));
    await fireEvent.press(screen.getByLabelText('Type: Certificados'));
    expect(rows()).toEqual([CA]);

    await fireEvent.press(screen.getByText('Dashboard'));
    await switchOff();
    await fireEvent.press(screen.getByText('Positions'));
    expect(rows()).toEqual(['BTC', 'VWCE', 'AAPL']);
    expect(screen.getByText('Filter')).toBeOnTheScreen(); // no active filter left
  });

  it.each(['Allocation', 'Performance', 'Closed positions'])(
    'reaches %s (from More), with the note',
    async (name) => {
      await openApp();
      await switchOff();
      await fireEvent.press(screen.getByText('More'));
      await fireEvent.press(await screen.findByText(name));
      await screen.findAllByText(/as of/);
      expect(screen.getAllByTestId('scope-note').length).toBeGreaterThan(0);
      if (name === 'Allocation') {
        await fireEvent.press(screen.getByText('Broker'));
        const groups = screen
          .getAllByTestId('allocation-row')
          .map((r) => within(r).getAllByText(/./)[1]?.props.children);
        expect(groups).toEqual(['Degiro', 'IBKR']);
        expect(screen.getByText('3 largest positions')).toBeOnTheScreen();
      }
      if (name === 'Performance') {
        await fireEvent.press(screen.getByText('Yearly'));
        const year2025 = screen
          .getAllByTestId('period-row')
          .find((r) => within(r).queryByText('2025'));
        expect(within(year2025!).getByText('+€5,050.00')).toBeOnTheScreen(); // contributions
      }
      if (name === 'Closed positions') {
        expect(screen.getAllByTestId('closed-row')).toHaveLength(1);
      }
    },
  );

  it('the Allocation types sum to 100% without certificados', async () => {
    await openApp({ includeCertificados: false });
    await fireEvent.press(screen.getByText('By broker, currency and asset ›'));
    await screen.findByText('Concentration');
    const pcts = screen
      .getAllByTestId('allocation-row')
      .map((r) => dec(within(r).getByText(/%$/).props.children.replace('%', '')));
    expect(pcts.reduce((s, p) => s.plus(p), dec('0')).toString()).toBe('100');
    expect(screen.queryByText('Certificados')).toBeNull();
  });

  it('reaches Activity: certificado rows leave the list and the filters', async () => {
    await openApp();
    await switchOff();
    await fireEvent.press(screen.getByText('Activity'));
    const listed = (await screen.findAllByTestId('activity-row')).map(
      (r) => r.props.accessibilityLabel as string,
    );
    expect(listed).toHaveLength(8);
    expect(listed.some((l) => l.includes(CA))).toBe(false);
    expect(screen.getByTestId('scope-note')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Filter'));
    expect(screen.queryByLabelText('Broker: AforroNet')).toBeNull();
    expect(screen.queryByLabelText('Type: Subscription')).toBeNull();
  });

  it('a stored setting from before the switch existed reads as included', () => {
    expect(parseSettings({ hideValues: true }).includeCertificados).toBe(true);
    expect(parseSettings({ includeCertificados: 'no' }).includeCertificados).toBe(true);
    expect(parseSettings({ includeCertificados: false }).includeCertificados).toBe(false);
  });

  it('is remembered across restarts', async () => {
    const { services, view } = await openApp();
    await switchOff();
    expect(services.settings.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeCertificados: false }),
    );
    await view.unmount();

    // The next start reads the stored value back.
    await openApp({ includeCertificados: false });
    expect(screen.getByLabelText(SWITCH)).toHaveProp('value', false);
    expect(screen.getAllByText('€5,486.00').length).toBeGreaterThan(0);
    expect(screen.getByTestId('scope-note')).toBeOnTheScreen();
  });

  it('hides the certificado factor indicator when they are left out', async () => {
    const fixture = portfolioLedger(today);
    fixture.ledger.ca.factors = [{ subscriptionId: 's1', month: '2025-01-01', factor: dec('1.1') }];
    const { auth } = fakeAuth({ level: 'aal2' });
    await render(<AppRoot services={fakeServices({ auth, data: fakeData(fixture) })} />);
    await screen.findByText('Total value');
    expect(screen.getByText(/CA factor \d+ days old/)).toBeOnTheScreen();
    await switchOff();
    expect(screen.queryByText(/CA factor/)).toBeNull();
    expect(screen.getByText(/1 price stale/)).toBeOnTheScreen(); // BTC, still shown
  });

  it('the certificados screen and the factor update still work when they are excluded', async () => {
    await openApp({ includeCertificados: false });
    await fireEvent.press(screen.getByText('More'));
    await fireEvent.press(await screen.findByText('Certificados'));
    const row = (await screen.findAllByTestId('ca-row'))[0]!;
    expect(within(row).getByText('€1,104.82')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Update factors'));
    expect(await screen.findAllByTestId('factor-line')).toHaveLength(1);
  });

  it('only certificados held: an empty state instead of figures', async () => {
    const fixture = portfolioLedger(today);
    fixture.ledger.transactions = fixture.ledger.transactions.filter((t) => t.assetId === 'ca');
    const { auth } = fakeAuth({ level: 'aal2' });
    await render(
      <AppRoot
        services={fakeServices({
          auth,
          data: fakeData(fixture),
          settings: { includeCertificados: false },
        })}
      />,
    );
    expect(await screen.findByText(/No holdings without certificados/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Positions'));
    expect((await screen.findAllByText(/No holdings without certificados/)).length).toBeGreaterThan(
      0,
    );
    await fireEvent.press(screen.getByText('Activity'));
    expect(await screen.findByText(/No transactions without certificados/)).toBeOnTheScreen();
  });

  it('hide values still masks every amount with certificados excluded', async () => {
    await openApp({ hideValues: true, includeCertificados: false });
    const expectMasked = () => {
      const figures = [...screen.queryAllByTestId('money'), ...screen.queryAllByTestId('units')];
      expect(figures.length).toBeGreaterThan(0);
      for (const f of figures) expect(f).toHaveTextContent(MASK);
      expect(screen.queryByText(/[€$]\s?\d/)).toBeNull();
    };
    expect(screen.getByTestId('scope-note')).toBeOnTheScreen();
    expectMasked();
    await fireEvent.press(screen.getByText('Positions'));
    await screen.findAllByTestId('position-row');
    for (const segment of ['By broker', 'By type', 'Closed', 'All']) {
      await fireEvent.press(screen.getByText(segment));
      expectMasked();
    }
    await fireEvent.press(screen.getByText('Activity'));
    await screen.findAllByTestId('activity-row');
    expectMasked();
  });
});
