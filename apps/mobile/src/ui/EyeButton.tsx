import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';
import { useHideValues } from '../settings/SettingsProvider';
import { space } from './theme';
import { useColors } from './ThemeProvider';

/** Hide / show every amount (the same toggle as in More). */
export function EyeButton() {
  const [hidden, toggle] = useHideValues();
  const colors = useColors();
  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={hidden ? 'Show values' : 'Hide values'}
      hitSlop={12}
      style={{ paddingHorizontal: space.lg }}
    >
      <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.text} />
    </Pressable>
  );
}
