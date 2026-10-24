import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useRootNavigation, type RootStackParams } from '../navigation';
import { Card } from '../ui/parts';
import { colors, space } from '../ui/theme';

function Link(props: { label: string; to: keyof RootStackParams; children?: ReactNode }) {
  const navigation = useRootNavigation();
  return (
    <Pressable
      onPress={() => navigation.navigate(props.to as never)}
      accessibilityRole="link"
      style={styles.row}
    >
      <Text style={[styles.label, styles.rowText]}>{props.label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/** Certificados, the portfolio screens and Settings. */
export function MoreScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card title="Portfolio">
        <Link label="Certificados" to="Certificados" />
        <Link label="Allocation" to="Allocation" />
        <Link label="Performance" to="Performance" />
        <Link label="Closed positions" to="ClosedPositions" />
      </Card>
      <Card>
        <Link label="Settings" to="Settings" />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.lg, paddingBottom: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, gap: space.md },
  rowText: { flex: 1 },
  label: { fontSize: 15, color: colors.text },
  chevron: { fontSize: 20, color: colors.muted },
});
