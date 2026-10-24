import { MfaRequiredError } from '@ledgr/client';
import { dec, localDate } from '@ledgr/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppRoot } from '../AppRoot';
import { createSupabaseData } from '../data/supabaseData';
import { TIME_ZONE } from '../data/usePortfolio';
import { fakeAuth, fakeData, fakeServices, sampleLedger, token } from '../test/fakes';
import { goToNew } from '../test/nav';

jest.mock('../dashboard/ValueChart', () => ({ ValueChart: () => null }));
jest.mock('../dashboard/AllocationDonut', () => ({ AllocationDonut: () => null }));

const today = localDate(new Date(), TIME_ZONE);

describe('MFA gating', () => {
  it('sends an aal1 session to the code prompt and runs no query', async () => {
    const { auth } = fakeAuth({ level: 'aal1' });
    const data = fakeData(sampleLedger(today));
    await render(<AppRoot services={fakeServices({ auth, data })} />);

    expect(await screen.findByText('Two-factor code')).toBeOnTheScreen();
    expect(screen.queryByText('Total gain')).toBeNull();
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

    expect(await screen.findByText('Total gain')).toBeOnTheScreen();
    // The total (also the only type in the allocation legend).
    expect((await screen.findAllByText('1.500,00\u00A0€')).length).toBeGreaterThan(0);
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

    expect(await screen.findByText('No transactions yet')).toBeOnTheScreen();
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
    expect(screen.queryByText('No transactions yet')).toBeNull();
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
        'ca_series',
        'ca_subscriptions',
        'transactions',
      ]),
    );
  });
});

describe('writes', () => {
  /**
   * A Supabase client whose every query is recorded when sent; `answer` decides the result
   * of an insert, an update or a read.
   */
  function writeClient(
    level: 'aal1' | 'aal2',
    answer: (op: 'insert' | 'update' | 'select', table: string) => unknown = () => ({
      data: [],
      error: null,
    }),
  ) {
    const sent: string[] = [];
    const from = (table: string) => {
      let op: 'insert' | 'update' | 'select' = 'select';
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'is', 'order', 'gte', 'eq', 'lt', 'limit', 'in', 'range']) {
        q[m] = () => q;
      }
      q.insert = () => ((op = 'insert'), q);
      q.update = () => ((op = 'update'), q);
      q.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => {
        sent.push(`${op} ${table}`);
        return Promise.resolve(answer(op, table)).then(ok, fail);
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
      from,
      functions: { invoke: jest.fn() },
    };
    return {
      api: createSupabaseData(client as unknown as Parameters<typeof createSupabaseData>[0]),
      sent,
    };
  }
  const row = sampleLedger(today).ledger.transactions[0]!;

  it('refuses every write (and the job-run read) under aal1 before it is sent', async () => {
    const { api, sent } = writeClient('aal1');
    for (const call of [
      () => api.insertTransaction(row),
      () => api.updateTransaction(row),
      () => api.deleteTransaction(row.id),
      () =>
        api.insertAsset({
          id: 'a',
          name: 'x',
          assetType: 'stock',
          ticker: 'X',
          isin: null,
          exchange: 'XNAS',
          tradingCurrency: 'USD',
        }),
      () => api.insertFactors('2026-10-01', [{ subscriptionId: 's1', factor: dec('1.1') }]),
      () => api.jobRuns(),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(MfaRequiredError);
    }
    expect(sent).toEqual([]);
  });

  it('a retried insert whose first attempt landed (23505 on the id) counts as saved', async () => {
    const landed = writeClient('aal2', (op) =>
      op === 'insert'
        ? { data: null, error: { code: '23505' } }
        : { data: [{ id: row.id }], error: null },
    );
    await expect(landed.api.insertTransaction(row)).resolves.toBeUndefined();
    expect(landed.sent).toEqual(['insert transactions', 'select transactions']);

    // 23505 but no row with this id: a real conflict, reported with its code only
    const other = writeClient('aal2', (op) =>
      op === 'insert' ? { data: null, error: { code: '23505' } } : { data: [], error: null },
    );
    await expect(other.api.insertTransaction(row)).rejects.toMatchObject({ code: '23505' });
  });

  it('a delete retried after it went through counts as done; an unknown row does not', async () => {
    const again = writeClient('aal2', (op) =>
      op === 'update' ? { data: [], error: null } : { data: [{ id: row.id }], error: null },
    );
    await expect(again.api.deleteTransaction(row.id)).resolves.toBeUndefined();
    const gone = writeClient('aal2', () => ({ data: [], error: null }));
    await expect(gone.api.deleteTransaction(row.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a save refused for want of MFA sends the app back to the code prompt', async () => {
    const { auth, state } = fakeAuth({ level: 'aal2' });
    const data = fakeData(sampleLedger(today));
    data.insertTransaction.mockImplementation(async () => {
      state.level = 'aal1';
      throw new MfaRequiredError();
    });
    await render(<AppRoot services={fakeServices({ auth, data })} />);
    await screen.findByText('Total gain');
    await goToNew();
    await fireEvent.press(await screen.findByLabelText('Pick VWCE'));
    await fireEvent.changeText(screen.getByLabelText('Quantity'), '1');
    await fireEvent.changeText(screen.getByLabelText('Total value (€)'), '150');
    await fireEvent.press(screen.getByText('Review'));
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('Two-factor code')).toBeOnTheScreen();
  });
});

describe('sign in', () => {
  it('names its fields for a screen reader, not only by placeholder', async () => {
    const { auth } = fakeAuth({ signedIn: false });
    await render(
      <AppRoot services={fakeServices({ auth, data: fakeData(sampleLedger(today)) })} />,
    );
    expect(await screen.findByLabelText('Email')).toBeOnTheScreen();
    expect(screen.getByLabelText('Password')).toBeOnTheScreen();
  });
});
