import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useGate } from '../auth/AuthGate';
import { useServices } from '../services';
import { useSettings } from '../settings/SettingsProvider';
import { Button } from '../ui/parts';
import { colors, space } from '../ui/theme';

/**
 * Biometric / device-PIN lock over the signed-in app (docs/app-plan.md §6): on a cold
 * start and on return from the background after the timeout. Local only: it does not
 * touch the Supabase session. On the first sign-in it defaults to on when the phone has
 * a screen lock or biometrics.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const { device } = useServices();
  const { settings, update } = useSettings();
  const enabled = settings.lockEnabled;
  const [locked, setLocked] = useState(enabled === true);
  const authenticating = useRef(false);
  const backgroundSince = useRef<number | null>(null);

  // First sign-in: decide the default from the device (no lock right after signing in).
  useEffect(() => {
    if (enabled !== null) return;
    device
      .securityLevel()
      .catch(() => 'none' as const)
      .then((level) => update({ lockEnabled: level !== 'none' }));
  }, [enabled, device, update]);

  const timeoutMs = settings.lockTimeoutMinutes * 60_000;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // The system prompt itself can send the app to the background: ignore that.
      if (authenticating.current || !enabled) return;
      if (state === 'background') backgroundSince.current ??= Date.now();
      if (state === 'active' && backgroundSince.current !== null) {
        if (Date.now() - backgroundSince.current >= timeoutMs) setLocked(true);
        backgroundSince.current = null;
      }
    });
    return () => sub.remove();
  }, [enabled, timeoutMs]);

  if (enabled === null) return null;
  if (locked && enabled) {
    return (
      <LockScreen
        onUnlock={async () => {
          authenticating.current = true;
          try {
            if (await device.authenticate()) setLocked(false);
          } finally {
            authenticating.current = false;
            backgroundSince.current = null;
          }
        }}
      />
    );
  }
  return <>{children}</>;
}

function LockScreen({ onUnlock }: { onUnlock(): Promise<void> }) {
  const { signOut } = useGate();
  const [failed, setFailed] = useState(false);
  const unlock = useCallback(() => {
    setFailed(false);
    onUnlock()
      .catch(() => undefined)
      .finally(() => setFailed(true));
  }, [onUnlock]);

  // Prompt at once, once.
  const prompted = useRef(false);
  useEffect(() => {
    if (prompted.current) return;
    prompted.current = true;
    unlock();
  }, [unlock]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Ledgr is locked</Text>
      {failed ? <Text style={styles.text}>Unlock with your fingerprint, face or PIN.</Text> : null}
      <Button label="Unlock" onPress={unlock} />
      <Button label="Sign out" kind="plain" onPress={signOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    padding: space.xl,
    backgroundColor: colors.background,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: space.md },
  text: { fontSize: 15, color: colors.muted },
});
