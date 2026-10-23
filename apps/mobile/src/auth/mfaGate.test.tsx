import { MfaRequiredError } from '@ledgr/client';
import { localDate } from '@ledgr/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppRoot } from '../AppRoot';
import { createSupabaseData } from '../data/supabaseData';
import { TIME_ZONE } from '../data/usePortfolio';
import { fakeAuth, fakeData, fakeServices, sampleLedger, token } from '../test/fakes';

jest.mock('../dashboard/ValueChart', () => ({ ValueChart: () => null }));
jest.mock('../dashboard/AllocationDonut', () => ({
  AllocationDonut: () => null,
  typeColor: () => '#000',
}));

const today = localDate(new Date(), TIME_ZONE);

describe('MFA gating', () => {
  it('sends an aal1 session to the code prompt and runs no query', async () => {
    const { auth } = fakeAuth({ level: 'aal1' });
    const data = fakeData(sampleLedger(today));
    await render(<AppRoot services={fakeServices({ auth, data })} />);

    expect(await screen.findByText('Two-factor code')).toBeOnTheScreen();
    expect(screen.queryByText('Total value')).toBeNull();
    expect(screen.queryByText(/No transactions yet/)).toBeNull();
    expect(data.valueNow).not.toHaveBeenCalled();
    expect(data.ledger).not.toHaveBeenCalled();
    expect(data.market).not.toHaveBeenCalled();
    expect(data.snapshots).not.toHaveBeenCalled();
  });

  it('opens the dashboard once the code is verified (aal2)', async () => {
    const { auth } = fakeAuth({ level: 'aal1' });
    const data = fakeData(sampleLedger(today));
    await render(<AppRoot services={fakeServices({ auth, data })} />);

    await fireEvent.changeText(await screen.findByLabelText('Authenticator code'), '123456');
    await fireEvent.press(screen.getByText('Verify'));

    expect(await screen.findByText('Total value')).toBeOnTheScreen();
    // The total (also the only type in the allocation legend).
    expect((await screen.findAllByText('€1,500.00')).length).toBeGreaterThan(0);
    expect(data.ledger).toHaveBeenCalled();
  });

  it('says enrollment is done on the desktop when no factor exists', async () => {
    const { auth } = fakeAuth({ level: 'aal1', factor: false });
    const data = fakeData(sampleLedger(today));
    await render(<AppRoot services={fakeServices({ auth, data })} />);

    expect(await screen.findByText('Set up two-factor sign-in first')).toBeOnTheScreen();
    expect(screen.getByText(/Enroll one on the desktop page/)).toBeOnTheScreen();
    expect(data.ledger).not.toHaveBeenCalled();
  });

  it('shows the empty state only after an aal2 query succeeded', async () => {
    const { auth } = fakeAuth({ level: 'aal2' });
    const empty = { ...sampleLedger(today) };
    empty.ledger = { ...empty.ledger, transactions: [] };
    const data = fakeData(empty);
    await render(<AppRoot services={fakeServices({ auth, data })} />);

    expect(await screen.findByText('No transactions yet.')).toBeOnTheScreen();
    expect(data.ledger).toHaveBeenCalledTimes(1);
  });

  it('switches to the code prompt when a query is refused for want of MFA', async () => {
    const { auth, state } = fakeAuth({ level: 'aal2' });
    const data = fakeData(sampleLedger(today));
    data.ledger.mockImplementation(async () => {
      state.level = 'aal1'; // e.g. the session was replaced by an aal1 one
      throw new MfaRequiredError();
    });
    await render(<AppRoot services={fakeServices({ auth, data })} />);

    expect(await screen.findByText('Two-factor code')).toBeOnTheScreen();
    expect(screen.queryByText('No transactions yet.')).toBeNull();
  });
});

describe('the data layer', () => {
  /** A Supabase client whose queries record that they ran. */
  function fakeClient(level: 'aal1' | 'aal2') {
    const ran: string[] = [];
    const query = (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'is', 'order', 'gte', 'eq', 'lt', 'limit']) q[m] = () => q;
      q.range = async () => {
        ran.push(table);
        return { data: [], error: null };
      };
      return q;
    };
    const client = {
      auth: {
        getSession: async () => ({
          data: { session: { access_token: token({ aal: level }) } },
          error: null,
        }),
      },
      from: (table: string) => query(table),
      functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
    };
    return { client: client as unknown as Parameters<typeof createSupabaseData>[0], ran };
  }

  it('refuses every request under aal1 before it is sent', async () => {
    const { client, ran } = fakeClient('aal1');
    const api = createSupabaseData(client);
    await expect(api.ledger()).rejects.toBeInstanceOf(MfaRequiredError);
    await expect(api.snapshots()).rejects.toBeInstanceOf(MfaRequiredError);
    await expect(api.market(today, [])).rejects.toBeInstanceOf(MfaRequiredError);
    await expect(api.priceHistory('vwce')).rejects.toBeInstanceOf(MfaRequiredError);
    await expect(api.valueNow()).rejects.toBeInstanceOf(MfaRequiredError);
    expect(ran).toEqual([]);
    expect(
      (client as unknown as { functions: { invoke: jest.Mock } }).functions.invoke,
    ).not.toHaveBeenCalled();
  });

  it('runs the queries under aal2', async () => {
    const { client, ran } = fakeClient('aal2');
    await createSupabaseData(client).ledger();
    await waitFor(() =>
      expect([...ran].sort()).toEqual([
        'accounts',
        'assets',
        'ca_factors',
        'ca_subscriptions',
        'transactions',
      ]),
    );
  });
});
