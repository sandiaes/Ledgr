import { addMonths, dec, localDate, type Transaction } from '@ledgr/core';
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
const SWITCH = 'Include certificados de aforro';
const START = 'Starting value (€)';
const CONTRIBUTION = 'Monthly contribution (€)';
const RETURN = 'Expected annual return (%)';
const YEARS = 'Years';
const INFLATION = 'Annual inflation (%)';

const tx = (
  type: 'buy' | 'sell' | 'subscription',
  id: string,
  date: string,
  accountId: string,
  assetId: string,
  qty: string,
  price: string,
): Transaction => ({
  id,
  accountId,
  assetId,
  type,
  tradeDate: date,
  quantity: dec(qty),
  unitPrice: dec(price),
  amount: null,
  fees: dec('0'),
  currency: 'EUR',
  fxRateToEur: dec('1'),
});

/**
 * By hand (EUR). VWCE: 10 bought 14 months ago, 6 bought 3 months ago, 1 sold 2 months ago
 * (15 held, quote 150 -> 2,250). Certificados: 1,000 units subscribed 14 months ago at factor
 * 1.10482 (1,104.82) and 1,200 units a month ago at factor 1.01 (1,212.00).
 *   Value 4,566.82; without certificados 2,250.00.
 *   Net purchases of the last 12 months: 600 - 120 + 1,200 = 1,680 -> 140.00 a month;
 *   without certificados 480 -> 40.00 a month.
 */
function fixture() {
  const base = portfolioLedger(today);
  const factorMonth = `${addMonths(today, -1).slice(0, 7)}-01`;
  base.ledger.transactions = [
    tx('buy', 'v0', addMonths(today, -14), 'degiro', 'vwce', '10', '100'),
    tx('subscription', 'ca-sub', addMonths(today, -14), 'aforronet', 'ca', '1000', '1'),
    tx('buy', 'v1', addMonths(today, -3), 'degiro', 'vwce', '6', '100'),
    tx('sell', 'v2', addMonths(today, -2), 'degiro', 'vwce', '1', '120'),
    tx('subscription', 'ca-sub2', addMonths(today, -1), 'aforronet', 'ca', '1200', '1'),
  ];
  base.ledger.ca = {
    subscriptions: [
      { id: 's1', seriesId: 'E', transactionId: 'ca-sub' },
      { id: 's2', seriesId: 'E', transactionId: 'ca-sub2' },
    ],
    series: base.ledger.ca.series,
    factors: [
      { subscriptionId: 's1', month: factorMonth, factor: dec('1.10482') },
      { subscriptionId: 's2', month: factorMonth, factor: dec('1.01') },
    ],
  };
  return base;
}

async function openCalculator(
  base: ReturnType<typeof portfolioLedger> = fixture(),
  settings: { hideValues?: boolean; includeCertificados?: boolean } = {},
) {
  const data = fakeData(base);
  const { auth } = fakeAuth({ level: 'aal2' });
  const services = fakeServices({ auth, data, settings });
  await render(<AppRoot services={services} />);
  await screen.findByText(/^as of /);
  await fireEvent.press(screen.getByLabelText('Calculator'));
  await screen.findByLabelText(START);
  return { data, services };
}

const field = (label: string) => screen.getByLabelText(label);
const value = (label: string) => field(label).props.value as string;
const type = (label: string, text: string) => fireEvent.changeText(field(label), text);
const setSwitch = (on: boolean) =>
  fireEvent(screen.getAllByLabelText(SWITCH).at(-1) as never, 'valueChange', on);

