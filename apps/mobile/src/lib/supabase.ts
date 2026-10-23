import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { createSessionStorage, type SessionStorage } from './sessionStore';

export function createDeviceSessionStorage(): SessionStorage {
  return createSessionStorage({
    keys: {
      get: (name) => SecureStore.getItemAsync(name),
      set: (name, value) => SecureStore.setItemAsync(name, value),
      remove: (name) => SecureStore.deleteItemAsync(name),
    },
    blobs: {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      removeItem: (key) => AsyncStorage.removeItem(key),
      getAllKeys: () => AsyncStorage.getAllKeys(),
      multiRemove: (keys) => AsyncStorage.multiRemove([...keys]),
    },
    randomBytes: (n) => getRandomBytes(n),
  });
}

/** The one Supabase client: anon key, session in the encrypted store. */
export function createSupabase(url: string, anonKey: string, storage: SessionStorage) {
  const client = createClient(url, anonKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  });
  // Refresh tokens only while the app is in the foreground (Supabase's React Native pattern).
  const follow = (state: string | null | undefined) =>
    state === 'active' ? client.auth.startAutoRefresh() : client.auth.stopAutoRefresh();
  AppState.addEventListener('change', follow);
  follow(AppState.currentState);
  return client;
}

export type Supabase = SupabaseClient;
