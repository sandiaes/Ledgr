import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconRole } from '../ui/Icon';
import { T } from '../ui/T';
import { radius, TOUCH_TARGET, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';

/** The slot of the New transaction tab. */
export const NEW_TAB = 'New';
/** The accent circle's diameter. */
export const NEW_BUTTON_SIZE = 56;
/**
 * The ring in the screen colour around the circle, and how far the ring's edge stands above
 * the bar. The circle itself then has 48 dp left inside the bar, which is all Android
 * delivers touches to: the 48 dp touch target holds.
 */
const RING = 4;
const RAISED = 12;

const TABS: Record<string, { icon: IconRole; label: string }> = {
  Dashboard: { icon: 'dashboard', label: 'Dashboard' },
  Positions: { icon: 'positions', label: 'Positions' },
  Activity: { icon: 'activity', label: 'Activity' },
  Calculator: { icon: 'calculator', label: 'Calculator' },
};

/** True while the keyboard is up: the bar steps aside and the form gets the room. */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/**
 * The bottom bar: Dashboard, Positions, New transaction, Activity, Calculator in five equal
 * slots (docs/design.md §6.3). New transaction is a raised round accent button without a
 * label; the rest are an icon and a label, `text` when active and `faint` when not.
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  if (keyboard) return null;

  return (
    <View
      style={[styles.bar, { paddingBottom: insets.bottom }]}
      accessibilityRole="tablist"
      testID="tab-bar"
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const press = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        if (route.name === NEW_TAB) {
          return (
            <View key={route.key} style={styles.slot}>
              <View style={styles.ring} testID="new-transaction-ring">
                <Pressable
                  onPress={press}
                  accessibilityRole="button"
                  accessibilityLabel="New transaction"
                  accessibilityState={{ selected: focused }}
                  style={styles.newButton}
                  testID="new-transaction-button"
                >
                  <Icon name="add" size={28} tone="onAccent" />
                </Pressable>
              </View>
            </View>
          );
        }
        const tab = TABS[route.name];
        if (!tab) return null;
        return (
          <Pressable
            key={route.key}
            onPress={press}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: focused }}
            style={styles.slot}
          >
            <Icon name={tab.icon} tone={focused ? 'text' : 'faint'} />
            <T variant="caption" tone={focused ? 'text' : 'faint'} numberOfLines={1}>
              {tab.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      backgroundColor: colors.tabBar.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.tabBar.border,
    },
    slot: {
      flex: 1,
      height: 56,
      minHeight: TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    // A ring in the screen colour separates the circle from the bar; the circle stands
    // `RAISED` dp above the bar's top edge (a translation, no shadow).
    ring: {
      width: NEW_BUTTON_SIZE + 2 * RING,
      height: NEW_BUTTON_SIZE + 2 * RING,
      borderRadius: radius.pill,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      transform: [{ translateY: -(RAISED - RING) }],
    },
    newButton: {
      width: NEW_BUTTON_SIZE,
      height: NEW_BUTTON_SIZE,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
