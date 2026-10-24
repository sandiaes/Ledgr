import { addDays, dec, localDate, type Transaction } from '@ledgr/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { formatDate } from '../format';
import { fakeAuth, fakeData, fakeServices, portfolioLedger } from '../test/fakes';
import { MASK } from '../ui/Money';

jest.mock('react-native-gifted-charts', () => ({
  LineChart: () => null,
  PieChart: () => null,
  BarChart: () => null,
}));

const today = localDate(new Date(), TIME_ZONE);

// The fixture (test/fakes.ts portfolioLedger), by broker:
//   Degiro  VWCE 10 @ 100 (2025-01-02), BTC 0.1, dividend 12 on VWCE
//   IBKR    VWCE 5 @ 120, AAPL 4 (USD), MSFT 2 bought and sold (closed), fee 5
//   AforroNet  certificado subscription
async function openApp(settings: { hideValues?: boolean } = {}) {
  const fixture = portfolioLedger(today);
  const data = fakeData(fixture);
  const { auth, state } = fakeAuth({ level: 'aal2' });
  const services = fakeServices({ auth, data, settings });
  await render(<AppRoot services={services} />);
  await screen.findByText('Total value');
  return { data, state, services };
}

async function openNew(settings: { hideValues?: boolean } = {}) {
  const app = await openApp(settings);
  await fireEvent.press(screen.getByText('New'));
  await screen.findByLabelText('Type Buy');
  return app;
}

const type = (label: string, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);
const review = () => screen.getByText('Review');

