// The "Include certificados de aforro" setting on screen (docs/app-plan.md §10): the switch
// on the Dashboard, the note every affected screen shows while certificados are left out,
// and the empty state when nothing else is held.
import type { AssetType } from '@ledgr/core';
import { StyleSheet, Text, View } from 'react-native';
import { useIncludeCertificados } from '../settings/SettingsProvider';
import { Card, Switch } from './parts';
import { T } from './T';
import { space, type Colors } from './theme';
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
    <Text style={styles.note} testID="scope-note">
      Excluding certificados
    </Text>
  );
}

/** The ledger has rows, but none outside the certificados. */
export function NothingInScope({ what = 'holdings' }: { what?: string }) {
  const styles = useStyles(makeStyles);
  return (
    <Card>
      <Text style={styles.muted}>
        No {what} without certificados. Turn on “Include certificados de aforro” on the Dashboard to
        see them.
      </Text>
    </Card>
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
    },
    label: { color: colors.text, fontSize: 14 },
    note: {
      alignSelf: 'flex-start',
      color: colors.warningText,
      backgroundColor: colors.warningBg,
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: space.sm,
      paddingVertical: 2,
      borderRadius: 10,
      overflow: 'hidden',
      marginHorizontal: space.lg,
      marginBottom: space.sm,
    },
    muted: { color: colors.muted, fontSize: 13 },
  });
