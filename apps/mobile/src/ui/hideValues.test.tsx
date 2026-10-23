import { dec, localDate } from '@ledgr/core';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { ServicesProvider } from '../services';
import { SettingsProvider } from '../settings/SettingsProvider';
import { fakeAuth, fakeData, fakeServices, sampleLedger } from '../test/fakes';
import { MASK, Money, Pct } from './Money';

jest.mock('../dashboard/ValueChart', () => ({ ValueChart: () => null }));
jest.mock('../dashboard/AllocationDonut', () => ({
  AllocationDonut: () => null,
  typeColor: () => '#000',
}));

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

describe('hide values', () => {
  it('masks an amount, signs and colour included, but not a percentage', async () => {
    await render(
      withSettings(
        true,
        <>
          <Money value={dec('-1234.5')} sign colored />
          <Money value={null} />
          <Pct value={dec('0.0345')} sign />
        </>,
      ),
    );
    const amounts = await screen.findAllByTestId('money');
    expect(amounts.map((a) => a.props.children)).toEqual([MASK, MASK]);
    expect(amounts[0]).not.toHaveStyle({ color: expect.any(String) });
    expect(screen.getByText('+3.45%')).toBeOnTheScreen();
  });

  it('shows amounts when off', async () => {
    await render(withSettings(false, <Money value={dec('-1234.5')} sign />));
    expect(await screen.findByText('−€1,234.50')).toBeOnTheScreen();
  });

  it('masks every amount on the dashboard and the eye button reveals them', async () => {
    const { auth } = fakeAuth({ level: 'aal2' });
    const services = fakeServices({
      auth,
      data: fakeData(sampleLedger(today)),
      settings: { hideValues: true },
    });
    await render(<AppRoot services={services} />);

    expect(await screen.findByText('Total value')).toBeOnTheScreen();
    const amounts = screen.getAllByTestId('money');
    expect(amounts.length).toBeGreaterThan(5);
    for (const a of amounts) expect(a).toHaveTextContent(MASK);
    expect(screen.queryByText(/€\d/)).toBeNull();
    expect(screen.getAllByText('+3.45%').length).toBeGreaterThan(0); // day change %, movers

    await fireEvent.press(screen.getByLabelText('Show values'));
    expect((await screen.findAllByText('€1,500.00')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('+€50.00').length).toBeGreaterThan(0); // day change, movers
    expect(screen.queryAllByText(MASK)).toEqual([]);
    expect(services.settings.save).toHaveBeenCalledWith(
      expect.objectContaining({ hideValues: false }),
    );
  });
});
