import type { AssetType } from '@ledgr/core';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useServices } from '../services';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from './settings';

interface SettingsValue {
  settings: Settings;
  update(change: Partial<Settings>): void;
}

const SettingsContext = createContext<SettingsValue>({
  settings: DEFAULT_SETTINGS,
  update: () => undefined,
});

/** Loads the toggles before rendering, so a lock or hidden values never flash open. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { settings: store, device } = useServices();
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let live = true;
    store
      .load()
      .catch(() => null)
      .then((raw) => live && setSettings(parseSettings(raw)));
    return () => {
      live = false;
    };
  }, [store]);

  const update = useCallback(
    (change: Partial<Settings>) =>
      setSettings((current) => {
        const next = { ...(current ?? DEFAULT_SETTINGS), ...change };
        store.save(next).catch(() => undefined);
        return next;
      }),
    [store],
  );

  // FLAG_SECURE follows the setting.
  const block = settings?.blockScreenshots;
  useEffect(() => {
    if (block !== undefined) device.setScreenCaptureBlocked(block).catch(() => undefined);
  }, [block, device]);

  if (!settings) return null;
  return (
    <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsValue {
  return useContext(SettingsContext);
}

const ALL_TYPES: readonly AssetType[] = [];
const WITHOUT_CERTIFICADOS: readonly AssetType[] = ['certificado_aforro'];

/**
 * The asset types left out of every figure (the "Include certificados" setting), as a
 * stable array for the core builders.
 */
export function useExcludeTypes(): readonly AssetType[] {
  return useSettings().settings.includeCertificados ? ALL_TYPES : WITHOUT_CERTIFICADOS;
}

/** Whether certificados are included, and the switch. */
export function useIncludeCertificados(): [boolean, (on: boolean) => void] {
  const { settings, update } = useSettings();
  return [settings.includeCertificados, (on) => update({ includeCertificados: on })];
}

/** Whether amounts are masked ("••••"). */
export function useHideValues(): [boolean, () => void] {
  const { settings, update } = useSettings();
  return [settings.hideValues, () => update({ hideValues: !settings.hideValues })];
}
