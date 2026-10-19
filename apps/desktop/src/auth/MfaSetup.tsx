import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getMfaState, startEnrollment, verifyCode, type Enrollment, type MfaState } from './mfa';

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function MfaSetup() {
  const [session, setSession] = useState<Session | null>(null);
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    try {
      setMfa(session ? await getMfaState(supabase.auth) : null);
    } catch (e) {
      setError(message(e));
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void run(async () => {
      const { error } = await supabase.auth.signInWithPassword({
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      if (error) throw error;
    });
  };

  const submitCode = (factorId: string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code'));
    void run(async () => {
      await verifyCode(supabase.auth, factorId, code);
      setEnrollment(null);
      await refresh();
    });
  };

  const codeForm = (factorId: string, label: string) => (
    <form onSubmit={submitCode(factorId)}>
      <label>
        {label}{' '}
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
        />
      </label>{' '}
      <button disabled={busy}>Verify</button>
    </form>
  );

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 420, margin: '2rem auto' }}>
      <h1>Ledgr – sign in</h1>
      {error && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}

      {!session && (
        <form onSubmit={signIn}>
          <p>
            <input name="email" type="email" placeholder="Email" autoComplete="username" required />
          </p>
          <p>
            <input
              name="password"
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              required
            />
          </p>
          <button disabled={busy}>Sign in</button>
        </form>
      )}

      {session && mfa?.kind === 'needs-enrollment' && !enrollment && (
        <>
          <p>No authenticator enrolled yet.</p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => setEnrollment(await startEnrollment(supabase.auth)))
            }
          >
            Enroll authenticator (TOTP)
          </button>
        </>
      )}

      {session && enrollment && (
        <>
          <p>Scan with your authenticator app, then enter the code it shows.</p>
          <img src={enrollment.qrSrc} alt="TOTP QR code" width={200} height={200} />
          <details>
            <summary>Can't scan? Enter the secret manually</summary>
            <code>{enrollment.secret}</code>
          </details>
          {codeForm(enrollment.factorId, 'Code')}
        </>
      )}

      {session && mfa?.kind === 'needs-code' && codeForm(mfa.factorId, 'Authenticator code')}

      {session && mfa?.kind === 'aal2' && <p>✅ Signed in with password + authenticator (aal2).</p>}

      {session && (
        <p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { error } = await supabase.auth.signOut();
                if (error) throw error;
                setEnrollment(null);
              })
            }
          >
            Sign out
          </button>
        </p>
      )}
    </main>
  );
}
