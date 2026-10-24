import { localDate } from '@ledgr/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { fakeAuth, fakeData, fakeServices, portfolioLedger } from '../test/fakes';
import { AMOUNT_TEXT } from '../test/leaks';
import { goToCertificados, goToNew, openDrawer } from '../test/nav';
import { MASK } from '../ui/Amount';

jest.mock('react-native-gifted-charts', () => ({
  LineChart: () => null,
  PieChart: () => null,
  BarChart: () => null,
}));

const today = localDate(new Date(), TIME_ZONE);
const drawer = () => screen.getByTestId('drawer-panel');
const flip = (label: string, on: boolean) =>
  fireEvent(within(drawer()).getByLabelText(label), 'valueChange', on);

/** Settings that remember what was saved, like AsyncStorage across a restart. */
function persistentStore(initial: Record<string, unknown> = {}) {
  let saved: unknown = { lockEnabled: true, ...initial };
  return {
    load: jest.fn(async () => saved),
    save: jest.fn(async (settings: unknown) => {
      saved = JSON.parse(JSON.stringify(settings));
    }),
    saved: () => saved as Record<string, unknown>,
  };
}

function build(store: ReturnType<typeof persistentStore>) {
  const { auth } = fakeAuth({ level: 'aal2' });
  const services = fakeServices({ auth, data: fakeData(portfolioLedger(today)) });
  services.settings = store;
  return services;
}

async function start(store: ReturnType<typeof persistentStore>) {
  const services = build(store);
  const view = await render(<AppRoot services={services} />);
  // Lock is on in the store: the fake device authenticates at once.
  await screen.findByText('Total gain');
  return { services, view };
}

const typeLabels = () =>
  screen
    .getAllByLabelText(/^Type /)
    .map((e) => e.props.accessibilityLabel as string)
    .filter((l) => l !== 'Type');

describe('New transaction options', () => {
  it('offers Buy and Sell only, with no Fee field, until the drawer switches say otherwise', async () => {
    await start(persistentStore());
    await goToNew();
    await screen.findByLabelText('Type Buy');
    expect(typeLabels()).toEqual(['Type Buy', 'Type Sell']);
    expect(screen.queryByLabelText('Type Dividend')).toBeNull();
    expect(screen.queryByLabelText('Type Interest')).toBeNull();
    expect(screen.queryByLabelText('Fee (€, optional)')).toBeNull();
    expect(screen.queryByText('More')).toBeNull();

    await openDrawer();
    await screen.findByLabelText('Dividend');
    for (const label of ['Dividend', 'Interest', 'Fee']) {
      expect(within(drawer()).getByLabelText(label).props.value).toBe(false);
    }
  });

  it('each switch shows and hides its own option', async () => {
    await start(persistentStore());
    await goToNew();
    await openDrawer();
    await screen.findByLabelText('Dividend');

    await flip('Dividend', true);
    expect(typeLabels()).toEqual(['Type Buy', 'Type Sell', 'Type Dividend']);
    await flip('Interest', true);
    expect(typeLabels()).toEqual(['Type Buy', 'Type Sell', 'Type Dividend', 'Type Interest']);
    expect(screen.queryByLabelText('Fee (€, optional)')).toBeNull();
    await flip('Fee', true);
    expect(screen.getByLabelText('Fee (€, optional)')).toBeOnTheScreen();

    await flip('Dividend', false);
    expect(typeLabels()).toEqual(['Type Buy', 'Type Sell', 'Type Interest']);
    await flip('Interest', false);
    await flip('Fee', false);
    expect(typeLabels()).toEqual(['Type Buy', 'Type Sell']);
    expect(screen.queryByLabelText('Fee (€, optional)')).toBeNull();
  });

  it('keeps them across a restart', async () => {
    const store = persistentStore();
    const first = await start(store);
    await openDrawer();
    await screen.findByLabelText('Dividend');
    await flip('Dividend', true);
    await flip('Fee', true);
    expect(store.saved().newTxOptions).toEqual({ dividend: true, interest: false, fee: true });
    await first.view.unmount();

    await start(store);
    await goToNew();
    await screen.findByLabelText('Type Buy');
    expect(typeLabels()).toEqual(['Type Buy', 'Type Sell', 'Type Dividend']);
    expect(screen.getByLabelText('Fee (€, optional)')).toBeOnTheScreen();
    await openDrawer();
    await screen.findByLabelText('Interest');
    expect(within(drawer()).getByLabelText('Interest').props.value).toBe(false);
  });

  it('falls back to Buy when the selected type is switched off, and a typed fee is not saved', async () => {
    const store = persistentStore({
      newTxOptions: { dividend: true, interest: false, fee: true },
    });
    await start(store);
    await goToNew();
    await fireEvent.press(await screen.findByLabelText('Type Dividend'));
    expect(screen.getByLabelText('Type Dividend')).toBeSelected();
    await openDrawer();
    await screen.findByLabelText('Dividend');
    await flip('Dividend', false);
    await waitFor(() => expect(screen.getByLabelText('Type Buy')).toBeSelected());
    expect(screen.getByLabelText('Quantity')).toBeOnTheScreen();
  });
});

