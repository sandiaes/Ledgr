import { describe, expect, it } from 'vitest';
import { HistoryFileError, parseHistory } from './history';

describe('parseHistory', () => {
  it('reads a table copied from a price-history page (tabs, US dates, thousands commas)', () => {
    const text = [
      'Date\tOpen\tHigh\tLow\tClose Close price adjusted for splits.\tAdj Close Adjusted close price adjusted for splits and dividend and/or capital gain distributions.\tVolume',
      'Oct 21, 2026\t1,071.20\t1,075.00\t1,070.10\t1,072.48\t1,072.48\t12,345',
      'Oct 20, 2026\t570.10\t572.00\t569.00\t571.20\t571.20\t9,876',
      'Jun 10, 2025\t0.30 Dividend',
      'Oct 17, 2026\t-\t-\t-\t-\t-\t-',
      '',
    ].join('\r\n');
    expect(parseHistory(text)).toEqual({
      rows: [
        { date: '2026-10-20', close: '571.2' },
        { date: '2026-10-21', close: '1072.48' },
      ],
      skipped: 2,
    });
  });

  it('reads a CSV with ISO dates, and a semicolon file with decimal commas', () => {
    expect(parseHistory('date,close\n2024-01-02,478.00\n2024-01-03,476.12\n').rows).toEqual([
      { date: '2024-01-02', close: '478' },
      { date: '2024-01-03', close: '476.12' },
    ]);
    expect(parseHistory('Date;Close\n2024-01-02;1.478,50\n').rows).toEqual([
      { date: '2024-01-02', close: '1478.5' },
    ]);
  });

  it('reads an Investing.com-style export: Price column, quoted cells, month/day dates', () => {
    const text = [
      '\uFEFF"Date","Price","Open","High","Low","Vol.","Change %"',
      '"10/22/2026","1,072.48","1,070.00","1,075.00","1,069.00","77.27K","-0.91%"',
      '"10/21/2026","745.02","743.36","745.02","741.06","74.15K","0.50%"',
      '"01/02/2020","287.68","287.52","289.19","287.01","25.89K","-0.05%"',
    ].join('\n');
    expect(parseHistory(text)).toEqual({
      rows: [
        { date: '2020-01-02', close: '287.68' },
        { date: '2026-10-21', close: '745.02' },
        { date: '2026-10-22', close: '1072.48' },
      ],
      skipped: 0,
    });
  });

  it('reads day/month slash dates when the file proves it, and refuses when it cannot tell', () => {
    expect(
      parseHistory('Date,Close\n22/10/2026,1\n02/01/2020,2\n').rows.map((r) => r.date),
    ).toEqual(['2020-01-02', '2026-10-22']);
    expect(() => parseHistory('Date,Close\n02/01/2020,2\n03/01/2020,3\n')).toThrow(
      /cannot be told apart/,
    );
  });

  it('uses Close, never Adj Close', () => {
    const rows = parseHistory('Date,Adj Close,Close\n2024-01-02,90,100\n').rows;
    expect(rows[0]?.close).toBe('100');
  });

  it('rejects what it cannot read instead of guessing', () => {
    expect(() => parseHistory('Date,Close\n2024/01/02,100\n')).toThrow(/is not like/);
    expect(() => parseHistory('Date,Close\nFeb 30, 2024,100\n')).toThrow(HistoryFileError);
    expect(() => parseHistory('Day,Price\n2024-01-02,100\n')).toThrow(/"Date" and a "Close"/);
    expect(() => parseHistory('Date,Close\n2024-01-02,100\n2024-01-02,101\n')).toThrow(/twice/);
    expect(() => parseHistory('Date,Close\n2024-01-02,-\n')).toThrow(/no row/);
  });
});
