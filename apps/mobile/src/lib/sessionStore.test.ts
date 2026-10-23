import { randomBytes } from 'node:crypto';
import { createSessionStorage, KEY_NAME, PREFIX } from './sessionStore';

function stores() {
  const keys = new Map<string, string>();
  const blobs = new Map<string, string>();
  const storage = createSessionStorage({
    keys: {
      get: async (n) => keys.get(n) ?? null,
      set: async (n, v) => void keys.set(n, v),
      remove: async (n) => void keys.delete(n),
    },
    blobs: {
      getItem: async (k) => blobs.get(k) ?? null,
      setItem: async (k, v) => void blobs.set(k, v),
      removeItem: async (k) => void blobs.delete(k),
      getAllKeys: async () => [...blobs.keys()],
      multiRemove: async (ks) => ks.forEach((k) => blobs.delete(k)),
    },
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
  });
  return { storage, keys, blobs };
}

// Larger than SecureStore's ~2 KB limit, with non-ASCII text.
const session = JSON.stringify({ access_token: 'x'.repeat(3000), user: { name: 'João' } });

describe('encrypted session storage', () => {
  it('round-trips a large session; only the key is in SecureStore', async () => {
    const { storage, keys, blobs } = stores();
    await storage.setItem('sb-auth-token', session);
    expect(await storage.getItem('sb-auth-token')).toBe(session);
    expect(keys.get(KEY_NAME)).toMatch(/^[0-9a-f]{64}$/);
    const stored = blobs.get(`${PREFIX}sb-auth-token`) ?? '';
    expect(stored).not.toContain('access_token');
    expect(stored).not.toContain('Jo');
  });

  it('uses a new nonce on every write', async () => {
    const { storage, blobs } = stores();
    await storage.setItem('k', session);
    const first = blobs.get(`${PREFIX}k`);
    await storage.setItem('k', session);
    expect(blobs.get(`${PREFIX}k`)).not.toBe(first);
  });

  it('reads tampered data, a lost key or garbage as "no session"', async () => {
    const { storage, keys, blobs } = stores();
    await storage.setItem('k', session);
    const stored = blobs.get(`${PREFIX}k`) as string;
    blobs.set(`${PREFIX}k`, stored.slice(0, -2) + (stored.endsWith('00') ? '11' : '00'));
    expect(await storage.getItem('k')).toBeNull();

    await storage.setItem('k', session);
    keys.delete(KEY_NAME);
    expect(await storage.getItem('k')).toBeNull();

    blobs.set(`${PREFIX}k`, 'not-ours');
    expect(await storage.getItem('k')).toBeNull();
  });

  it('clear() removes every session item and the key', async () => {
    const { storage, keys, blobs } = stores();
    await storage.setItem('a', session);
    await storage.setItem('b', session);
    blobs.set('ledgr.settings.v1', '{}');
    await storage.clear();
    expect([...blobs.keys()]).toEqual(['ledgr.settings.v1']);
    expect(keys.size).toBe(0);
  });
});
