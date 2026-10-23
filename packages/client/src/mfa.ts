import type { SupabaseClient } from '@supabase/supabase-js';
import { jwtClaims } from './jwt';

type Auth = SupabaseClient['auth'];

export type MfaState =
  { kind: 'needs-enrollment' } | { kind: 'needs-code'; factorId: string } | { kind: 'aal2' };

export interface Enrollment {
  factorId: string;
  qrSrc: string;
  secret: string;
}

const CODE = /^\d{6}$/;

export async function getMfaState(auth: Auth): Promise<MfaState> {
  const aal = await auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.error) throw aal.error;
  if (aal.data.currentLevel === 'aal2') return { kind: 'aal2' };

  const factors = await auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  const verified = factors.data.all.find(
    (f) => f.factor_type === 'totp' && f.status === 'verified',
  );
  return verified ? { kind: 'needs-code', factorId: verified.id } : { kind: 'needs-enrollment' };
}

/**
 * Starts TOTP enrollment. Leftover unverified TOTP factors (from an abandoned
 * attempt) are removed first, otherwise the server rejects a second enrollment.
 */
export async function startEnrollment(auth: Auth): Promise<Enrollment> {
  const factors = await auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  for (const f of factors.data.all) {
    if (f.factor_type === 'totp' && f.status === 'unverified') {
      const res = await auth.mfa.unenroll({ factorId: f.id });
      if (res.error) throw res.error;
    }
  }

  const { data, error } = await auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Ledgr' });
  if (error) throw error;
  const qr = data.totp.qr_code;
  const qrSrc = qr.startsWith('data:')
    ? qr
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`;
  return { factorId: data.id, qrSrc, secret: data.totp.secret };
}

/** Verifies a 6-digit code. Used both to finish enrollment and to sign in. */
export async function verifyCode(auth: Auth, factorId: string, code: string): Promise<void> {
  const trimmed = code.replace(/\s/g, '');
  if (!CODE.test(trimmed)) throw new Error('Enter the 6-digit code from your authenticator');
  const { error } = await auth.mfa.challengeAndVerify({ factorId, code: trimmed });
  if (error) throw error;
}

/**
 * A data request was attempted without an MFA-verified (aal2) session. Under aal1 RLS
 * returns empty results, which would look like "no data": the app shows the code prompt
 * instead.
 */
export class MfaRequiredError extends Error {
  override name = 'MfaRequiredError';
  constructor() {
    super('MFA verification required');
  }
}

/** The assurance level in an access token ('aal1', 'aal2'), read locally; null if none. */
export function tokenAal(accessToken: string): string | null {
  const aal = jwtClaims(accessToken)?.aal;
  return typeof aal === 'string' ? aal : null;
}

/** Throws MfaRequiredError unless the token is aal2. Call before every data request. */
export function assertAal2(accessToken: string | null | undefined): void {
  if (!accessToken || tokenAal(accessToken) !== 'aal2') throw new MfaRequiredError();
}