describe('Return calculator', () => {
  it('is the Calculator tab and starts from the value now, the XIRR since start and the average purchases', async () => {
    await openCalculator();
    expect(value(START)).toBe('4566.82');
    expect(value(CONTRIBUTION)).toBe('140.00');
    expect(value(YEARS)).toBe('10');
    expect(value('Extra months')).toBe('0');
    expect(value(INFLATION)).toBe('0');
    expect(value(RETURN)).toMatch(/^-?\d+\.\d{2}$/);
    // Which number was used, and over what period.
    const source = screen.getByTestId('return-source');
    expect(source).toHaveTextContent(
      /^XIRR since start: −?\d+,\d{2}% a year, from .* to .* \(\d+ days\)\.$/,
    );
    expect(
      screen.getByText(
        /Average net purchases \(buys minus sells\) per month over the last 12 months/,
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(/not a forecast/)).toBeOnTheScreen();
    expect(screen.getByText('Reset to my values')).toBeOnTheScreen();
    // The three sources are offered.
    expect(screen.getByText('XIRR')).toBeOnTheScreen();
    expect(screen.getByText('TWR (annualized)')).toBeOnTheScreen();
    expect(screen.getByText('Custom')).toBeOnTheScreen();
  });

  it('computes the projection: 10,000 at 7% for 10 years is 19,671.51', async () => {
    await openCalculator();
    await type(START, '10000');
    await type(RETURN, '7');
    await type(CONTRIBUTION, '0');
    expect(screen.getAllByText('19.671,51\u00A0€').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+9.671,51\u00A0€').length).toBeGreaterThan(0);
    expect(screen.getByText('49,17%')).toBeOnTheScreen();
    expect(screen.getByText('Total contributed')).toBeOnTheScreen();
    expect(screen.queryByText("Ending value in today's money")).toBeNull();
    const rows = screen.getAllByTestId('projection-row');
    expect(rows).toHaveLength(10);
    expect(within(rows[0] as never).getByText('After 1 year')).toBeOnTheScreen();
    expect(within(rows[0] as never).getByText('10.700,00\u00A0€')).toBeOnTheScreen();
    expect(within(rows[1] as never).getByText('11.449,00\u00A0€')).toBeOnTheScreen();
    expect(screen.getByTestId('growth-chart')).toBeOnTheScreen();
  });

  it('a zero rate, a negative rate, inflation and a part year', async () => {
    await openCalculator();
    await type(START, '1000');
    await type(YEARS, '1');
    await type(RETURN, '0');
    await type(CONTRIBUTION, '100');
    expect(screen.getAllByText('2.200,00\u00A0€').length).toBeGreaterThan(1); // ending, contributed
    expect(screen.getByText('0,00%')).toBeOnTheScreen();

    await type(CONTRIBUTION, '0');
    await type(YEARS, '2');
    await type(RETURN, '-10');
    expect(screen.getAllByText('810,00\u00A0€').length).toBeGreaterThan(0);
    expect(screen.getAllByText('−190,00\u00A0€').length).toBeGreaterThan(0);
    expect(screen.getByText('−23,46%')).toBeOnTheScreen();

    await type(RETURN, '0');
    await type(INFLATION, '10');
    expect(screen.getByText("Ending value in today's money")).toBeOnTheScreen();
    expect(screen.getByText('826,45\u00A0€')).toBeOnTheScreen(); // 1,000 / 1.1^2

    await type(YEARS, '1');
    await type('Extra months', '6');
    const rows = screen.getAllByTestId('projection-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1] as never).getByText('After 1 year 6 months')).toBeOnTheScreen();
  });

  it('start of month: the same inputs end 100 x 12% = 12 higher (100 a month, 12% a year)', async () => {
    await openCalculator();
    await type(START, '0');
    await type(YEARS, '1');
    await type(RETURN, '12');
    await type(CONTRIBUTION, '100');
    const ending = () => within(screen.getByTestId('projection-result')).getAllByTestId('money')[0];
    expect(ending()).toHaveTextContent('1.264,65\u00A0€'); // 100 x 0.12 / (1.12^(1/12) - 1)
    await fireEvent.press(screen.getByText('Start of month'));
    expect(ending()).toHaveTextContent('1.276,65\u00A0€');
    await fireEvent.press(screen.getByText('End of month'));
    expect(ending()).toHaveTextContent('1.264,65\u00A0€');
  });

  it('turning certificados off updates the defaults of the fields that were not edited', async () => {
    await openCalculator();
    const xirrWith = value(RETURN);
    await setSwitch(false);
    expect(screen.getAllByTestId('scope-note').length).toBeGreaterThan(0);
    expect(value(START)).toBe('2250.00');
    expect(value(CONTRIBUTION)).toBe('40.00');
    expect(value(RETURN)).not.toBe(xirrWith);
    expect(screen.getByTestId('return-source')).toHaveTextContent(/^XIRR since start/);
    await setSwitch(true);
    expect(value(START)).toBe('4566.82');
    expect(value(CONTRIBUTION)).toBe('140.00');
    expect(value(RETURN)).toBe(xirrWith);
  });

  it('keeps what was typed when the toggle changes, and updates the rest', async () => {
    await openCalculator();
    const xirrWith = value(RETURN);
    await type(CONTRIBUTION, '500');
    await type(YEARS, '5');
    await setSwitch(false);
    expect(value(CONTRIBUTION)).toBe('500'); // edited: kept
    expect(value(YEARS)).toBe('5'); // edited: kept
    expect(value(START)).toBe('2250.00'); // not edited: follows the scope
    expect(value(RETURN)).not.toBe(xirrWith);

    // An edited return is kept too.
    await type(RETURN, '4.5');
    await setSwitch(true);
    expect(value(RETURN)).toBe('4.5');
    expect(value(START)).toBe('4566.82');
    expect(value(CONTRIBUTION)).toBe('500');
  });

  it('"Reset to my values" brings every default back for the current scope', async () => {
    const { services } = await openCalculator();
    await setSwitch(false);
    await type(START, '1234');
    await type(CONTRIBUTION, '9');
    await type(RETURN, '4.5');
    await type(YEARS, '3');
    await type(INFLATION, '2');
    await fireEvent.press(screen.getByText('Start of month'));
    await fireEvent.press(screen.getByText('Reset to my values'));
    expect(value(START)).toBe('2250.00');
    expect(value(CONTRIBUTION)).toBe('40.00');
    expect(value(YEARS)).toBe('10');
    expect(value(INFLATION)).toBe('0');
    expect(value(RETURN)).not.toBe('4.5');
    expect(screen.getByTestId('return-source')).toHaveTextContent(/^XIRR since start/);
    // The inputs are not stored: only the scope switch was ever saved.
    for (const [saved] of (services.settings.save as jest.Mock).mock.calls)
      expect(Object.keys(saved).sort()).toEqual(
        expect.arrayContaining(['includeCertificados', 'hideValues']),
      );
    expect(JSON.stringify((services.settings.save as jest.Mock).mock.calls)).not.toMatch(/1234/);
  });

  it('lets the return come from the TWR or a custom figure', async () => {
    await openCalculator();
    await fireEvent.press(screen.getByText('TWR (annualized)'));
    expect(screen.getByTestId('return-source')).toHaveTextContent(/^TWR since start, annualized: /);
    const twr = value(RETURN);
    await fireEvent.press(screen.getByText('Custom'));
    expect(value(RETURN)).toBe(twr);
    expect(screen.getByTestId('return-source')).toHaveTextContent('Your own figure.');
    await type(RETURN, '6');
    await fireEvent.press(screen.getByText('XIRR'));
    expect(screen.getByTestId('return-source')).toHaveTextContent(/^XIRR since start/);
    expect(value(RETURN)).not.toBe('6');
    // Typing over a source switches to custom.
    await type(RETURN, '3');
    expect(screen.getByTestId('return-source')).toHaveTextContent('Your own figure.');
  });

  it('warns when the default return is outside -20% to +30%, not for a custom one', async () => {
    const base = fixture();
    // 500 bought a year ago, worth 1,500 now: about +200% a year.
    base.ledger.transactions = [
      tx('buy', 'w', addMonths(today, -12), 'degiro', 'vwce', '10', '50'),
    ];
    base.ledger.ca = { ...base.ledger.ca, subscriptions: [], factors: [] };
    await openCalculator(base);
    expect(screen.getByTestId('return-warning')).toHaveTextContent(/outside -20% to \+30% a year/);
    await type(RETURN, '200');
    expect(screen.queryByTestId('return-warning')).toBeNull();
  });

  it('with nothing to compute a return from, leaves it empty and asks', async () => {
    const base = fixture();
    base.ledger.transactions = [];
    base.ledger.ca = { ...base.ledger.ca, subscriptions: [], factors: [] };
    await openCalculator(base);
    expect(value(RETURN)).toBe('');
    expect(value(START)).toBe('0.00');
    expect(value(CONTRIBUTION)).toBe('0.00');
    expect(screen.getByTestId('return-source')).toHaveTextContent(/No return could be computed/);
    expect(screen.queryByText('XIRR')).toBeNull();
    expect(screen.getByText('Required.')).toBeOnTheScreen();
    expect(screen.getByText('Fix the fields above to see the projection.')).toBeOnTheScreen();
    await type(RETURN, '5');
    expect(screen.queryByText('Fix the fields above to see the projection.')).toBeNull();
  });

  it('says what is wrong with a field and shows no result until it is fixed', async () => {
    await openCalculator();
    await type(START, 'abc');
    expect(screen.getByText(/^Not a number/)).toBeOnTheScreen();
    expect(screen.getByText('Fix the fields above to see the projection.')).toBeOnTheScreen();
    await type(START, '1000');
    await type(CONTRIBUTION, '-5');
    expect(screen.getByText('Cannot be negative.')).toBeOnTheScreen();
    await type(CONTRIBUTION, '0');
    await type(YEARS, '61');
    expect(screen.getByText('At most 60 years.')).toBeOnTheScreen();
    await type(YEARS, '2.5');
    expect(screen.getByText('A whole number.')).toBeOnTheScreen();
    await type(YEARS, '5');
    await type('Extra months', '12');
    expect(screen.getByText('Between 0 and 11 months.')).toBeOnTheScreen();
    await type('Extra months', '0');
    await type(RETURN, '-60');
    expect(screen.getByText('At least −50% a year.')).toBeOnTheScreen();
    await type(RETURN, '5');
    await type(INFLATION, '-1');
    expect(screen.getByText('Cannot be negative.')).toBeOnTheScreen();
    await type(INFLATION, '2');
    expect(screen.queryByText('Fix the fields above to see the projection.')).toBeNull();
    // 0 is allowed for the contribution and 0 for the years.
    await type(YEARS, '0');
    expect(screen.queryByText('Fix the fields above to see the projection.')).toBeNull();
    expect(screen.queryAllByTestId('projection-row')).toEqual([]);
  });

  it('hide values masks the results, the amount fields and the percentages', async () => {
    await openCalculator(fixture(), { hideValues: true });
    expect(value(START)).toBe(MASK);
    expect(value(CONTRIBUTION)).toBe(MASK);
    expect(field(START).props.editable).toBe(false);
    const amounts = screen.getAllByTestId('money');
    expect(amounts.length).toBeGreaterThan(8); // result lines and the rows
    for (const a of amounts) expect(a).toHaveTextContent(MASK);
    expect(screen.queryByText(AMOUNT_TEXT)).toBeNull();
    expect(screen.getByText('Growth share of ending value')).toBeOnTheScreen();
    // A percentage is masked like an amount (decision D2), in the field and in the note.
    expect(value(RETURN)).toBe(MASK);
    expect(field(RETURN).props.editable).toBe(false);
    expect(screen.getByTestId('return-source')).toHaveTextContent(/^XIRR since start: •••••/);
    expect(screen.queryByText(/\d,\d{2}%/)).toBeNull(); // no figure; the warning range is text
    for (const p of screen.getAllByTestId('pct')) expect(p).toHaveTextContent(MASK);

    await fireEvent.press(screen.getAllByLabelText('Show values').at(-1) as never);
    expect(value(START)).toBe('4566.82');
    expect(screen.queryAllByText(MASK)).toEqual([]);
  });
});