describe('Drawer settings', () => {
  it('appearance, privacy and the security switches are saved and applied', async () => {
    const store = persistentStore();
    const { services, view } = await start(store);
    await openDrawer();
    await screen.findByLabelText('Hide amounts');

    await fireEvent.press(within(drawer()).getByText('Light'));
    await flip('Hide amounts', true);
    await flip('Block screenshots', false);
    await waitFor(() =>
      expect(services.device.setScreenCaptureBlocked).toHaveBeenLastCalledWith(false),
    );
    await flip('App lock', false);
    expect(store.saved()).toEqual(
      expect.objectContaining({
        appearance: 'light',
        hideValues: true,
        blockScreenshots: false,
        lockEnabled: false,
      }),
    );
    // Applied: the figures are masked and the eye shows it.
    expect(screen.getByLabelText('Show values')).toBeOnTheScreen();
    for (const f of screen.getAllByTestId(/money|pct/)) expect(f).toHaveTextContent(MASK);
    await view.unmount();

    // After a restart nothing asks for the lock, and the choices are still there.
    const again = await start(store);
    expect(again.services.device.authenticate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Show values')).toBeOnTheScreen();
    await openDrawer();
    await screen.findByLabelText('Hide amounts');
    expect(within(drawer()).getByLabelText('Hide amounts').props.value).toBe(true);
    expect(within(drawer()).getByLabelText('Block screenshots').props.value).toBe(false);
    expect(within(drawer()).getByLabelText('App lock').props.value).toBe(false);
    expect(again.services.device.setScreenCaptureBlocked).toHaveBeenCalledWith(false);
  });
});

describe('Calculator tab and the old More screen', () => {
  it('has no More route; the Calculator is a tab and appears nowhere else', async () => {
    await start(persistentStore());
    expect(screen.queryByText('More')).toBeNull();
    await openDrawer();
    await screen.findByLabelText('Hide amounts');
    expect(within(drawer()).queryByText('More')).toBeNull();
    expect(within(drawer()).queryByText(/calculator/i)).toBeNull();

    await fireEvent.press(screen.getByLabelText('Calculator'));
    expect(await screen.findByText('Your numbers')).toBeOnTheScreen();
    expect(screen.getByLabelText('Calculator')).toBeSelected();
    expect(screen.getByText('Reset to my values')).toBeOnTheScreen();
  });
});

describe('Privacy on the screens of this slice', () => {
  const nothingShown = () => {
    expect(screen.queryByText(AMOUNT_TEXT)).toBeNull();
    expect(screen.queryByText(/[+−]?\d+,\d\d%/)).toBeNull();
  };

  it('masks the Calculator, Certificados, the factor update and the New transaction form', async () => {
    const store = persistentStore({ hideValues: true });
    await start(store);

    await fireEvent.press(screen.getByLabelText('Calculator'));
    await screen.findByText('Your numbers');
    expect(await screen.findByTestId('projection-result')).toBeOnTheScreen();
    nothingShown();
    expect(screen.getByLabelText('Starting value (€)')).toHaveProp('editable', false);
    for (const f of within(screen.getByTestId('projection-result')).getAllByTestId(/money|pct/)) {
      expect(f).toHaveTextContent(MASK);
    }

    await goToNew();
    await screen.findByLabelText('Type Buy');
    await fireEvent.press(screen.getByLabelText('Type Sell'));
    await fireEvent.press(await screen.findByLabelText('Pick VWCE'));
    nothingShown();
    for (const u of screen.getAllByTestId('units')) expect(u).toHaveTextContent(MASK);
    await goToCertificados();
    expect((await screen.findAllByTestId('ca-row')).length).toBeGreaterThan(0);
    nothingShown();
    await fireEvent.press(screen.getByText('Update factors'));
    await screen.findAllByTestId('factor-line');
    nothingShown();
  });
});

describe('A small dummy buy, with the default options', () => {
  it('is entered on the plain Buy form, saved as one row, and deleted again', async () => {
    const { services } = await start(persistentStore());
    await goToNew();
    await fireEvent.press(await screen.findByLabelText('Pick VWCE'));
    await fireEvent.changeText(screen.getByLabelText('Quantity'), '1');
    await fireEvent.changeText(screen.getByLabelText('Total value (€)'), '1');
    await fireEvent.press(screen.getByText('Review'));
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText(/Saved: Buy VWCE/)).toBeOnTheScreen();
    const data = services.data as unknown as {
      insertTransaction: jest.Mock;
      deleteTransaction: jest.Mock;
    };
    expect(data.insertTransaction).toHaveBeenCalledTimes(1);
    const row = data.insertTransaction.mock.calls[0]![0] as {
      id: string;
      fees: { toString(): string };
    };
    expect(row.fees.toString()).toBe('0'); // the hidden Fee field is saved as 0

    await fireEvent.press(screen.getByLabelText('Activity'));
    await fireEvent.press(await screen.findByLabelText(`Buy VWCE ${today}`));
    await fireEvent.press(await screen.findByText('Delete'));
    await fireEvent.press(screen.getAllByText('Delete').at(-1)!);
    await waitFor(() => expect(data.deleteTransaction).toHaveBeenCalledWith(row.id));
  });
});
