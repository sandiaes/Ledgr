// Supabase's session storage on the phone. SecureStore (Android Keystore) holds values of
// about 2 KB at most, and an MFA-upgraded session is larger, so only a random 256-bit key
// lives in SecureStore; the session JSON is encrypted with AES-256-GCM (random 96-bit
// nonce per write) and the ciphertext kept in AsyncStorage. Anything that does not
// decrypt (missing or wrong key, tampered data, a restored backup) reads as "no session":
// the owner signs in again, the app never crashes on it.
import { gcm } from '@noble/ciphers/aes';
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils';

export interface KeyStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface BlobStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

/** The storage interface supabase-js expects, plus a full wipe for sign-out. */
export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Deletes every stored session item and the key. */
  clear(): Promise<void>;
}

export const KEY_NAME = 'ledgr.session.key';
export const PREFIX = 'ledgr.session.';
const VERSION = 'v1';

// Hermes has TextEncoder but not always TextDecoder.
const utf8 = {
  encode: (text: string) => new TextEncoder().encode(text),
  decode: (bytes: Uint8Array) =>
    decodeURIComponent(Array.from(bytes, (b) => `%${b.toString(16).padStart(2, '0')}`).join('')),
};

export function createSessionStorage(deps: {
  keys: KeyStore;
  blobs: BlobStore;
  randomBytes: (n: number) => Uint8Array;
}): SessionStorage {
  const { keys, blobs, randomBytes } = deps;

  async function readKey(): Promise<Uint8Array | null> {
    const hex = await keys.get(KEY_NAME);
    if (!hex || !/^[0-9a-f]{64}$/.test(hex)) return null;
    return hexToBytes(hex);
  }

  async function writeKey(): Promise<Uint8Array> {
    const existing = await readKey();
    if (existing) return existing;
    const key = randomBytes(32);
    await keys.set(KEY_NAME, bytesToHex(key));
    return key;
  }

  return {
    async getItem(name) {
      const stored = await blobs.getItem(PREFIX + name);
      if (!stored) return null;
      try {
        const [version, nonceHex, dataHex] = stored.split(':');
        const key = await readKey();
        if (version !== VERSION || !key || !nonceHex || !dataHex) throw new Error('unreadable');
        return utf8.decode(gcm(key, hexToBytes(nonceHex)).decrypt(hexToBytes(dataHex)));
      } catch {
        await blobs.removeItem(PREFIX + name);
        return null;
      }
    },

    async setItem(name, value) {
      const key = await writeKey();
      const nonce = randomBytes(12);
      const data = gcm(key, nonce).encrypt(utf8.encode(value));
      await blobs.setItem(PREFIX + name, `${VERSION}:${bytesToHex(nonce)}:${bytesToHex(data)}`);
    },

    async removeItem(name) {
      await blobs.removeItem(PREFIX + name);
    },

    async clear() {
      const all = await blobs.getAllKeys();
      await blobs.multiRemove(all.filter((k) => k.startsWith(PREFIX)));
      await keys.remove(KEY_NAME);
    },
  };
}
