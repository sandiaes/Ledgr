import { describe, expect, it } from 'vitest';
import { CsvFormatError, decodeBytes, parseCsv } from './csv';
import { DateFormatError } from './dates';
import { readCa, readTransactions, type CaRecord, type TxRecord } from './inputs';
import { NumberFormatError, parseNumber } from './numbers';
import { encode1252, fixtureText, utf8, variant, type VariantSpec } from './test/fixtures';

const TX = fixtureText('sample_transactions.csv');
const CA = fixtureText('sample_ca.csv');
const TX_NUM = ['Units', 'Order Price', 'Order Value'];
const CA_NUM = ['Units', 'Ratio'];

const plainTx = (r: TxRecord) => ({
  ...r,
  units: [r.units.value.toString(), r.units.decimals],
  price: [r.price.value.toString(), r.price.decimals],
  value: [r.value.value.toString(), r.value.decimals],
  cells: undefined,
});
const plainCa = (r: CaRecord) => ({
  ...r,
  units: [r.units.value.toString(), r.units.decimals],
  ratio: [r.ratio.value.toString(), r.ratio.decimals],
  cells: undefined,
});

describe('base fixtures', () => {
  it('parse every row with comma, dot decimals and ISO dates', () => {
    const tx = readTransactions(utf8(TX));
    expect(tx.records).toHaveLength(140);
    expect(tx.problems).toEqual([]);
    expect(tx.settings).toMatchObject({
      encoding: 'utf-8',
      bom: false,
      delimiter: 'comma',
      decimal: '.',
      dateStyles: ['ISO'],
    });
    expect(plainTx(tx.records[0]!)).toMatchObject({
      line: 2,
      month: '2021-01-01',
      type: 'Stocks',
      transactType: 'Buy',
      ticker: 'GME',
      units: ['60', 0],
      price: ['169.1955', 4],
      value: ['10151.73', 2],
      broker: 'Degiro',
    });
    const ca = readCa(utf8(CA));
    expect(ca.records.map(plainCa)).toMatchObject([
      { series: 'E', month: '2023-01-01', units: ['36000', 0], ratio: ['1.10482', 5] },
      { series: 'E', month: '2023-03-01', units: ['14000', 0], ratio: ['1.09754', 5] },
      { series: 'E', month: '2023-05-01', units: ['9000', 0], ratio: ['1.08988', 5] },
    ]);
  });
});

