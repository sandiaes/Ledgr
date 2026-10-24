// The "Include certificados de aforro" setting on screen (docs/app-plan.md §10): the switch
// on the Dashboard, the note every affected screen shows while certificados are left out,
// and the empty state when nothing else is held.
import type { AssetType } from '@ledgr/core';
import { StyleSheet, View } from 'react-native';
import { useIncludeCertificados } from '../settings/SettingsProvider';
import { EmptyState } from './EmptyState';
import { Switch } from './parts';
import { T } from './T';
import { radius, space, TOUCH_TARGET, weight, type Colors } from './theme';
import { useStyles } from './ThemeProvider';

export const excludesCertificados = (excludeTypes: readonly AssetType[] | undefined) =>
  excludeTypes?.includes('certificado_aforro') ?? false;

/** The app-wide switch (top of the Dashboard). */
export function IncludeCertificadosSwitch() {
  const styles = useStyles(makeStyles);
  const [on, set] = useIncludeCertificados();
  return (
    <View style={styles.switchRow}>
      <T variant="body">Include certificados de aforro</T>
      <Switch value={on} onValueChange={set} accessibilityLabel="Include certificados de aforro" />
    </View>
  );
}

/** "Excluding certificados", when the figures below leave them out. */
export function ScopeNote({ excludeTypes }: { excludeTypes: readonly AssetType[] | undefined }) {
  const styles = useStyles(makeStyles);
  if (!excludesCertificados(excludeTypes)) return null;
  return (
    <View style={styles.note}>
      <T variant="caption" tone="warning" style={styles.noteText} testID="scope-note">
        Excluding certificados
      </T>
    </View>
  );
}

/** The ledger has rows, but none outside the certificados. */
export function NothingInScope({ what = 'holdings' }: { what?: string }) {
  return (
    <EmptyState
      icon="noMatch"
      title={`No ${what} without certificados`}
      line="Turn on “Include certificados de aforro” on the Dashboard to see them."
      testID="nothing-in-scope"
    />
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    switchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginHorizontal: space.lg,
      marginBottom: space.xs,
      minHeight: TOUCH_TARGET,
    },
    note: {
      alignSelf: 'flex-start',
      backgroundColor: colors.warningBg,
      paddingHorizontal: space.sm,
      paddingVertical: space.hairline,
      borderRadius: radius.pill,
      marginHorizontal: space.lg,
      marginBottom: space.sm,
    },
    noteText: { fontWeight: weight.semibold },
  });
