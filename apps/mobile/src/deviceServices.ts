import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import { createSupabaseData } from './data/supabaseData';
import { createDeviceSessionStorage, createSupabase } from './lib/supabase';
import type { Services } from './services';
import { SETTINGS_KEY } from './settings/settings';

/** The real services, built once the configuration passed `checkConfig`. */
export function createDeviceServices(config: {
  url: string;
  anonKey: string;
  projectRef: string;
}): Services {
  const storage = createDeviceSessionStorage();
  const supabase = createSupabase(config.url, config.anonKey, storage);
  return {
    auth: supabase.auth,
    data: createSupabaseData(supabase),
    projectRef: config.projectRef,
    clearSession: () => storage.clear(),
    device: {
      async securityLevel() {
        const level = await LocalAuthentication.getEnrolledLevelAsync();
        if (level === LocalAuthentication.SecurityLevel.NONE) return 'none';
        return level === LocalAuthentication.SecurityLevel.SECRET ? 'secret' : 'biometric';
      },
      async authenticate() {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock Ledgr',
          cancelLabel: 'Cancel',
          disableDeviceFallback: false,
        });
        return result.success;
      },
      setScreenCaptureBlocked: (blocked) =>
        blocked
          ? ScreenCapture.preventScreenCaptureAsync('ledgr')
          : ScreenCapture.allowScreenCaptureAsync('ledgr'),
    },
    settings: {
      async load() {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);
        return raw ? (JSON.parse(raw) as unknown) : null;
      },
      save: (settings) => AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)),
    },
  };
}
