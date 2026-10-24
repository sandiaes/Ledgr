import { describe, expect, it } from 'vitest';
import * as core from './index';

describe('public API', () => {
  it('exports the calculation entry points', () => {
    for (const name of [
      'Decimal',
      'runFifo',
      'computeHoldings',
      'gainsSummary',
      'netContributions',
      'incomeTotals',
      'incomeByYear',
      'feeSummary',
      'feeDragShare',
      'xirrFeeDrag',
      'xirr',
      'investmentCashFlows',
      'externalCashFlows',
      'twr',
      'allocation',
      'concentration',
      'createRuleBasedCaValuer',
      'defaultCaRateRule',
      'buildSnapshot',
      'createPriceLookup',
      'createFxLookup',
      'createCaFactorLookup',
      'cashBalanceEur',
      'netInvestedEur',
      'splitAdjustPrices',
      'createTradePriceLookup',
      'holdingPeriods',
      'rateToEurFromEcbQuote',
      'sanityReport',
      'withLiveQuotes',
      'accountSummaries',
      'dailyFlows',
      'flowEur',
      'dayChange',
      'periodReturns',
      'valueSeries',
      'monthlyReturns',
      'yearlyReturns',
      'bestWorstMonth',
      'topPositions',
      'topMovers',
      'closedPositions',
      'unitsHeld',
      'maxDisposable',
      'certificadoSubscriptions',
      'localDate',
      'reconcile',
      'buildDashboard',
      'thinSeries',
      'rangeStart',
      'positionDetail',
      'assetTransactions',
      'priceSeries',
      'buildPositions',
      'buildAllocation',
      'buildPerformance',
      'twrSteps',
      'parseDecimalInput',
      'unitPriceFromTotal',
      'validateNewTransaction',
      'validateLedgerChange',
      'previewTransaction',
      'mostUsedAccount',
      'sellableAccounts',
      'validateNewAsset',
      'factorChange',
      'factorUpdateLines',
    ]) {
      expect(core, name).toHaveProperty(name);
    }
  });

  it('uses 50 significant digits, so 0.1 + 0.2 is exactly 0.3', () => {
    expect(new core.Decimal('0.1').plus('0.2').toString()).toBe('0.3');
    expect(new core.Decimal(1).div(3).toString()).toBe('0.' + '3'.repeat(50));
  });
});
