export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type AppearancePreference = (typeof APPEARANCES)[number];

export const LOCK_TIMEOUTS = [0, 1, 5, 15] as const;
export type LockTimeout = (typeof LOCK_TIMEOUTS)[number];

/** The toggles kept on the device (AsyncStorage). Never any financial data. */
export interface Settings {
  /** null until the first sign-in decides it from the device's security (docs §6). */
  lockEnabled: boolean | null;
  /** Lock again after this many minutes in the background. */
  lockTimeoutMinutes: LockTimeout;
  hideValues: boolean;
  blockScreenshots: boolean;
  /**
   * "Include certificados de aforro": when off, every figure, chart and list leaves the
   * certificados out (docs/app-plan.md §10). A preference, not financial data.
   */
  includeCertificados: boolean;
  /** Theme: follow the phone (default), or always light / dark. */
  appearance: AppearancePreference;
}

export const DEFAULT_SETTINGS: Settings = {
  lockEnabled: null,
  lockTimeoutMinutes: 1,
  hideValues: false,
  blockScreenshots: true,
  includeCertificados: true,
  appearance: 'system',
};

export const SETTINGS_KEY = 'ledgr.settings.v1';

/** Stored settings, field by field; anything unreadable falls back to the default. */
export function parseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
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
      : DEFAULT_SETTINGS.appearance,
  };
}
