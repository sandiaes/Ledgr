import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { useDrawerStatus } from '@react-navigation/drawer';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useEffect } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../ui/T';
import { space } from '../ui/theme';
import { useColors } from '../ui/ThemeProvider';
import { useHeaderState } from './HeaderState';
import { HeaderBar, HeaderPanel } from './TopBar';

/**
 * The bar above the content and the expandable panel over it, in one box so the panel can
 * overlay the screen without re-laying it out (docs/design.md §6.1).
 *
 * Android back: while this frame's screen is in front, a press closes the drawer if it is
 * open, else collapses the expanded header, else is left to the navigator (leave the
 * screen). The drawer is checked here explicitly rather than trusting the order in which
 * React Navigation and this handler were registered.
 */
function Frame(props: {
  mode: 'menu' | 'back';
  onLeading(): void;
  drawerOpen?: boolean;
  closeDrawer?: () => void;
  title?: string;
  children: ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { expanded, setExpanded } = useHeaderState();
  const { drawerOpen, closeDrawer } = props;

  useEffect(() => {
    if (!focused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawerOpen) {
        closeDrawer?.();
        return true;
      }
      if (expanded) {
        setExpanded(false);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [focused, drawerOpen, closeDrawer, expanded, setExpanded]);

  return (
    <View style={[styles.frame, { backgroundColor: colors.background }]}>
      <HeaderBar mode={props.mode} onLeading={props.onLeading} />
      {props.title ? (
        <T variant="title2" accessibilityRole="header" style={styles.title}>
          {props.title}
        </T>
      ) : null}
      {/* The tab bar clears the system navigation bar for the tabs; a pushed screen must. */}
      <View style={[styles.body, props.mode === 'back' && { paddingBottom: insets.bottom }]}>
        {props.children}
      </View>
      <HeaderPanel />
    </View>
  );
}

/** The layout of the tab screens, inside the drawer: menu button on the left. */
export function MenuFrame({ children }: { children: ReactNode }) {
  const navigation = useNavigation<DrawerNavigationProp<Record<string, undefined>>>();
  const drawerOpen = useDrawerStatus() === 'open';
  const openDrawer = useCallback(() => navigation.openDrawer(), [navigation]);
  const closeDrawer = useCallback(() => navigation.closeDrawer(), [navigation]);
  return (
    <Frame mode="menu" onLeading={openDrawer} drawerOpen={drawerOpen} closeDrawer={closeDrawer}>
      {children}
    </Frame>
  );
}

function BackFrame(props: { title: string; children: ReactNode }) {
  const navigation = useNavigation();
  return (
    <Frame mode="back" title={props.title} onLeading={() => navigation.goBack()}>
      {props.children}
    </Frame>
  );
}

/** A pushed detail screen with the shared header in back mode and an in-content title. */
export function withBackFrame<P extends object>(
  Screen: ComponentType<P>,
  title: string,
): ComponentType<P> {
  function Framed(props: P) {
    return (
      <BackFrame title={title}>
        <Screen {...props} />
      </BackFrame>
    );
  }
  Framed.displayName = `BackFrame(${Screen.displayName ?? Screen.name})`;
  return Framed;
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  body: { flex: 1 },
  title: { paddingHorizontal: space.lg, paddingTop: space.md },
});
