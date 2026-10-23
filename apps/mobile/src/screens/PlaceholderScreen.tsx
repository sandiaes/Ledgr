import { StyleSheet, Text, View } from 'react-native';
import { colors, space } from '../ui/theme';

/** Tabs not built yet (slices 5b and 5c). */
export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>Coming in a later version.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  title: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: space.sm },
  text: { color: colors.muted },
});
