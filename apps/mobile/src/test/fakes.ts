// Test doubles for the services behind the screens. Not part of the app bundle.
import type { AssetRecord } from '@ledgr/client';
import { dec, type StoredPriceRow, type Transaction, type ValueSnapshot } from '@ledgr/core';
import type { DataApi, Ledger, Market, Services } from '../services';
import type { Settings } from '../settings/settings';

/** An unsigned JWT with the given claims (the app reads `aal` locally). */
export function token(claims: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${b64}.sig`;
}

type Listener = (event: string, session: unknown) => void;

/** Supabase auth as the gate uses it: a session at aal1 or aal2, TOTP factors, events. */
export function fakeAuth(init: { signedIn?: boolean; level?: 'aal1' | 'aal2'; factor?: boolean }) {
  const state = {
    signedIn: init.signedIn ?? true,
    level: init.level ?? 'aal1',
    factor: init.factor ?? true,
  };
  const listeners = new Set<Listener>();
  const session = () =>
    state.signedIn ? { access_token: token({ sub: 'owner', aal: state.level }) } : null;
  const emit = (event: string) => listeners.forEach((l) => l(event, session()));
  const auth = {
    getSession: jest.fn(async () => ({ data: { session: session() }, error: null })),
    onAuthStateChange: jest.fn((l: Listener) => {
      listeners.add(l);
      return { data: { subscription: { unsubscribe: () => listeners.delete(l) } } };
    }),
    signInWithPassword: jest.fn(async () => {
      state.signedIn = true;
      state.level = 'aal1';
      emit('SIGNED_IN');
      return { data: {}, error: null };
    }),
    signOut: jest.fn(async () => {
      state.signedIn = false;
      emit('SIGNED_OUT');
      return { error: null };
    }),
    mfa: {
      getAuthenticatorAssuranceLevel: jest.fn(async () => ({
        data: { currentLevel: state.level, nextLevel: state.factor ? 'aal2' : 'aal1' },
        error: null,
      })),
      listFactors: jest.fn(async () => ({
        data: {
          all: state.factor ? [{ id: 'totp-1', factor_type: 'totp', status: 'verified' }] : [],
        },
        error: null,
      })),
      challengeAndVerify: jest.fn(async ({ code }: { code: string }) => {
        if (code !== '123456') return { data: null, error: { code: 'mfa_verification_failed' } };
        state.level = 'aal2';
        emit('MFA_CHALLENGE_VERIFIED');
        return { data: {}, error: null };
      }),
    },
  };
  return { auth, state, emit };
}

const asset = (id: string, ticker: string, name: string): AssetRecord => ({
  id,
  name,
  ticker,
  isin: null,
  exchange: 'XETR',
  assetType: 'etf',
  tradingCurrency: 'EUR',
  priceSource: 'alphavantage',
  priceSourceId: `${ticker}.DEX`,
});

const buy = (
  id: string,
  date: string,
  assetId: string,
  qty: string,
  price: string,
): Transaction => ({
  id,
  accountId: 'degiro',
  assetId,
  type: 'buy',
  tradeDate: date,
  quantity: dec(qty),
  unitPrice: dec(price),
  amount: null,
  fees: dec('0'),
  currency: 'EUR',
  fxRateToEur: dec('1'),
});

/**
 * One ETF bought for €1,234.56 (10 units), worth €1,500.00 at today's quote and €1,450.00
 * yesterday: day change +€50.00 (+3.45%), unrealized +€265.44.
 */
export function sampleLedger(today: string): { ledger: Ledger; market: Market } {
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const y = yesterday.toISOString().slice(0, 10);
  return {
    ledger: {
      transactions: [buy('t1', '2025-01-02', 'vwce', '10', '123.456')],
      assets: [asset('vwce', 'VWCE', 'Vanguard FTSE All-World')],
      accounts: [{ id: 'degiro', name: 'Degiro' }],
      ca: { subscriptions: [], factors: [], series: [] },
    },
    market: {
      prices: [{ assetId: 'vwce', date: y, close: dec('145'), currency: 'EUR', splitFactor: null }],
      fx: [],
      liveQuotes: [{ assetId: 'vwce', date: today, close: dec('150'), currency: 'EUR' }],
    },
  };
}

/**
 * The data layer in memory. Writes change the ledger the next read returns, keyed by id as
 * in the database (a second insert of the same id is a no-op), so the screens can be
 * tested end to end.
 */
export function fakeData(fixture: {
  ledger: Ledger;
  market: Market;
  history?: StoredPriceRow[];
  snapshots?: ValueSnapshot[];
}): jest.Mocked<DataApi> & { rows(): Transaction[] } {
  const db = fixture.ledger;
  return {
    rows: () => db.transactions,
    ledger: jest.fn(async () => ({
      ...db,
      transactions: [...db.transactions],
      assets: [...db.assets],
      ca: { ...db.ca, factors: [...db.ca.factors] },
    })),
    market: jest.fn<Promise<Market>, [string, readonly string[]]>(async () => fixture.market),
    snapshots: jest.fn(async () => fixture.snapshots ?? []),
    priceHistory: jest.fn(async (id: string) =>
      (fixture.history ?? fixture.market.prices).filter((p) => p.assetId === id),
    ),
    valueNow: jest.fn(async () => null),
    jobRuns: jest.fn(async () => ({
      prices: { job: 'prices', status: 'ok' as const, finishedAt: '2026-10-23T05:25:41Z' },
      snapshots: {
        job: 'snapshots',
        status: 'partial' as const,
        finishedAt: '2026-10-23T05:40:12Z',
      },
    })),
    insertTransaction: jest.fn(async (row: Transaction) => {
      if (!db.transactions.some((t) => t.id === row.id))
        db.transactions = [...db.transactions, row];
    }),
    updateTransaction: jest.fn(async (row: Transaction) => {
      db.transactions = db.transactions.map((t) => (t.id === row.id ? row : t));
    }),
    deleteTransaction: jest.fn(async (id: string) => {
      db.transactions = db.transactions.filter((t) => t.id !== id);
    }),
    insertAsset: jest.fn(async (a) => {
      if (db.assets.some((x) => x.id === a.id)) return;
      db.assets = [...db.assets, { ...a, priceSource: 'manual', priceSourceId: null }];
    }),
    insertFactors: jest.fn(async (month, rows) => {
      db.ca.factors = [
        ...db.ca.factors,
        ...rows.map((r) => ({ subscriptionId: r.subscriptionId, month, factor: r.factor })),
      ];
    }),
  };
}

const daysBefore = (today: string, n: number) => {
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
};

const trade = (
  type: 'buy' | 'sell' | 'subscription',
  id: string,
  date: string,
  accountId: string,
  assetId: string,
  qty: string,
  price: string,
  fx = '1',
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
  currency: fx === '1' ? 'EUR' : 'USD',
  fxRateToEur: dec(fx),
});

const cash = (
  type: 'dividend' | 'fee',
  id: string,
  date: string,
  accountId: string,
  assetId: string | null,
  amount: string,
): Transaction => ({
  id,
  accountId,
  assetId,
  type,
  tradeDate: date,
  quantity: null,
  unitPrice: null,
  amount: dec(amount),
  fees: dec('0'),
  currency: 'EUR',
  fxRateToEur: dec('1'),
});

/**
 * Four open positions at three brokers and one closed, by hand (EUR):
 *   VWCE  Degiro 10 @ 100, IBKR 5 @ 120; 140 yesterday, 150 now -> 2,250
 *         (Degiro 1,500, IBKR 750), U +650, day +150 (+7.14%); dividend 12 at Degiro.
 *   AAPL  IBKR 4 @ 150 USD (fx 0.9, cost 540); 200 USD at 0.92 -> 736, U +196, day 0.
 *   BTC   Degiro 0.1 @ 30,000; last close 25,000 ten days ago (stale) -> 2,500, U −500.
 *   CA    AforroNet 1,000 units @ 1, factor 1.10482 (recent) -> 1,104.82, U +104.82.
 *   MSFT  IBKR 2 @ 300 USD, sold 2 @ 350 (fx 0.9): closed, realized +90. Fee 5 at IBKR.
 *   V 6,590.82; brokers Degiro 4,000, IBKR 1,486, AforroNet 1,104.82.
 *   G 547.82 = Degiro 12 + IBKR 431 + AforroNet 104.82.
 */
export function portfolioLedger(today: string): {
  ledger: Ledger;
  market: Market;
  history: StoredPriceRow[];
} {
  const y = daysBefore(today, 1);
  const close = (assetId: string, date: string, value: string, currency = 'EUR') => ({
    assetId,
    date,
    close: dec(value),
    currency,
    splitFactor: null,
  });
  return {
    ledger: {
      transactions: [
        trade('buy', 'v1', '2025-01-02', 'degiro', 'vwce', '10', '100'),
        trade('subscription', 'ca-sub', '2025-01-15', 'aforronet', 'ca', '1000', '1'),
        trade('buy', 'm1', '2025-02-03', 'ibkr', 'msft', '2', '300', '0.9'),
        trade('buy', 'a1', '2025-03-03', 'ibkr', 'aapl', '4', '150', '0.9'),
        trade('buy', 'v2', '2025-04-01', 'ibkr', 'vwce', '5', '120'),
        trade('buy', 'b1', '2025-05-02', 'degiro', 'btc', '0.1', '30000'),
        trade('sell', 'm2', '2025-06-02', 'ibkr', 'msft', '2', '350', '0.9'),
        cash('dividend', 'd1', '2025-06-20', 'degiro', 'vwce', '12'),
        cash('fee', 'f1', '2025-07-01', 'ibkr', null, '5'),
      ],
      assets: [
        { ...asset('vwce', 'VWCE', 'Vanguard FTSE All-World'), isin: 'IE00BK5BQT80' },
        {
          ...asset('aapl', 'AAPL', 'Apple Inc.'),
          assetType: 'stock',
          exchange: 'XNAS',
          tradingCurrency: 'USD',
        },
        {
          ...asset('msft', 'MSFT', 'Microsoft'),
          assetType: 'stock',
          exchange: 'XNAS',
          tradingCurrency: 'USD',
        },
        { ...asset('btc', 'BTC', 'Bitcoin'), assetType: 'crypto', exchange: null },
        {
          ...asset('ca', '', 'Certificados de Aforro E'),
          ticker: null,
          assetType: 'certificado_aforro',
          exchange: null,
        },
      ],
      accounts: [
        { id: 'degiro', name: 'Degiro' },
        { id: 'ibkr', name: 'IBKR' },
        { id: 'aforronet', name: 'AforroNet' },
      ],
      ca: {
        subscriptions: [{ id: 's1', seriesId: 'E', transactionId: 'ca-sub' }],
        series: [{ id: 'E', code: 'E', name: 'Série E' }],
        // In force yesterday and today, and at most 35 days old (not stale).
        factors: [
          {
            subscriptionId: 's1',
            month: `${daysBefore(today, 2).slice(0, 7)}-01`,
            factor: dec('1.10482'),
          },
        ],
      },
    },
    market: {
      prices: [
        close('vwce', y, '140'),
        close('aapl', y, '200', 'USD'),
        close('btc', daysBefore(today, 10), '25000'),
      ],
      fx: [{ currency: 'USD', date: y, rateToEur: dec('0.92') }],
      liveQuotes: [{ assetId: 'vwce', date: today, close: dec('150'), currency: 'EUR' }],
    },
    history: [close('vwce', '2025-01-02', '100'), close('vwce', y, '140')],
  };
}

export function fakeServices(over: {
  auth: ReturnType<typeof fakeAuth>['auth'];
  data: DataApi;
  settings?: Partial<Settings>;
}): Services {
  return {
    auth: over.auth as unknown as Services['auth'],
    data: over.data,
    device: {
      securityLevel: jest.fn(async () => 'biometric' as const),
      authenticate: jest.fn(async () => true),
      setScreenCaptureBlocked: jest.fn(async () => undefined),
    },
    settings: {
      load: jest.fn(async () => ({ lockEnabled: false, ...over.settings })),
      save: jest.fn(async () => undefined),
    },
    clearSession: jest.fn(async () => undefined),
    projectRef: 'abcdefghijklmnopqrst',
    newId: jest.fn(() => `id-${++ids}`),
  };
}

let ids = 0;
