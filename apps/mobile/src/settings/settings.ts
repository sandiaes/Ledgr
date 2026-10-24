export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type AppearancePreference = (typeof APPEARANCES)[number];

export const LOCK_TIMEOUTS = [0, 1, 5, 15] as const;
export type LockTimeout = (typeof LOCK_TIMEOUTS)[number];

/**
 * What the New transaction form offers beyond Buy and Sell: the Dividend and Interest types
 * and the Fee field. Each is a switch in the drawer.
 */
export interface NewTxOptions {
  dividend: boolean;
  interest: boolean;
  fee: boolean;
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
  /** Dividend, Interest and Fee in the New transaction form, all off by default. */
  newTxOptions: NewTxOptions;
}

export const DEFAULT_SETTINGS: Settings = {
  lockEnabled: null,
  lockTimeoutMinutes: 1,
  hideValues: false,
  blockScreenshots: true,
  includeCertificados: true,
  appearance: 'dark',
  newTxOptions: { dividend: false, interest: false, fee: false },
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
  const options = (
    r.newTxOptions && typeof r.newTxOptions === 'object' ? r.newTxOptions : {}
  ) as Record<string, unknown>;
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
    newTxOptions: {
      dividend: bool(options.dividend, DEFAULT_SETTINGS.newTxOptions.dividend),
      interest: bool(options.interest, DEFAULT_SETTINGS.newTxOptions.interest),
      fee: bool(options.fee, DEFAULT_SETTINGS.newTxOptions.fee),
    },
  };
}
