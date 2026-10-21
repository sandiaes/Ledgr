import { describe, expect, it } from 'vitest';
import { readHoldings } from './inputs';
import { reconcile } from './reconcile';
import { utf8 } from './test/fixtures';
import { plan } from './test/plan-helper';

describe('reconciliation of the base fixture', () => {
  const sheet = readHoldings(
    utf8('ticker,units\nSXR8,23.75\nBTCEUR,0.29\nE,59000\nXYZ,1\n'),
  ).records;
  const rec = reconcile(plan(), '2026-10-01', sheet);
  const pos = (account: string, ticker: string) =>
    rec.positions.find((p) => p.account === account && p.ticker === ticker)!;

  it('per (broker, ticker): units and net invested (units x price), next to the Excel values', () => {
    expect(pos('Kraken', 'BTCEUR')).toMatchObject({ assetType: 'crypto' });
    expect(pos('Kraken', 'BTCEUR').units.toString()).toBe('0.2949738258');
    expect(pos('Kraken', 'BTCEUR').netInvestedEur.toString()).toBe('26519.545142266155');
    expect(pos('Kraken', 'BTCEUR').excelOrderValueEur.toString()).toBe('26519.56');
    // SXR8 is held at two brokers.
    expect(pos('IBKR', 'SXR8').units.toString()).toBe('21');
    expect(pos('Degiro', 'SXR8').units.toString()).toBe('2.75');
    // A closed position stays listed with what it cost net.
    expect(pos('Degiro', 'GME').units.toString()).toBe('0');
    expect(pos('Degiro', 'GME').netInvestedEur.toString()).toBe('12010.1235');
    expect(pos('Aforro', 'E').units.toString()).toBe('59000');
    expect(rec.positions).toHaveLength(25); // 24 tickers, SXR8 at two brokers
  });

  it('totals per asset type and overall', () => {
    expect(rec.byType.map((t) => [t.assetType, t.netInvestedEur.toString()])).toEqual([
      ['certificado_aforro', '59000'],
      ['crypto', '26519.545142266155'],
      ['etf', '18928.149525'],
      ['stock', '33563.1931'],
    ]);
    expect(rec.totals.netInvestedEur.toString()).toBe('138010.887767266155');
    expect(rec.totals.excelOrderValueEur.toString()).toBe('138010.92');
  });

  it('CA value per subscription = units x factor, computed by @ledgr/core', () => {
    expect(
      rec.ca.map((c) => [
        c.month,
        c.units.toString(),
        c.factor.toString(),
        c.valueEur.toString(),
        c.source,
      ]),
    ).toEqual([
      ['2023-01-01', '36000', '1.10482', '39773.52', 'factor'],
      ['2023-03-01', '14000', '1.09754', '15365.56', 'factor'],
      ['2023-05-01', '9000', '1.08988', '9808.92', 'factor'],
    ]);
    expect(rec.totals.caValueEur.toString()).toBe('64948');
  });

  it("diffs total units per ticker against the spreadsheet's holdings", () => {
    const by = new Map(rec.holdingsDiff!.map((h) => [h.ticker, h]));
    expect(by.get('SXR8')!.status).toBe('match');
    expect(by.get('E')!.status).toBe('match');
    expect(by.get('BTCEUR')).toMatchObject({ status: 'different' });
    expect(by.get('BTCEUR')!.difference!.toString()).toBe('0.0049738258');
    expect(by.get('VWCE')!.status).toBe('missing in sheet');
    expect(by.get('XYZ')!.status).toBe('missing in ledger');
    expect(by.has('GME')).toBe(false); // closed in the ledger, absent from the sheet
  });
});
