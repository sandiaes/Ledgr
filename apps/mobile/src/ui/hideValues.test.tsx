import { dec, localDate } from '@ledgr/core';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { ServicesProvider, type Services } from '../services';
import { SettingsProvider } from '../settings/SettingsProvider';
import { fakeAuth, fakeData, fakeServices, sampleLedger } from '../test/fakes';
import { AMOUNT_TEXT } from '../test/leaks';
import { Amount, MASK } from './Amount';
import { Money } from './Money';

jest.mock('../dashboard/ValueChart', () => ({ ValueChart: () => null }));
jest.mock('../dashboard/AllocationDonut', () => ({ AllocationDonut: () => null }));

const today = localDate(new Date(), TIME_ZONE);

function withSettings(hideValues: boolean, children: React.ReactNode) {
  const { auth } = fakeAuth({ level: 'aal2' });
  const services = fakeServices({
    auth,
    data: fakeData(sampleLedger(today)),
    settings: { hideValues },
  });
  return (
    <ServicesProvider services={services}>
      <SettingsProvider>{children}</SettingsProvider>
    </ServicesProvider>
  );
}

/** Settings that remember what was saved, like AsyncStorage across a restart. */
function persistentStore(initial: Record<string, unknown> = {}) {
  let saved: unknown = { lockEnabled: false, ...initial };
  return {
    load: jest.fn(async () => saved),
    save: jest.fn(async (settings: unknown) => {
      saved = JSON.parse(JSON.stringify(settings));
    }),
  };
}

function app(settings: Services['settings']) {
  const { auth } = fakeAuth({ level: 'aal2' });
  const services = fakeServices({ auth, data: fakeData(sampleLedger(today)) });
  services.settings = settings;
  return services;
}

const text = (id: string) => screen.getAllByTestId(id).map((e) => e.props.children);

describe('Amount with privacy on', () => {
  it('masks money, units and percentages, signs and colour included (decision D2)', async () => {
    await render(
      withSettings(
        true,
        <>
          <Money value={dec('-1234.5')} sign colored />
          <Money value={null} />
          <Amount kind="units" value={dec('3.5')} />
          <Amount kind="pct" value={dec('0.0345')} sign tone />
          <Amount value={dec('412.37')} currency="USD" />
        </>,
      ),
    );
    const all = await screen.findAllByTestId(/money|units|pct/);
    expect(all).toHaveLength(5);
    for (const a of all) {
      expect(a).toHaveTextContent(MASK);
      expect(a).toHaveAccessibilityValue({}); // nothing else to read
      expect(a.props.accessibilityLabel).toBe('hidden');
      expect(a).not.toHaveStyle({ color: expect.any(String) });
    }
    expect(screen.queryByText(/\d/)).toBeNull();
  });

  it('shows pt-PT amounts, tabular digits and a signed gain colour when off', async () => {
    await render(
      withSettings(
        false,
        <>
          <Money value={dec('-1234.5')} sign />
          <Amount kind="pct" value={dec('0.0345')} sign tone />
          <Amount kind="units" value={dec('1000.5')} />
        </>,
      ),
    );
    expect(await screen.findByText('−1.234,50\u00A0€')).toBeOnTheScreen();
    expect(screen.getByText('+3,45%')).toHaveStyle({ fontVariant: ['tabular-nums'] });
    expect(screen.getByText('+3,45%')).toHaveStyle({ color: expect.any(String) });
    expect(screen.getByText('1.000,5')).toBeOnTheScreen();
  });
});

describe('the eye and the global mask', () => {
  it('masks every figure on the Dashboard and the eye reveals them', async () => {
    const { auth } = fakeAuth({ level: 'aal2' });
    const services = fakeServices({
      auth,
      data: fakeData(sampleLedger(today)),
      settings: { hideValues: true },
    });
    await render(<AppRoot services={services} />);

    expect(await screen.findByText('Total gain')).toBeOnTheScreen();
    const figures = screen.getAllByTestId(/money|units|pct/);
    expect(figures.length).toBeGreaterThan(10);
    for (const f of figures) expect(f).toHaveTextContent(MASK);
    expect(screen.queryByText(AMOUNT_TEXT)).toBeNull();
    expect(screen.queryByText(/[+−]?\d+,\d\d%/)).toBeNull(); // percentages too

    await fireEvent.press(screen.getByLabelText('Show values'));
    expect((await screen.findAllByText('1.500,00\u00A0€')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('+50,00\u00A0€').length).toBeGreaterThan(0); // day change, movers
    expect(screen.getAllByText('+3,45%').length).toBeGreaterThan(0);
    expect(screen.queryAllByText(MASK)).toEqual([]);
    expect(services.settings.save).toHaveBeenCalledWith(
      expect.objectContaining({ hideValues: false }),
    );
  });

  it('masks the expanded header too, and the eye in the bar toggles all of it', async () => {
    const store = persistentStore();
    await render(<AppRoot services={app(store)} />);
    await screen.findByText('Total gain');

    // Collapsed: the total in the bar is the only header figure.
    const bar = screen.getByTestId('header-value');
    expect(within(bar).getByText('1.500,00\u00A0€')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Portfolio value, show details'));
    const panel = await screen.findByTestId('header-panel');
    expect(within(panel).getByText('Portfolio value')).toBeOnTheScreen();
    expect(within(panel).getByText('1.500,00\u00A0€')).toBeOnTheScreen();
    expect(within(panel).getByText('+50,00\u00A0€')).toBeOnTheScreen(); // today's result
    expect(within(panel).getByText('+3,45%')).toBeOnTheScreen();

    // The eye stays in the bar while the panel is open.
    await fireEvent.press(screen.getByLabelText('Hide values'));
    for (const f of within(panel).getAllByTestId(/money|pct/)) expect(f).toHaveTextContent(MASK);
    expect(within(bar).queryByText(AMOUNT_TEXT)).toBeNull();
    expect(screen.queryByText(AMOUNT_TEXT)).toBeNull(); // the Dashboard under it as well
    expect(screen.getByLabelText('Show values')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Show values'));
    expect(within(panel).getAllByText('1.500,00\u00A0€').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.500,00\u00A0€').length).toBeGreaterThan(2);
  });

  it('is one switch: the drawer’s Hide amounts is the eye', async () => {
    const store = persistentStore();
    await render(<AppRoot services={app(store)} />);
    await screen.findByText('Total gain');
    await fireEvent.press(screen.getByLabelText('Open menu'));
    await fireEvent(await screen.findByLabelText('Hide amounts'), 'valueChange', true);
    expect(screen.getByLabelText('Show values')).toBeOnTheScreen();
    expect(text('money').every((t) => t === MASK)).toBe(true);
    await fireEvent.press(screen.getByLabelText('Show values'));
    expect(screen.getByLabelText('Hide amounts').props.value).toBe(false);
  });

  it('persists across a restart', async () => {
    const store = persistentStore();
    const first = await render(<AppRoot services={app(store)} />);
    await screen.findByText('Total gain');
    expect(screen.queryAllByText(MASK)).toEqual([]);
    await fireEvent.press(screen.getByLabelText('Hide values'));
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({ hideValues: true }));
    await first.unmount();

    // A new process reads what was saved: masked from the first frame it can draw.
    await render(<AppRoot services={app(store)} />);
    await screen.findByText('Total gain');
    expect(screen.getByLabelText('Show values')).toBeOnTheScreen();
    expect(screen.queryByText(AMOUNT_TEXT)).toBeNull();
    for (const f of screen.getAllByTestId(/money|units|pct/)) expect(f).toHaveTextContent(MASK);
  });
});
