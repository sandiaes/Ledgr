export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type AppearancePreference = (typeof APPEARANCES)[number];

export const LOCK_TIMEOUTS = [0, 1, 5, 15] as const;
export type LockTimeout = (typeof LOCK_TIMEOUTS)[number];

/** The extra transaction types the New transaction form offers besides Buy and Sell. */
export interface NewTxTypes {
  dividend: boolean;
  interest: boolean;
}

/** The toggles kept on the device (AsyncStorage). Never any financial data. */
export interface Settings {
  /** null until the first sign-in decides it from the device's security (docs §6). */
  lockEnabled: boolean | null;
  /** Lock again after this many minutes in the background. */
  lockTimeoutMinutes: LockTimeout;
  /**
   * Privacy: every amount, unit count and percentage shows as a mask. One switch, shared by
   * the eye in the header and the drawer, kept across restarts.
   */
  hideValues: boolean;
  blockScreenshots: boolean;
  /**
   * "Include certificados de aforro": when off, every figure, chart and list leaves the
   * certificados out (docs/app-plan.md §10). A preference, not financial data.
   */
  includeCertificados: boolean;
  /** Theme: Dark by default on a new install; System follows the phone. */
  appearance: AppearancePreference;
  /** Dividend and Interest in the New transaction form, both off by default. */
  newTxTypes: NewTxTypes;
}

export const DEFAULT_SETTINGS: Settings = {
  lockEnabled: null,
  lockTimeoutMinutes: 1,
  hideValues: false,
  blockScreenshots: true,
  includeCertificados: true,
  appearance: 'dark',
  newTxTypes: { dividend: false, interest: false },
};

export const SETTINGS_KEY = 'ledgr.settings.v1';

/**
 * Stored settings, field by field; anything unreadable falls back to the default. Nothing
 * stored at all is a new install, which starts in Dark. Settings stored before Appearance
 * existed had no theme to keep but the phone's, so they read as System: no migration
 * (docs/design.md §10 D6).
 */
export function parseSettings(raw: unknown): Settings {
  const stored = !!raw && typeof raw === 'object';
  const r = (stored ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const types = (r.newTxTypes && typeof r.newTxTypes === 'object' ? r.newTxTypes : {}) as Record<
    string,
    unknown
  >;
  return {
    lockEnabled: typeof r.lockEnabled === 'boolean' ? r.lockEnabled : null,
    lockTimeoutMinutes: LOCK_TIMEOUTS.includes(r.lockTimeoutMinutes as LockTimeout)
      ? (r.lockTimeoutMinutes as LockTimeout)
      : DEFAULT_SETTINGS.lockTimeoutMinutes,
    hideValues: bool(r.hideValues, DEFAULT_SETTINGS.hideValues),
    blockScreenshots: bool(r.blockScreenshots, DEFAULT_SETTINGS.blockScreenshots),
    includeCertificados: bool(r.includeCertificados, DEFAULT_SETTINGS.includeCertificados),
    appearance: APPEARANCES.includes(r.appearance as AppearancePreference)
      ? (r.appearance as AppearancePreference)
      : stored
        ? 'system'
        : DEFAULT_SETTINGS.appearance,
    newTxTypes: {
      dividend: bool(types.dividend, DEFAULT_SETTINGS.newTxTypes.dividend),
      interest: bool(types.interest, DEFAULT_SETTINGS.newTxTypes.interest),
    },
  };
}
