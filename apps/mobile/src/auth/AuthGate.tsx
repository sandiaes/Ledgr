import { getMfaState } from '@ledgr/client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useServices } from '../services';
import { errorCode } from './errors';

/**
 * The root screen per session state (docs/app-plan.md §6). Only 'aal2' reaches a data
 * screen: an aal1 session always lands on the code prompt, never on an empty dashboard.
 */
export type Gate =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'needs-code'; factorId: string }
  | { kind: 'needs-enrollment' }
  | { kind: 'aal2' }
  /** The state could not be read (offline, server error): retry or sign out. */
  | { kind: 'error'; code: string };

interface GateValue {
  gate: Gate;
  /** Reads the session and its assurance level again. */
  evaluate(): void;
  signOut(): Promise<void>;
}

const GateContext = createContext<GateValue | null>(null);

export function AuthGateProvider(props: { onSignedOut(): void; children: ReactNode }) {
  const { auth, clearSession } = useServices();
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  const run = useRef(0);
  const { onSignedOut } = props;

  const evaluate = useCallback(() => {
    const id = ++run.current;
    const apply = (g: Gate) => {
      if (id === run.current) setGate(g);
    };
    (async () => {
      const { data, error } = await auth.getSession();
      if (error) throw error;
      if (!data.session) return apply({ kind: 'signed-out' });
      const mfa = await getMfaState(auth);
      apply(
        mfa.kind === 'aal2'
          ? { kind: 'aal2' }
          : mfa.kind === 'needs-code'
            ? { kind: 'needs-code', factorId: mfa.factorId }
            : { kind: 'needs-enrollment' },
      );
    })().catch((e: unknown) => apply({ kind: 'error', code: errorCode(e) }));
  }, [auth]);

  useEffect(() => {
    evaluate();
    // Sign in, token refresh, MFA verified, sign out. Supabase must not be called from
    // inside this callback, so the check runs right after it.
    const { data } = auth.onAuthStateChange(() => {
      setTimeout(evaluate, 0);
    });
    const app = AppState.addEventListener('change', (s) => s === 'active' && evaluate());
    return () => {
      data.subscription.unsubscribe();
      app.remove();
    };
  }, [auth, evaluate]);

  const signOut = useCallback(async () => {
    await auth.signOut().catch(() => undefined);
    await clearSession().catch(() => undefined);
    onSignedOut();
    evaluate();
  }, [auth, clearSession, evaluate, onSignedOut]);

  const value = useMemo(() => ({ gate, evaluate, signOut }), [gate, evaluate, signOut]);
  return <GateContext.Provider value={value}>{props.children}</GateContext.Provider>;
}

export function useGate(): GateValue {
  const value = useContext(GateContext);
  if (!value) throw new Error('AuthGateProvider missing');
  return value;
}
