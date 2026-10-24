import type { JobRunSummary } from '@ledgr/client';
import { useDrawerStatus } from '@react-navigation/drawer';
import Constants from 'expo-constants';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGate } from '../auth/AuthGate';
import { errorCode } from '../auth/errors';
import { useJobRuns } from '../data/usePortfolio';
import { formatDateTime } from '../format';
import { useRootNavigation } from '../navigation';
import { Badge } from '../positions/PositionRowView';
import { Icon } from '../ui/Icon';
import { ListRow } from '../ui/ListRow';
import { Switch } from '../ui/parts';
import { Section } from '../ui/Section';
import { SegmentedControl } from '../ui/SegmentedControl';
import { T } from '../ui/T';
import { space } from '../ui/theme';
import { useServices, type SecurityLevel } from '../services';
import {
  APPEARANCES,
  LOCK_TIMEOUTS,
  type AppearancePreference,
  type LockTimeout,
} from '../settings/settings';
import { useSettings } from '../settings/SettingsProvider';

function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <T variant="body">{props.label}</T>
        {props.hint ? (
          <T variant="caption" tone="muted">
            {props.hint}
          </T>
        ) : null}
      </View>
      {props.children}
    </View>
  );
}

const APPEARANCE_LABELS: Record<AppearancePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const TIMEOUT_LABELS: Record<LockTimeout, string> = {
  0: 'Immediately',
  1: '1 min',
  5: '5 min',
  15: '15 min',
};

/** "23/10 05:25 ok" for the newest run of a job, in the phone's local time. */
function RunLine(props: {
  label: string;
  run: JobRunSummary | null | undefined;
  loading: boolean;
}) {
  const { run } = props;
  return (
    <Row label={props.label}>
      <View style={styles.run}>
        <T variant="sub" figure>
          {props.loading
            ? '…'
            : run
              ? formatDateTime(Date.parse(run.finishedAt), String(new Date().getFullYear()))
              : 'never'}
        </T>
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

/**
 * What the menu button opens (docs/design.md §6.2). U1 ships the shell: the sections are
 * there, holding today's Settings controls as they were; U3 restyles them and adds the New
 * transaction options. The privacy switch is the one the eye in the header toggles.
 */
export function DrawerPanel({ closeDrawer }: { closeDrawer(): void }) {
  // Nothing is built (or fetched, like the job runs) until the drawer is first opened.
  const [opened, setOpened] = useState(false);
  const open = useDrawerStatus() === 'open';
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);
  return opened ? (
    <DrawerSections open={open} closeDrawer={closeDrawer} />
  ) : (
    <View testID="drawer-panel" accessibilityState={{ expanded: false }} />
  );
}

function DrawerSections({ open, closeDrawer }: { open: boolean; closeDrawer(): void }) {
  const insets = useSafeAreaInsets();
  const { device, projectRef } = useServices();
  const { signOut } = useGate();
  const runs = useJobRuns();
  const { settings, update } = useSettings();
  const root = useRootNavigation();
  const [level, setLevel] = useState<SecurityLevel | null>(null);

  useEffect(() => {
    device
      .securityLevel()
      .catch(() => 'none' as const)
      .then(setLevel);
  }, [device]);
  const noDeviceLock = level === 'none';

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl },
      ]}
      testID="drawer-panel"
      accessibilityState={{ expanded: open }}
    >
      <T variant="title2" style={styles.brand}>
        Ledgr
      </T>
      <Section title="Appearance">
        <SegmentedControl
          options={APPEARANCES.map((a) => ({ value: a, label: APPEARANCE_LABELS[a] }))}
          value={settings.appearance}
          onChange={(appearance) => update({ appearance })}
          accessibilityLabel="Appearance"
        />
        <T variant="caption" tone="muted">
          System follows the phone’s light or dark setting.
        </T>
      </Section>
      <Section title="Privacy">
        <Row
          label="Hide amounts"
          hint="Masks every amount, unit count and percentage. The eye in the header is this switch."
        >
          <Switch
            value={settings.hideValues}
            onValueChange={(on) => update({ hideValues: on })}
            accessibilityLabel="Hide amounts"
          />
        </Row>
      </Section>
      <Section title="New transaction options">
        <T variant="caption" tone="faint">
          Dividend and Interest switches arrive with the New transaction update.
        </T>
      </Section>
      <Section title="Security">
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
            <T variant="caption" tone="muted" style={styles.gap}>
              Lock again after this long in the background
            </T>
            <SegmentedControl
              options={LOCK_TIMEOUTS.map((m) => ({ value: String(m), label: TIMEOUT_LABELS[m] }))}
              value={String(settings.lockTimeoutMinutes)}
              onChange={(v) => update({ lockTimeoutMinutes: Number(v) as LockTimeout })}
              accessibilityLabel="Lock after"
            />
          </>
        ) : null}
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
      </Section>
      <Section title="Data">
        {runs.isError ? (
          <T variant="caption" tone="muted">
            Could not read the job runs ({errorCode(runs.error)}).
          </T>
        ) : null}
        <RunLine label="Last price update" run={runs.data?.prices} loading={runs.isPending} />
        <RunLine label="Last snapshot" run={runs.data?.snapshots} loading={runs.isPending} />
        <T variant="caption" tone="muted">
          The daily price run is at 05:25 UTC, snapshots at 05:40; “partial” means some assets need
          a look (see job_runs).
        </T>
      </Section>
      <View style={styles.links}>
        <ListRow
          title="Certificados"
          leading={<Icon name="certificados" tone="muted" />}
          onPress={() => {
            closeDrawer();
            root.navigate('Certificados');
          }}
        />
        <ListRow
          title="Sign out"
          leading={<Icon name="signOut" tone="muted" />}
          onPress={signOut}
          last
        />
      </View>
      <T variant="caption" tone="faint" style={styles.footer}>
        Ledgr {Constants.expoConfig?.version ?? ''} · project {projectRef}
      </T>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 0 },
  brand: { paddingHorizontal: space.lg, marginBottom: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, gap: space.md },
  rowText: { flex: 1 },
  run: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  gap: { marginTop: space.sm },
  links: { paddingHorizontal: space.lg, marginBottom: space.lg },
  footer: { textAlign: 'center' },
});
