import { addMonths, dec, localDate } from '@ledgr/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { formatDateTime, formatPeriod } from '../format';
import { fakeAuth, fakeData, fakeServices, portfolioLedger } from '../test/fakes';
import { goToCertificados, openDrawer } from '../test/nav';

jest.mock('react-native-gifted-charts', () => ({
  LineChart: () => null,
  PieChart: () => null,
  BarChart: () => null,
}));

const today = localDate(new Date(), TIME_ZONE);
const thisMonth = `${today.slice(0, 7)}-01`;

/** The portfolio fixture with its one subscription's factors replaced. */
async function openApp(factors: { month: string; factor: string }[]) {
  const fixture = portfolioLedger(today);
  fixture.ledger.ca.factors = factors.map((f) => ({
    subscriptionId: 's1',
    month: f.month,
    factor: dec(f.factor),
  }));
  const data = fakeData(fixture);
  const { auth } = fakeAuth({ level: 'aal2' });
  await render(<AppRoot services={fakeServices({ auth, data })} />);
  await screen.findByText('Total gain');
  return data;
}

describe('Certificados', () => {
  it('lists each subscription: units, latest factor and month, value from factor, gain, age', async () => {
    const month = addMonths(thisMonth, -1);
    await openApp([{ month, factor: '1.10482' }]);
    await goToCertificados();
    const row = (await screen.findAllByTestId('ca-row'))[0]!;
    expect(within(row).getByText('Série E · subscribed Jan 2025')).toBeOnTheScreen();
    expect(within(row).getByText(/value from factor/)).toBeOnTheScreen();
    expect(within(row).getByText('1.000')).toBeOnTheScreen();
    expect(within(row).getByText(`Factor of ${formatPeriod(month.slice(0, 7))}`)).toBeOnTheScreen();
    expect(within(row).getByText('1,10482\u00A0€')).toBeOnTheScreen();
    expect(within(row).getByText('1.104,82\u00A0€')).toBeOnTheScreen();
    expect(within(row).getByText('+104,82\u00A0€')).toBeOnTheScreen();
    expect(within(row).getByText(/^Factor \d+ days old$/)).toBeOnTheScreen();
  });

  it('flags a factor more than 35 days old', async () => {
    await openApp([{ month: addMonths(thisMonth, -3), factor: '1.1' }]);
    await goToCertificados();
    const row = (await screen.findAllByTestId('ca-row'))[0]!;
    expect(within(row).getByText('over 35 days')).toBeOnTheScreen();
    expect(screen.getByText(/a factor more than 35\s+days old/)).toBeOnTheScreen();
  });

  it('a factor in force within 35 days is not flagged', async () => {
    await openApp([{ month: thisMonth, factor: '1.1' }]);
    await goToCertificados();
    const row = (await screen.findAllByTestId('ca-row'))[0]!;
    expect(within(row).queryByText('over 35 days')).toBeNull();
  });
});

describe('Factor update', () => {
  async function openUpdate(factors: { month: string; factor: string }[]) {
    const data = await openApp(factors);
    await goToCertificados();
    await fireEvent.press(await screen.findByText('Update factors'));
    await screen.findAllByTestId('factor-line');
    return data;
  }
  const input = () => screen.getByLabelText(/^Factor for Série E/);

  it('preselects this month and shows the change vs last month as you type, from factor', async () => {
    const data = await openUpdate([{ month: addMonths(thisMonth, -1), factor: '1.10482' }]);
    expect(screen.getByText(formatPeriod(thisMonth.slice(0, 7)))).toBeOnTheScreen();
    expect(
      screen.getByText(`Last: ${formatPeriod(addMonths(thisMonth, -1).slice(0, 7))}`),
    ).toBeOnTheScreen();

    expect(screen.getByText(/tomorrow’s daily run/)).toBeOnTheScreen();
    await fireEvent.changeText(input(), '1,11');
    const change = screen.getByTestId('factor-change');
    expect(within(change).getByText(/from factor/)).toBeOnTheScreen();
    expect(within(change).getByText('+5,18\u00A0€')).toBeOnTheScreen(); // 1,000 x (1.11 - 1.10482)
    expect(within(change).getByText('+0,47%')).toBeOnTheScreen();
    expect(screen.queryByText(/Lower than last month/)).toBeNull();

    await fireEvent.changeText(input(), '1.1');
    expect(screen.getByText(/Lower than last month/)).toBeOnTheScreen(); // a warning only
    expect(screen.getByText('Save factor')).toBeEnabled();

    await fireEvent.changeText(input(), 'abc');
    expect(screen.getByText('Not a number (e.g. 1.10482).')).toBeOnTheScreen();
    expect(screen.getByText('Save factor')).toBeDisabled();

    await fireEvent.changeText(input(), '1.11');
    await fireEvent.press(screen.getByText('Save factor'));
    await waitFor(() => expect(data.insertFactors).toHaveBeenCalledTimes(1));
    const [month, rows] = data.insertFactors.mock.calls[0]!;
    expect(month).toBe(thisMonth);
    expect(rows.map((r) => [r.subscriptionId, r.factor.toString()])).toEqual([['s1', '1.11']]);
    // now recorded: read-only, never changed
    expect(await screen.findByText('(read-only)')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Factor for/)).toBeNull();
  });

  it('a month already recorded is read-only; earlier months can be chosen, later ones not', async () => {
    await openUpdate([{ month: thisMonth, factor: '1.10482' }]);
    expect(screen.getByText('(read-only)')).toBeOnTheScreen();
    expect(screen.queryByText('Save factor')).toBeNull();
    expect(screen.getByLabelText('Next month')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Previous month'));
    expect(screen.getByText(formatPeriod(addMonths(thisMonth, -1).slice(0, 7)))).toBeOnTheScreen();
    expect(input()).toBeOnTheScreen();
  });
});

describe('Drawer settings', () => {
  it('lock, hide amounts, screenshots, the last price update and snapshot, sign out, version', async () => {
    const { auth } = fakeAuth({ level: 'aal2' });
    const data = fakeData(portfolioLedger(today));
    await render(<AppRoot services={fakeServices({ auth, data })} />);
    await screen.findByText('Total gain');
    await openDrawer();

    expect(await screen.findByLabelText('App lock')).toBeOnTheScreen();
    expect(screen.getByLabelText('Hide amounts')).toBeOnTheScreen();
    expect(screen.getByLabelText('Block screenshots')).toBeOnTheScreen();
    const year = String(new Date().getFullYear());
    expect(
      await screen.findByText(formatDateTime(Date.parse('2026-10-23T05:25:41Z'), year)),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(formatDateTime(Date.parse('2026-10-23T05:40:12Z'), year)),
    ).toBeOnTheScreen();
    expect(screen.getByText('ok')).toBeOnTheScreen();
    expect(screen.getByText('partial')).toBeOnTheScreen();
    expect(screen.getByText(/project abcdefghijklmnopqrst/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Sign out'));
    expect((await screen.findAllByText('Sign in')).length).toBeGreaterThan(0);
    expect(auth.signOut).toHaveBeenCalled();
  });
});
