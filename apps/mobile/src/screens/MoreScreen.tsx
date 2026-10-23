import Constants from 'expo-constants';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useGate } from '../auth/AuthGate';
import { useServices, type SecurityLevel } from '../services';
import { LOCK_TIMEOUTS, type LockTimeout } from '../settings/settings';
import { useSettings } from '../settings/SettingsProvider';
import { Button, Card, Segmented } from '../ui/parts';
import { colors, space } from '../ui/theme';

function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.label}>{props.label}</Text>
        {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
      </View>
      {props.children}
    </View>
  );
}

const TIMEOUT_LABELS: Record<LockTimeout, string> = {
  0: 'Immediately',
  1: '1 min',
  5: '5 min',
  15: '15 min',
};

/** Settings, sign out and the app version (the rest of More comes in slice 5c). */
export function MoreScreen() {
  const { device, projectRef } = useServices();
  const { signOut } = useGate();
  const { settings, update } = useSettings();
  const [level, setLevel] = useState<SecurityLevel | null>(null);

  useEffect(() => {
    device
      .securityLevel()
      .catch(() => 'none' as const)
      .then(setLevel);
  }, [device]);
  const noDeviceLock = level === 'none';

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card title="Security">
        <Row
          label="App lock"
          hint={
            noDeviceLock
              ? 'Set a screen lock (PIN, pattern or fingerprint) on the phone to use this.'
              : 'Fingerprint, face or the device PIN when Ledgr opens.'
          }
        >
          <Switch
            value={settings.lockEnabled === true && !noDeviceLock}
            disabled={noDeviceLock}
            onValueChange={(on) => update({ lockEnabled: on })}
            accessibilityLabel="App lock"
          />
        </Row>
        {settings.lockEnabled && !noDeviceLock ? (
          <>
            <Text style={styles.hint}>Lock again after this long in the background</Text>
            <Segmented
              options={LOCK_TIMEOUTS.map((m) => ({ value: String(m), label: TIMEOUT_LABELS[m] }))}
              value={String(settings.lockTimeoutMinutes)}
              onChange={(v) => update({ lockTimeoutMinutes: Number(v) as LockTimeout })}
            />
          </>
        ) : null}
        <Row label="Hide values" hint="Show every amount as ••••; percentages stay.">
          <Switch
            value={settings.hideValues}
            onValueChange={(on) => update({ hideValues: on })}
            accessibilityLabel="Hide values"
          />
        </Row>
        <Row
          label="Block screenshots"
          hint="No screenshots or screen recording, and a blank preview in recent apps."
        >
          <Switch
            value={settings.blockScreenshots}
            onValueChange={(on) => update({ blockScreenshots: on })}
            accessibilityLabel="Block screenshots"
          />
        </Row>
      </Card>
      <Card title="Account">
        <Button label="Sign out" onPress={signOut} />
      </Card>
      <Text style={styles.footer}>
        Ledgr {Constants.expoConfig?.version ?? ''} · project {projectRef}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.lg, paddingBottom: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, gap: space.md },
  rowText: { flex: 1 },
  label: { fontSize: 15, color: colors.text },
  hint: { fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: space.xs },
  footer: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: space.md },
});
