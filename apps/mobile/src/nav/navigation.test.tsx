import { localDate } from '@ledgr/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler } from 'react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { fakeAuth, fakeData, fakeServices, portfolioLedger, sampleLedger } from '../test/fakes';
import { MASK } from '../ui/Amount';

jest.mock('@ledgr/core', () => {
  const actual = jest.requireActual('@ledgr/core');
  return { ...actual, buildDashboard: jest.fn(actual.buildDashboard) };
});
jest.mock('react-native-gifted-charts', () => ({
  LineChart: () => null,
  PieChart: () => null,
  BarChart: () => null,
}));

const today = localDate(new Date(), TIME_ZONE);
const pressBack = () => (BackHandler as unknown as { mockPressBack(): boolean }).mockPressBack();
const exitApp = BackHandler.exitApp as jest.Mock;

async function openApp(settings: Record<string, unknown> = {}) {
  const data = fakeData(portfolioLedger(today));
  const { auth } = fakeAuth({ level: 'aal2' });
  const services = fakeServices({ auth, data, settings });
  await render(<AppRoot services={services} />);
  await screen.findByText('Total gain');
  return { data, services };
}

const bar = () => screen.getByTestId('header-value');
const headerPanel = () => screen.queryByTestId('header-panel');
const toggleHeader = () =>
  fireEvent.press(
    screen.getByLabelText(/^Portfolio value, (show|hide) details$/, { exact: false }),
  );
const drawer = () => screen.getByTestId('drawer-panel');
const drawerIsOpen = () => drawer().props.accessibilityState.expanded === true;

beforeEach(() => exitApp.mockClear());

