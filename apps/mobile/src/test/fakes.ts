// Test doubles for the services behind the screens. Not part of the app bundle.
import type { AssetRecord } from '@ledgr/client';
import { dec, type Transaction } from '@ledgr/core';
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
      ca: { subscriptions: [], factors: [] },
    },
    market: {
      prices: [{ assetId: 'vwce', date: y, close: dec('145'), currency: 'EUR', splitFactor: null }],
      fx: [],
      liveQuotes: [{ assetId: 'vwce', date: today, close: dec('150'), currency: 'EUR' }],
    },
  };
}

export function fakeData(fixture: { ledger: Ledger; market: Market }): jest.Mocked<DataApi> {
  return {
    ledger: jest.fn(async () => fixture.ledger),
    market: jest.fn<Promise<Market>, [string, readonly string[]]>(async () => fixture.market),
    snapshots: jest.fn(async () => []),
    valueNow: jest.fn(async () => null),
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
  };
}
