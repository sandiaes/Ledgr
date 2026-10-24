import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { useSettings } from '../settings/SettingsProvider';
import type { AppearancePreference } from '../settings/settings';
import { themes, type Colors, type Scheme } from './theme';

interface ThemeValue {
  colors: Colors;
  /** The theme in use: the chosen one, or the phone's for "System". */
  scheme: Scheme;
  appearance: AppearancePreference;
}

const ThemeContext = createContext<ThemeValue>({
  colors: themes.light,
  scheme: 'light',
  appearance: 'system',
});

/** The theme actually shown for a preference, given the phone's current scheme. */
export function resolveScheme(
  appearance: AppearancePreference,
  system: string | null | undefined,
): Scheme {
  if (appearance === 'light' || appearance === 'dark') return appearance;
  return system === 'dark' ? 'dark' : 'light';
}

/**
 * Chooses the colours from the saved Appearance setting. Sits inside `SettingsProvider`,
 * which renders nothing until the setting is read, so the first frame already has the right
 * theme. "System" follows the phone live: `useColorScheme` re-renders when it changes.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const system = useColorScheme();
  const appearance = settings.appearance;
  const scheme = resolveScheme(appearance, system);

  // Native widgets (dialogs, the keyboard, date pickers) follow the same choice.
  useEffect(() => {
    Appearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance);
  }, [appearance]);

  const value = useMemo(
    () => ({ colors: themes[scheme], scheme, appearance }),
    [scheme, appearance],
  );

  // The window behind the app, so no flash of the other theme while a screen mounts.
  const { background } = value.colors;
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(background).catch(() => undefined);
  }, [background]);

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <NavigationBar style={scheme === 'dark' ? 'dark' : 'light'} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

export function useColors(): Colors {
  return useContext(ThemeContext).colors;
}

/** `const styles = useStyles(makeStyles)`: a StyleSheet built from the current colours. */
export function useStyles<T>(make: (colors: Colors) => T): T {
  const colors = useColors();
  // `make` is a module-level factory, so the colours are the only input.
  return useMemo(() => make(colors), [colors]);
}

/** "dark" / "light" for props that take a keyboard or similar appearance. */
export function useKeyboardAppearance(): Scheme {
  return useContext(ThemeContext).scheme;
}
