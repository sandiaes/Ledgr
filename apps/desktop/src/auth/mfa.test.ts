import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMfaState, startEnrollment, verifyCode } from './mfa';

type Auth = SupabaseClient['auth'];

const factor = (id: string, status: 'verified' | 'unverified', factor_type = 'totp') => ({
  id,
  status,
  factor_type,
});

function mockAuth(opts: { level?: string; factors?: object[]; qr?: string } = {}) {
  const mfa = {
    getAuthenticatorAssuranceLevel: vi
      .fn()
      .mockResolvedValue({ data: { currentLevel: opts.level ?? 'aal1' }, error: null }),
    listFactors: vi.fn().mockResolvedValue({ data: { all: opts.factors ?? [] }, error: null }),
    unenroll: vi.fn().mockResolvedValue({ data: {}, error: null }),
    enroll: vi.fn().mockResolvedValue({
      data: {
        id: 'new',
        totp: { qr_code: opts.qr ?? '<svg/>', secret: 'S3CR3T', uri: 'otpauth://' },
      },
      error: null,
    }),
    challengeAndVerify: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };
  return { auth: { mfa } as unknown as Auth, mfa };
}

describe('getMfaState', () => {
  it('reports aal2 when the session is already stepped up', async () => {
    const { auth } = mockAuth({ level: 'aal2' });
    expect(await getMfaState(auth)).toEqual({ kind: 'aal2' });
  });

  it('asks for a code when a verified TOTP factor exists', async () => {
    const { auth } = mockAuth({ factors: [factor('u', 'unverified'), factor('v', 'verified')] });
    expect(await getMfaState(auth)).toEqual({ kind: 'needs-code', factorId: 'v' });
  });

  it('asks for enrollment when only unverified or non-TOTP factors exist', async () => {
    const { auth } = mockAuth({
      factors: [factor('u', 'unverified'), factor('p', 'verified', 'phone')],
    });
    expect(await getMfaState(auth)).toEqual({ kind: 'needs-enrollment' });
  });
});

describe('startEnrollment', () => {
  it('removes leftover unverified TOTP factors, then enrolls', async () => {
    const { auth, mfa } = mockAuth({
      factors: [factor('stale', 'unverified'), factor('keep', 'verified')],
    });
    const result = await startEnrollment(auth);
    expect(mfa.unenroll).toHaveBeenCalledTimes(1);
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'stale' });
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Ledgr' });
    expect(result.factorId).toBe('new');
    expect(result.secret).toBe('S3CR3T');
  });

  it('turns a raw SVG into a data URL and passes an existing data URL through', async () => {
    expect((await startEnrollment(mockAuth({ qr: '<svg/>' }).auth)).qrSrc).toBe(
      'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',
    );
    const dataUrl = 'data:image/svg+xml;utf-8,<svg/>';
    expect((await startEnrollment(mockAuth({ qr: dataUrl }).auth)).qrSrc).toBe(dataUrl);
  });
});

describe('verifyCode', () => {
  it('rejects malformed codes without calling the server', async () => {
    const { auth, mfa } = mockAuth();
    await expect(verifyCode(auth, 'f', '12345')).rejects.toThrow(/6-digit/);
    await expect(verifyCode(auth, 'f', 'abcdef')).rejects.toThrow(/6-digit/);
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('strips spaces and verifies', async () => {
    const { auth, mfa } = mockAuth();
    await verifyCode(auth, 'f', '123 456');
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f', code: '123456' });
  });

  it('surfaces a server rejection', async () => {
    const { auth, mfa } = mockAuth();
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: new Error('Invalid TOTP code') });
    await expect(verifyCode(auth, 'f', '000000')).rejects.toThrow('Invalid TOTP code');
  });
});