describe('regional variants parse to exactly the base records', () => {
  const base = readTransactions(utf8(TX)).records.map(plainTx);
  const variants: [string, VariantSpec][] = [
    [
      'semicolon, decimal comma, dd/mm/yyyy, CRLF',
      { delimiter: ';', numbers: { decimal: ',' }, date: 'dd/mm/yyyy', eol: '\r\n' },
    ],
    [
      'comma delimiter with quoted decimal commas, dd-mm-yyyy',
      { delimiter: ',', numbers: { decimal: ',' }, date: 'dd-mm-yyyy' },
    ],
    [
      'Portuguese month abbreviations (jan-21, fev-21, ...)',
      { delimiter: ',', numbers: { decimal: '.' }, date: 'pt-abbr' },
    ],
    [
      'English month abbreviations (Jan-21), re-cased and spaced headers',
      {
        delimiter: ',',
        numbers: { decimal: '.' },
        date: 'en-abbr',
        header: (h) => `  ${h.toUpperCase().replace(' ', '   ')} `,
      },
    ],
    [
      'accented headers',
      {
        delimiter: ';',
        numbers: { decimal: ',' },
        date: 'dd/mm/yyyy',
        header: (h) => h.replace('Order', 'Ordér').replace('Month', 'Mônth'),
      },
    ],
    [
      'full Portuguese months (março 2021), Windows-1252, dot thousands, euro sign',
      {
        delimiter: ';',
        numbers: { decimal: ',', thousands: '.', euro: true },
        date: 'pt-full',
        encoding: 'windows-1252',
      },
    ],
    [
      '"1 de março de 2021", Windows-1252',
      { delimiter: ';', numbers: { decimal: ',' }, date: 'pt-long-day', encoding: 'windows-1252' },
    ],
    [
      'UTF-8 BOM, tab delimiter, d/m/yy',
      { delimiter: '\t', numbers: { decimal: '.' }, date: 'd/m/yy', bom: true },
    ],
    [
      'comma thousands with dot decimals (quoted)',
      { delimiter: ',', numbers: { decimal: '.', thousands: ',' }, date: null },
    ],
    [
      'space thousands with decimal comma',
      { delimiter: ';', numbers: { decimal: ',', thousands: ' ' }, date: 'dd/mm/yyyy' },
    ],
    [
      'non-breaking space thousands',
      {
        delimiter: ';',
        numbers: { decimal: ',', thousands: '\u00a0' },
        date: 'dd/mm/yyyy',
        bom: true,
      },
    ],
    [
      'negatives in parentheses',
      { delimiter: ',', numbers: { decimal: '.', parens: true }, date: null },
    ],
    [
      'negatives in parentheses with decimal comma and euro sign',
      { delimiter: ';', numbers: { decimal: ',', parens: true, euro: true }, date: 'dd/mm/yyyy' },
    ],
    [
      'month-first mm/dd/yyyy (detected: every date is the 1st)',
      { delimiter: ',', numbers: { decimal: '.' }, date: 'mm/dd/yyyy' },
    ],
  ];
  it.each(variants)('%s', (_, spec) => {
    const parsed = readTransactions(variant(TX, TX_NUM, ['Month'], spec));
    expect(parsed.problems).toEqual([]);
    expect(parsed.records.map(plainTx)).toEqual(base);
  });

  it('detects and reports the settings of a Portuguese export', () => {
    const s = readTransactions(variant(TX, TX_NUM, ['Month'], variants[5]![1])).settings;
    expect(s).toMatchObject({
      encoding: 'windows-1252',
      bom: false,
      delimiter: 'semicolon',
      decimal: ',',
      dateStyles: ['month name'],
    });
    const m = readTransactions(variant(TX, TX_NUM, ['Month'], variants[13]![1])).settings;
    expect(m.dateOrder).toBe('mdy');
    expect(m.dateOrderReason).toMatch(/1st when read month-first/);
  });

  it('the CA table parses the same in a Portuguese export', () => {
    const baseCa = readCa(utf8(CA)).records.map(plainCa);
    for (const spec of [
      { delimiter: ';', numbers: { decimal: ',' }, date: 'dd/mm/yyyy', bom: true },
      {
        delimiter: ';',
        numbers: { decimal: ',', thousands: '.' },
        date: 'pt-abbr',
        encoding: 'windows-1252',
      },
    ] as VariantSpec[]) {
      expect(readCa(variant(CA, CA_NUM, ['Order Date'], spec)).records.map(plainCa)).toEqual(
        baseCa,
      );
    }
  });
});

