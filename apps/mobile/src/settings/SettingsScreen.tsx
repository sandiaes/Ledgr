import type { JobRunSummary } from '@ledgr/client';
import Constants from 'expo-constants';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { useGate } from '../auth/AuthGate';
import { useJobRuns } from '../data/usePortfolio';
import { formatDateTime } from '../format';
import { useServices, type SecurityLevel } from '../services';
import { Badge } from '../positions/PositionRowView';
import { Button, Card, Segmented } from '../ui/parts';
import { colors, space } from '../ui/theme';
import { LOCK_TIMEOUTS, type LockTimeout } from './settings';
import { useSettings } from './SettingsProvider';

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

/** "23 Oct 05:25 ok" for the newest run of a job, in the phone's local time. */
function RunLine(props: {
  label: string;
  run: JobRunSummary | null | undefined;
  loading: boolean;
}) {
  const { run } = props;
  return (
    <Row label={props.label}>
      <View style={styles.run}>
        <Text style={styles.value}>
          {props.loading
            ? '…'
            : run
              ? formatDateTime(Date.parse(run.finishedAt), String(new Date().getFullYear()))
              : 'never'}
        </Text>
        {run ? (
          <Badge
            text={run.status}
            tone={run.status === 'ok' ? 'muted' : run.status === 'partial' ? 'warning' : 'danger'}
          />
        ) : null}
      </View>
    </Row>
  );
}

/** Lock, privacy, the daily jobs' last runs, sign out and the version (docs/app-plan.md §1). */
export function SettingsScreen() {
  const { device, projectRef } = useServices();
  const { signOut } = useGate();
  const runs = useJobRuns();
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
      <Card title="Data">
        {runs.isError ? (
          <Text style={styles.hint}>Could not read the job runs ({errorCode(runs.error)}).</Text>
        ) : null}
        <RunLine label="Last price update" run={runs.data?.prices} loading={runs.isPending} />
        <RunLine label="Last snapshot" run={runs.data?.snapshots} loading={runs.isPending} />
        <Text style={styles.hint}>
          The daily price run is at 05:25 UTC, snapshots at 05:40; “partial” means some assets need
          a look (see job_runs).
        </Text>
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
  value: { fontSize: 14, color: colors.text },
  run: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  footer: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: space.md },
});