describe('the shared header', () => {
  it('starts collapsed with the total in the middle, the menu on the left and the eye on the right', async () => {
    await openApp();
    expect(screen.getByLabelText('Open menu')).toBeOnTheScreen();
    expect(within(bar()).getByText('6.590,82 €')).toBeOnTheScreen();
    expect(screen.getByLabelText('Hide values')).toBeOnTheScreen();
    expect(headerPanel()).toBeNull();
    expect(bar()).toBeCollapsed();
    expect(screen.getByLabelText('Portfolio value, show details')).toBeOnTheScreen();
  });

  it("expands to Portfolio value, Today's result and Total result (value and %)", async () => {
    await openApp();
    await toggleHeader();
    const panel = await screen.findByTestId('header-panel');
    expect(screen.getByLabelText('Portfolio value, hide details')).toBeExpanded();
    expect(within(panel).getByText('Portfolio value')).toBeOnTheScreen();
    expect(within(panel).getByText('6.590,82 €')).toBeOnTheScreen();
    // Today: VWCE 15 units, 140 -> 150 = +150 on V(Y) = 2,100 + 736 + 2,500 + 1,104.82 = 6,440.82
    // (+2.33%); everything else is flat.
    expect(within(panel).getByText("Today's result")).toBeOnTheScreen();
    expect(within(panel).getByText('+150,00 €')).toBeOnTheScreen();
    expect(within(panel).getByText('+2,33%')).toBeOnTheScreen();
    // Total result: the total gain G (+547.82), with the TWR since start as its %.
    expect(within(panel).getByText('Total result')).toBeOnTheScreen();
    expect(within(panel).getByText('+547,82 €')).toBeOnTheScreen();
    expect(within(panel).getAllByTestId('pct')).toHaveLength(2);
    await toggleHeader();
    await waitFor(() => expect(headerPanel()).toBeNull());
  });

  it('shows the same expanded state on every tab, and on a pushed screen', async () => {
    await openApp();
    await toggleHeader();
    await screen.findByTestId('header-panel');
    for (const tab of ['Positions', 'Activity', 'Calculator', 'Dashboard']) {
      await fireEvent.press(screen.getByLabelText(tab));
      expect(screen.getByTestId('header-panel')).toBeOnTheScreen();
      expect(screen.getByLabelText('Portfolio value, hide details')).toBeOnTheScreen();
    }
    // A pushed detail screen has its own bar (back button, same eye) over the same state.
    await fireEvent.press(screen.getByText('By broker, currency and asset ›'));
    await screen.findAllByText(/as of/);
    expect(screen.getAllByLabelText('Back').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('header-panel').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getAllByLabelText('Portfolio value, hide details').at(-1)!);
    await waitFor(() => expect(headerPanel()).toBeNull());
    await fireEvent.press(screen.getAllByLabelText('Back').at(-1)!);
    expect(screen.queryByTestId('header-panel')).toBeNull();
    expect(screen.getByLabelText('Portfolio value, show details')).toBeOnTheScreen();
  });

  it('jumps instead of animating when the phone has Remove animations on', async () => {
    const reduce = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
    reduce.mockImplementation(async () => true);
    try {
      await openApp();
      await toggleHeader();
      expect(await screen.findByTestId('header-panel')).toBeOnTheScreen();
      await toggleHeader();
      // No 180 ms animation to wait for: gone as soon as the state settles.
      await waitFor(() => expect(headerPanel()).toBeNull(), { timeout: 100 });
    } finally {
      reduce.mockImplementation(async () => false);
    }
  });

  it('collapses again on a restart', async () => {
    await openApp();
    await toggleHeader();
    await screen.findByTestId('header-panel');
    await screen.unmount();
    await openApp();
    expect(headerPanel()).toBeNull();
    expect(screen.getByLabelText('Portfolio value, show details')).toBeOnTheScreen();
  });

  it('pushed detail screens keep the eye and show a back button instead of the menu', async () => {
    await openApp();
    await fireEvent.press(screen.getByText('Monthly and yearly returns ›'));
    await screen.findAllByText(/as of/);
    const eyes = screen.getAllByLabelText('Hide values');
    await fireEvent.press(eyes.at(-1)!);
    expect(screen.getAllByLabelText('Show values').length).toBeGreaterThan(0);
    for (const f of screen.getAllByTestId('money')) expect(f).toHaveTextContent(MASK);
    expect(screen.getByRole('header', { name: 'Performance' })).toBeOnTheScreen();
  });

  it('follows the certificados toggle and says so', async () => {
    await openApp({ includeCertificados: false });
    // 6,590.82 - 1,104.82 certificados
    expect(within(bar()).getByText('5.486,00 €')).toBeOnTheScreen();
    expect(within(bar()).getByText('Excluding certificados')).toBeOnTheScreen();
    await toggleHeader();
    const panel = await screen.findByTestId('header-panel');
    expect(within(panel).getByText('5.486,00 €')).toBeOnTheScreen();
    expect(within(panel).getByText('+443,00 €')).toBeOnTheScreen();
    expect(within(panel).getByText(/^Excluding certificados · as of /)).toBeOnTheScreen();
    await fireEvent(
      screen.getAllByLabelText('Include certificados de aforro')[0]!,
      'valueChange',
      true,
    );
    expect(within(bar()).getByText('6.590,82 €')).toBeOnTheScreen();
    expect(within(bar()).queryByText('Excluding certificados')).toBeNull();
  });

  it('shows a dash and the reason when a holding has no exchange rate', async () => {
    const fixture = portfolioLedger(today);
    fixture.market.fx = [];
    const { auth } = fakeAuth({ level: 'aal2' });
    await render(<AppRoot services={fakeServices({ auth, data: fakeData(fixture) })} />);
    expect(await screen.findByText(/No exchange rate for USD/)).toBeOnTheScreen();
    expect(within(bar()).getByText('—')).toBeOnTheScreen();
    await toggleHeader();
    const panel = await screen.findByTestId('header-panel');
    expect(within(panel).getByText(/No exchange rate for USD/)).toBeOnTheScreen();
    expect(within(panel).queryByTestId('money')).toBeNull();
  });

  it('shows a skeleton instead of the total while loading', async () => {
    const { auth } = fakeAuth({ level: 'aal2' });
    const data = fakeData(sampleLedger(today));
    data.ledger.mockImplementation(() => new Promise(() => undefined));
    await render(<AppRoot services={fakeServices({ auth, data })} />);
    expect(await screen.findByTestId('header-value')).toBeOnTheScreen();
    expect(
      within(bar()).getByTestId('skeleton', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(within(bar()).queryByTestId('money')).toBeNull();
  });
});

describe('the drawer', () => {
  it('opens from the menu button and holds the settings sections', async () => {
    await openApp();
    expect(drawerIsOpen()).toBe(false);
    expect(screen.queryByLabelText('Hide amounts')).toBeNull(); // not built before the first open
    await fireEvent.press(screen.getByLabelText('Open menu'));
    await waitFor(() => expect(drawerIsOpen()).toBe(true));
    for (const section of [
      'Appearance',
      'Privacy',
      'New transaction options',
      'Security',
      'Data',
    ]) {
      expect(within(drawer()).getByText(section)).toBeOnTheScreen();
    }
    expect(within(drawer()).getByText('Certificados')).toBeOnTheScreen();
    expect(within(drawer()).getByText('Sign out')).toBeOnTheScreen();
  });

  it('closes on a tap on the backdrop', async () => {
    await openApp();
    await fireEvent.press(screen.getByLabelText('Open menu'));
    await waitFor(() => expect(drawerIsOpen()).toBe(true));
    await fireEvent.press(screen.getByLabelText('Close drawer'));
    await waitFor(() => expect(drawerIsOpen()).toBe(false));
  });

  it('closes when a link in it is followed', async () => {
    await openApp();
    await fireEvent.press(screen.getByLabelText('Open menu'));
    await waitFor(() => expect(drawerIsOpen()).toBe(true));
    await fireEvent.press(within(drawer()).getByText('Certificados'));
    expect(await screen.findByRole('header', { name: 'Certificados' })).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByLabelText('Back').at(-1)!);
    await waitFor(() => expect(drawerIsOpen()).toBe(false));
  });
});

describe('Android back', () => {
  it('closes the drawer first, then collapses the header, then leaves the app', async () => {
    await openApp();
    await toggleHeader();
    await screen.findByTestId('header-panel');
    await fireEvent.press(screen.getByLabelText('Open menu'));
    await waitFor(() => expect(drawerIsOpen()).toBe(true));

    // 1: the drawer closes; the header stays expanded.
    expect(pressBack()).toBe(true);
    await waitFor(() => expect(drawerIsOpen()).toBe(false));
    expect(screen.getByTestId('header-panel')).toBeOnTheScreen();
    // 2: the header collapses.
    expect(pressBack()).toBe(true);
    await waitFor(() => expect(headerPanel()).toBeNull());
    expect(exitApp).not.toHaveBeenCalled();
    // 3: nothing left to close: the press goes on to the navigator (here, leaving the app).
    expect(pressBack()).toBe(false);
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it('on a pushed screen: collapses the header, then leaves the screen', async () => {
    await openApp();
    await fireEvent.press(screen.getByText('By broker, currency and asset ›'));
    await screen.findAllByText(/as of/);
    await fireEvent.press(screen.getAllByLabelText('Portfolio value, show details').at(-1)!);
    await screen.findAllByTestId('header-panel');

    expect(pressBack()).toBe(true); // collapses
    await waitFor(() => expect(headerPanel()).toBeNull());
    expect(screen.getByRole('header', { name: 'Allocation' })).toBeOnTheScreen();
    expect(pressBack()).toBe(true); // the screen leaves
    await waitFor(() => expect(screen.queryByRole('header', { name: 'Allocation' })).toBeNull());
    expect(screen.getByText('Total gain')).toBeOnTheScreen();
  });
});

describe('the tab bar', () => {
  it('has Dashboard, Positions, New transaction, Activity and Calculator, and no More', async () => {
    await openApp();
    const tabs = within(screen.getByTestId('tab-bar')).getAllByRole('tab');
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual([
      'Dashboard',
      'Positions',
      'Activity',
      'Calculator',
    ]);
    expect(screen.getByLabelText('New transaction')).toBeOnTheScreen();
    expect(screen.queryByText('More')).toBeNull();
    expect(screen.getByLabelText('Dashboard')).toBeSelected();
  });

  it('makes New transaction a distinct, raised, round accent button of at least 48 dp', async () => {
    await openApp();
    const button = screen.getByTestId('new-transaction-button');
    expect(button).toHaveProp('accessibilityLabel', 'New transaction');
    expect(button).toHaveProp('accessibilityRole', 'button');
    const style = Object.assign({}, ...[button.props.style].flat(Infinity)) as Record<
      string,
      number | string
    >;
    expect(style.width).toBeGreaterThanOrEqual(48);
    expect(style.height).toBeGreaterThanOrEqual(48);
    expect(style.borderRadius).toBeGreaterThanOrEqual(Number(style.width) / 2); // round
    expect(style.backgroundColor).toBeTruthy(); // the accent fill
    // Raised above the bar by a translation, not a shadow.
    expect(JSON.stringify(screen.getByTestId('new-transaction-ring').props.style)).toContain(
      'translateY',
    );
    expect(JSON.stringify(button.props.style)).not.toContain('shadow');
    expect(JSON.stringify(button.props.style)).not.toContain('elevation');

    await fireEvent.press(button);
    expect(await screen.findByText('Review')).toBeOnTheScreen();
    expect(screen.getByLabelText('New transaction')).toBeSelected();
  });

  it('marks the current tab and keeps its screen when it is pressed again', async () => {
    await openApp();
    await fireEvent.press(screen.getByLabelText('Positions'));
    expect(screen.getByLabelText('Positions')).toBeSelected();
    expect(screen.getByLabelText('Dashboard')).not.toBeSelected();
  });
});

describe('the dashboard and the header share one build', () => {
  it('builds the dashboard once for the header and the Dashboard together', async () => {
    const core = jest.requireMock('@ledgr/core') as { buildDashboard: jest.Mock };
    core.buildDashboard.mockClear();
    await openApp();
    expect(core.buildDashboard).toHaveBeenCalledTimes(1);
    expect(within(bar()).getByText('6.590,82 €')).toBeOnTheScreen();
    expect(screen.getAllByText('+547,82 €').length).toBeGreaterThan(0);
    // A switch that changes the data recomputes once, not once per consumer.
    core.buildDashboard.mockClear();
    await fireEvent(
      screen.getAllByLabelText('Include certificados de aforro')[0]!,
      'valueChange',
      false,
    );
    expect(core.buildDashboard).toHaveBeenCalledTimes(1);
  });
});