describe('ambiguous or broken input fails with a clear error', () => {
  const header = 'Month,Type,Transact Type,Ticker/Type,Units,Order Price,Order Value,Broker';
  const file = (...rows: string[]) => utf8([header, ...rows].join('\n'));

  it('a decimal separator nothing settles', () => {
    const f = file('2021-01-01,Stocks,Buy,X,1,"1,234","1,234",Degiro');
    expect(() => readTransactions(f)).toThrow(
      /cannot tell whether "\." or "," is the decimal separator.*--decimal/,
    );
    expect(readTransactions(f, { decimal: ',' }).records[0]!.price.value.toString()).toBe('1.234');
    expect(readTransactions(f, { decimal: '.' }).records[0]!.price.value.toString()).toBe('1234');
  });

  it('mixed decimal separators, and --decimal contradicted by the data', () => {
    const f = file(
      '2021-01-01,Stocks,Buy,X,1,"1,5","1,5",Degiro',
      '2021-01-01,Stocks,Buy,X,1,2.5,2.5,Degiro',
    );
    expect(() => readTransactions(f)).toThrow(/mixed decimal separators/);
    const g = file('2021-01-01,Stocks,Buy,X,1,2.5,2.5,Degiro');
    expect(() => readTransactions(g, { decimal: ',' })).toThrow(NumberFormatError);
  });

  it('day-first vs month-first that the data cannot decide', () => {
    const f = file('05/06/2021,Stocks,Buy,X,1,1,1,Degiro', '07/08/2021,Stocks,Buy,X,1,1,1,Degiro');
    expect(() => readTransactions(f)).toThrow(
      /cannot tell day-first from month-first.*--date-format/,
    );
    expect(readTransactions(f, { dateOrder: 'dmy' }).records.map((r) => r.month)).toEqual([
      '2021-06-01',
      '2021-08-01',
    ]);
    expect(readTransactions(f, { dateOrder: 'mdy' }).records.map((r) => r.month)).toEqual([
      '2021-05-01',
      '2021-07-01',
    ]);
  });

  it('dates that are valid in neither order', () => {
    const f = file('13/01/2021,Stocks,Buy,X,1,1,1,Degiro', '01/13/2021,Stocks,Buy,X,1,1,1,Degiro');
    expect(() => readTransactions(f)).toThrow(DateFormatError);
  });

  it('a header that is not there with any delimiter, or a missing column', () => {
    expect(() => readTransactions(utf8(header.replace(/,/g, '|') + '\n'))).toThrow(
      /expected header.*--delimiter/,
    );
    expect(() => readTransactions(utf8('Month,Type,Units\n'))).toThrow(CsvFormatError);
  });

  it('UTF-16 files are refused with advice', () => {
    expect(() => decodeBytes(Uint8Array.from([0xff, 0xfe, 0x4d, 0x00]))).toThrow(/UTF-16/);
  });

  it('bad cells become row problems, not guesses', () => {
    const parsed = readTransactions(
      file(
        '2021-01-01,Stocks,Buy,X,1,$5,5,Degiro',
        'someday,Stocks,Buy,X,1,5,5,Degiro',
        '2021-01-01,Stocks,Buy,X,,5,5,Degiro',
      ),
    );
    expect(parsed.records).toEqual([]);
    expect(parsed.problems.map((p) => [p.line, p.reasons])).toEqual([
      [2, ['Order Price has a non-euro currency symbol']],
      [3, ['Month is not a date in a known format']],
      [4, ['Units is blank']],
    ]);
  });

  it('number edge cases', () => {
    expect(parseNumber('(1.234,50 €)', ',')!.value.toString()).toBe('-1234.5');
    expect(parseNumber('−3,5', ',')!.value.toString()).toBe('-3.5');
    expect(parseNumber('0,0287629758', ',')!.decimals).toBe(10);
    expect(() => parseNumber('1.23,5', ',')).toThrow(/thousands/);
    expect(() => parseNumber('1,2,3', ',')).toThrow(/more than one/);
    expect(() => parseNumber('12abc', '.')).toThrow(/not a number/);
  });

  it('Windows-1252 bytes are decoded, the BOM is stripped from the first header', () => {
    expect(decodeBytes(encode1252('Mês;€')).text).toBe('Mês;€');
    const bom = readTransactions(utf8('\uFEFF' + TX));
    expect(bom.settings.bom).toBe(true);
    expect(bom.settings.headers.month).toBe('Month');
  });

  it('quoted cells may contain delimiters, quotes and newlines', () => {
    expect(parseCsv('a,"b,""c""\nd",e\r\n1,2,3', ',').map((r) => [r.line, r.cells])).toEqual([
      [1, ['a', 'b,"c"\nd', 'e']],
      [3, ['1', '2', '3']],
    ]);
  });
});