/** Buy (default type) of `asset`, then the given fields. */
async function fillBuy(asset: string, fields: { quantity?: string; total?: string; fee?: string }) {
  await fireEvent.press(screen.getByLabelText(`Pick ${asset}`));
  if (fields.quantity !== undefined) await type('Quantity', fields.quantity);
  if (fields.total !== undefined) await type('Total value (€)', fields.total);
  if (fields.fee !== undefined) await type('Fee (€, optional)', fields.fee);
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('New transaction: validation', () => {
  it('a sale offers only the brokers holding the asset and is blocked above that broker’s units', async () => {
    await openNew();
    await fireEvent.press(screen.getByLabelText('Type Sell'));
    // Only what is held can be sold: no closed MSFT, no certificado.
    expect(screen.getByLabelText('Pick VWCE')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Pick MSFT')).toBeNull();
    expect(screen.queryByLabelText(/Pick Certificados/)).toBeNull();
    expect(screen.queryByText('Add asset')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Pick VWCE'));
    const degiro = screen.getByLabelText('Broker Degiro');
    const ibkr = screen.getByLabelText('Broker IBKR');
    expect(screen.queryByLabelText('Broker AforroNet')).toBeNull();
    expect(
      within(degiro)
        .getAllByTestId('units')
        .map((u) => u.props.children),
    ).toEqual(['10', '10']);
    expect(
      within(ibkr)
        .getAllByTestId('units')
        .map((u) => u.props.children),
    ).toEqual(['5', '5']);
    expect(degiro).toBeSelected(); // the default: most units

    // 11 > Degiro's 10 (IBKR's 5 do not count: FIFO is per broker)
    await type('Quantity', '11');
    await type('Total value (€)', '1650');
    expect(screen.getByText(/More than Degiro can sell on/)).toBeOnTheScreen();
    expect(review()).toBeDisabled();

    await fireEvent.press(ibkr);
    await type('Quantity', '6');
    expect(screen.getByText(/More than IBKR can sell on/)).toBeOnTheScreen();
    expect(review()).toBeDisabled();
    await type('Quantity', '5');
    expect(screen.queryByText(/can sell on/)).toBeNull();
    expect(review()).toBeEnabled();
  });

  it('a backdated sale cannot take units a later sale needs', async () => {
    // Degiro sells 8 VWCE today: a sale yesterday may sell only the 2 not needed today.
    const fixture = portfolioLedger(today);
    fixture.ledger.transactions.push({
      ...fixture.ledger.transactions[0]!,
      id: 'later-sale',
      type: 'sell',
      tradeDate: today,
      quantity: dec('8'),
      unitPrice: dec('150'),
    });
    const data = fakeData(fixture);
    const { auth } = fakeAuth({ level: 'aal2' });
    await render(<AppRoot services={fakeServices({ auth, data })} />);
    await screen.findByText('Total value');
    await fireEvent.press(screen.getByText('New'));
    await fireEvent.press(await screen.findByLabelText('Type Sell'));
    await type('Date', addDays(today, -1));
    await fireEvent.press(screen.getByLabelText('Pick VWCE'));
    await fireEvent.press(screen.getByLabelText('Broker Degiro'));
    await type('Quantity', '3');
    await type('Total value (€)', '450');
    expect(screen.getByText(/a later sale needs the rest/)).toBeOnTheScreen();
    expect(review()).toBeDisabled();
    await type('Quantity', '2');
    expect(review()).toBeEnabled();
  });

  it('zero, negative and non-numeric amounts and a future date are blocked', async () => {
    await openNew();
    await fillBuy('VWCE', { quantity: '3', total: '450' });
    expect(review()).toBeEnabled();

    for (const [field, text, message] of [
      ['Quantity', '0', 'Must be more than 0.'],
      ['Quantity', '-1', 'Must be more than 0.'],
      ['Quantity', 'abc', /^Not a number/],
      ['Quantity', '1.234,5', /^No thousands separators/],
      ['Total value (€)', '0', 'Must be more than 0.'],
      ['Total value (€)', '-450', 'Must be more than 0.'],
      ['Total value (€)', '', 'Required.'],
      ['Fee (€, optional)', '-1', 'The fee cannot be negative.'],
      ['Date', addDays(today, 1), 'The date cannot be in the future.'],
      ['Date', '2026-02-30', 'Not a valid date (YYYY-MM-DD).'],
    ] as const) {
      await type(field, text);
      expect(screen.getByText(message)).toBeOnTheScreen();
      expect(review()).toBeDisabled();
      // back to a valid value
      await type(
        field,
        field === 'Quantity'
          ? '3'
          : field === 'Date'
            ? today
            : field === 'Fee (€, optional)'
              ? ''
              : '450',
      );
      expect(review()).toBeEnabled();
    }
  });

  it('derives the unit price from the total; dividends take the amount received', async () => {
    await openNew();
    await fillBuy('VWCE', { quantity: '3', total: '100' });
    expect(screen.getByText('€33.33')).toBeOnTheScreen();
    expect(screen.getByText('per unit')).toBeOnTheScreen();
    expect(screen.getByText(/broker actually charged/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Type Dividend'));
    expect(screen.queryByLabelText('Quantity')).toBeNull();
    expect(screen.queryByLabelText('Fee (€, optional)')).toBeNull();
    expect(screen.getByLabelText('Amount received (€)')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('More types'));
    await fireEvent.press(screen.getByLabelText('Type Interest'));
    expect(screen.queryByLabelText('Asset')).toBeNull(); // cash interest has no asset
  });
});

describe('New transaction: confirm and save', () => {
  it('shows the resulting position, saves one EUR row and refreshes every figure', async () => {
    const { data } = await openNew();
    await fillBuy('VWCE', { quantity: '5', total: '600', fee: '1' });
    await fireEvent.press(screen.getByLabelText('Broker IBKR'));
    await fireEvent.press(review());

    expect(screen.getByText('Check and save')).toBeOnTheScreen();
    expect(screen.getByText('€601.00')).toBeOnTheScreen(); // cost with the fee
    const [atIbkr, overall] = screen.getAllByTestId('resulting-position');
    expect(
      within(atIbkr!)
        .getAllByTestId('units')
        .map((u) => u.props.children),
    ).toEqual(['5', '10']);
    expect(
      within(overall!)
        .getAllByTestId('units')
        .map((u) => u.props.children),
    ).toEqual(['15', '20']);
    expect(within(atIbkr!).getByText('€1,201.00')).toBeOnTheScreen(); // cost basis after

    const ledgerReads = data.ledger.mock.calls.length;
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText(/Saved: Buy VWCE/)).toBeOnTheScreen();
    expect(data.insertTransaction).toHaveBeenCalledTimes(1);
    const row = data.insertTransaction.mock.calls[0]![0] as Transaction;
    expect(row).toMatchObject({
      type: 'buy',
      accountId: 'ibkr',
      assetId: 'vwce',
      tradeDate: today,
      currency: 'EUR',
      amount: null,
      withholdingTax: null,
    });
    expect([row.quantity?.toString(), row.unitPrice?.toString(), row.fees.toString()]).toEqual([
      '5',
      '120',
      '1',
    ]);
    expect(row.fxRateToEur.toString()).toBe('1');
    expect(data.ledger.mock.calls.length).toBeGreaterThan(ledgerReads);

    // The form starts again with a new id; the dashboard counts the new units.
    expect(screen.getByText('Review')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Dashboard'));
    // was €6,590.82; + 5 VWCE at €150
    expect((await screen.findAllByText('€7,340.82')).length).toBeGreaterThan(0);
  });

  it('a sell shows the realized gain of this sale (FIFO in its broker)', async () => {
    await openNew();
    await fireEvent.press(screen.getByLabelText('Type Sell'));
    await fireEvent.press(screen.getByLabelText('Pick VWCE'));
    await type('Quantity', '2');
    await type('Total value (€)', '300');
    await fireEvent.press(review());
    // Degiro's lot cost 100 a unit: 300 - 200
    expect(screen.getByText('Realized gain of this sale')).toBeOnTheScreen();
    expect(screen.getByText('+€100.00')).toBeOnTheScreen();
  });

  it('Save is disabled while saving, and a double tap inserts one row', async () => {
    const { data } = await openNew();
    const pending = deferred();
    data.insertTransaction.mockImplementationOnce(() => pending.promise);
    await fillBuy('VWCE', { quantity: '1', total: '150' });
    await fireEvent.press(review());

    const save = screen.getByText('Save');
    await fireEvent.press(save);
    expect(screen.getByLabelText('Saving')).toBeOnTheScreen(); // spinner instead of the label
    expect(screen.getByLabelText('Saving')).toBeDisabled();
    expect(screen.getByText('Back')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Saving'));
    await fireEvent.press(screen.getByLabelText('Saving'));
    expect(data.insertTransaction).toHaveBeenCalledTimes(1);

    pending.resolve();
    expect(await screen.findByText(/Saved: Buy VWCE/)).toBeOnTheScreen();
    expect(data.insertTransaction).toHaveBeenCalledTimes(1);
  });

  it('a retry after a lost response reuses the id, so the row is never duplicated', async () => {
    const { data } = await openNew();
    // The insert lands, but the answer never arrives (timeout).
    data.insertTransaction.mockImplementationOnce(async (row) => {
      await data.insertTransaction.getMockImplementation()!(row);
      throw Object.assign(new Error('timeout'), { name: 'FetchError' });
    });
    await fillBuy('VWCE', { quantity: '1', total: '150' });
    await fireEvent.press(review());
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText(/Not saved \(FetchError\)/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText(/Saved: Buy VWCE/)).toBeOnTheScreen();
    const [first, second] = data.insertTransaction.mock.calls.map((c) => (c[0] as Transaction).id);
    expect(first).toBe(second);
    expect(data.rows().filter((t) => t.id === first)).toHaveLength(1);
  });
});

describe('Add asset', () => {
  it('checks the ISIN and the listing currency, then saves it "price pending" and selects it', async () => {
    const { data } = await openNew();
    await fireEvent.press(screen.getByText('Add asset'));
    await type('Name', 'NVIDIA');
    await type('Ticker', 'NVDA');
    await type('ISIN', 'US67066G1041'); // wrong check digit
    expect(screen.getByText(/The check digit does not match/)).toBeOnTheScreen();
    await type('ISIN', 'US67066G1040');
    await fireEvent.press(screen.getByText('Nasdaq (XNAS)'));
    expect(screen.getByLabelText('Listing currency')).toHaveDisplayValue('USD'); // from the exchange
    await type('Listing currency', 'EUR');
    expect(screen.getByText(/Must be USD/)).toBeOnTheScreen();
    expect(screen.getByText('Save asset')).toBeDisabled();
    await type('Listing currency', 'USD');

    await fireEvent.press(screen.getByText('Save asset'));
    await screen.findByText('Change');
    expect(data.insertAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'NVIDIA',
        ticker: 'NVDA',
        isin: 'US67066G1040',
        exchange: 'XNAS',
        tradingCurrency: 'USD',
        assetType: 'stock',
      }),
    );
    expect(screen.getByText('price pending')).toBeOnTheScreen();
    expect(screen.getByText('NVIDIA · US67066G1040')).toBeOnTheScreen();
  });
});

describe('Activity', () => {
  async function openActivity(settings: { hideValues?: boolean } = {}) {
    const app = await openApp(settings);
    await fireEvent.press(screen.getByText('Activity'));
    await screen.findAllByTestId('activity-row');
    return app;
  }
  const listed = () =>
    screen.getAllByTestId('activity-row').map((r) => r.props.accessibilityLabel as string);

  it('lists every row newest first, by month, and filters by type, broker, asset and date', async () => {
    await openActivity();
    expect(listed()).toEqual([
      'Fee Cash 2025-07-01',
      'Dividend VWCE 2025-06-20',
      'Sell MSFT 2025-06-02',
      'Buy BTC 2025-05-02',
      'Buy VWCE 2025-04-01',
      'Buy AAPL 2025-03-03',
      'Buy MSFT 2025-02-03',
      'Subscription Certificados de Aforro E 2025-01-15',
      'Buy VWCE 2025-01-02',
    ]);
    expect(screen.getByText('Jun 2025')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Filter'));
    await fireEvent.press(screen.getByLabelText('Type: Buy'));
    await fireEvent.press(screen.getByLabelText('Broker: IBKR'));
    expect(listed()).toEqual(['Buy VWCE 2025-04-01', 'Buy AAPL 2025-03-03', 'Buy MSFT 2025-02-03']);
    expect(screen.getByText('Filter (2)')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Pick VWCE'));
    expect(listed()).toEqual(['Buy VWCE 2025-04-01']);
    await fireEvent.press(screen.getByText('Clear filters'));

    await fireEvent.press(screen.getByText('From – to'));
    await type('From', '2025-03-01');
    await type('To', '2025-05-31');
    expect(listed()).toEqual(['Buy BTC 2025-05-02', 'Buy VWCE 2025-04-01', 'Buy AAPL 2025-03-03']);
  });

  it('delete is refused when a later sale needs the units, naming that sale', async () => {
    const { data } = await openActivity();
    await fireEvent.press(screen.getByLabelText('Buy MSFT 2025-02-03'));
    await fireEvent.press(await screen.findByText('Delete'));
    expect(screen.getByText('Delete this row?')).toBeOnTheScreen();
    expect(screen.getByText(/It cannot be deleted: the sale of/)).toBeOnTheScreen();
    expect(screen.getByText(/at IBKR on 2 Jun 2025 would have only/)).toBeOnTheScreen();
    const confirm = screen.getAllByText('Delete').at(-1)!;
    expect(confirm).toBeDisabled();
    await fireEvent.press(confirm);
    expect(data.deleteTransaction).not.toHaveBeenCalled();
  });

  it('delete asks first, then the row leaves the list and every figure', async () => {
    const { data } = await openActivity();
    await fireEvent.press(screen.getByLabelText('Dividend VWCE 2025-06-20'));
    await fireEvent.press(await screen.findByText('Delete'));
    expect(screen.getByText('Dividend · VWCE · Degiro · 20 Jun 2025')).toBeOnTheScreen();
    expect(data.deleteTransaction).not.toHaveBeenCalled(); // only after the confirmation
    await fireEvent.press(screen.getAllByText('Delete').at(-1)!);
    await waitFor(() => expect(data.deleteTransaction).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(screen.queryByLabelText('Dividend VWCE 2025-06-20')).toBeNull());
    expect(data.rows().some((t) => t.id === 'd1')).toBe(false);
  });

  it('edit uses the same form, prefilled, and updates the same row', async () => {
    const { data } = await openActivity();
    await fireEvent.press(screen.getByLabelText('Buy VWCE 2025-04-01'));
    await fireEvent.press(await screen.findByText('Edit'));
    expect(await screen.findByText('Edit Buy')).toBeOnTheScreen();
    expect(screen.getByLabelText('Quantity')).toHaveDisplayValue('5');
    expect(screen.getByLabelText('Total value (€)')).toHaveDisplayValue('600');
    expect(screen.getByLabelText('Date')).toHaveDisplayValue('2025-04-01');
    await type('Quantity', '6');
    await type('Total value (€)', '720');
    await fireEvent.press(screen.getByText('Review'));
    expect(screen.getByText('Check the change')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(data.updateTransaction).toHaveBeenCalledTimes(1));
    const row = data.updateTransaction.mock.calls[0]![0] as Transaction;
    expect([row.id, row.quantity?.toString(), row.unitPrice?.toString()]).toEqual([
      'v2',
      '6',
      '120',
    ]);
    expect(data.insertTransaction).not.toHaveBeenCalled();
    // back on the detail, which shows the new quantity
    await waitFor(() => expect(screen.queryByText('Edit Buy')).toBeNull());
    expect(screen.getByText('Edit')).toBeOnTheScreen();
    expect(screen.getAllByText('6').length).toBeGreaterThan(0);
  });

  it('rows the form cannot show exactly (here USD at fx 0.9) can be deleted, not edited', async () => {
    await openActivity();
    await fireEvent.press(screen.getByLabelText('Buy AAPL 2025-03-03'));
    expect(await screen.findByText(/not edited in the app/)).toBeOnTheScreen();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.getByText('Delete')).toBeOnTheScreen();
  });

  it('an edit that would leave a later sale uncovered is refused, naming it', async () => {
    // Degiro sells 8 VWCE today; its 10 were bought on 2 Jan 2025.
    const fixture = portfolioLedger(today);
    fixture.ledger.transactions.push({
      ...fixture.ledger.transactions[0]!,
      id: 'later-sale',
      type: 'sell',
      tradeDate: today,
      quantity: dec('8'),
      unitPrice: dec('150'),
    });
    const { auth } = fakeAuth({ level: 'aal2' });
    await render(<AppRoot services={fakeServices({ auth, data: fakeData(fixture) })} />);
    await screen.findByText('Total value');
    await fireEvent.press(screen.getByText('Activity'));
    await fireEvent.press(await screen.findByLabelText('Buy VWCE 2025-01-02'));
    await fireEvent.press(await screen.findByText('Edit'));
    await type('Quantity', '5');
    await type('Total value (€)', '500');
    expect(
      screen.getByText(new RegExp(`at Degiro on ${formatDate(today)} with only`)),
    ).toBeOnTheScreen();
    expect(screen.getByText('Review')).toBeDisabled();
    await type('Quantity', '8');
    expect(screen.getByText('Review')).toBeEnabled();
  });
});

describe('hide values in the new screens', () => {
  const expectMasked = () => {
    const figures = [...screen.queryAllByTestId('money'), ...screen.queryAllByTestId('units')];
    expect(figures.length).toBeGreaterThan(0);
    for (const f of figures) expect(f).toHaveTextContent(MASK);
    expect(screen.queryByText(/[€$]\s?\d/)).toBeNull();
  };

  it('the sell form, the confirm screen and Activity', async () => {
    await openNew({ hideValues: true });
    await fireEvent.press(screen.getByLabelText('Type Sell'));
    await fireEvent.press(screen.getByLabelText('Pick VWCE'));
    await type('Quantity', '1');
    await type('Total value (€)', '150');
    expectMasked();
    await fireEvent.press(review());
    expectMasked();
    await fireEvent.press(screen.getByText('Activity'));
    await screen.findAllByTestId('activity-row');
    expectMasked();
  });
});
