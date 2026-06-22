import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDataJsonAuthStorage, type AuthStorageHost } from '../src/supabase';

function makeHost(initial: Record<string, string> = {}) {
  const saveData = vi.fn(async (_data: unknown) => {});
  const host: AuthStorageHost = { settings: { authStore: { ...initial } }, saveData };
  return { host, saveData };
}

describe('createDataJsonAuthStorage (auth session persisted in data.json)', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('setItem writes to authStore and persists via saveData', async () => {
    const { host, saveData } = makeHost();
    const storage = createDataJsonAuthStorage(host);
    await storage.setItem('sb-ref-auth-token', 'TOKEN');
    expect(host.settings.authStore?.['sb-ref-auth-token']).toBe('TOKEN');
    expect(saveData).toHaveBeenCalledWith(host.settings);
  });

  it('getItem returns the value persisted in data.json', () => {
    const { host } = makeHost({ k: 'v' });
    expect(createDataJsonAuthStorage(host).getItem('k')).toBe('v');
  });

  it('getItem migrates a legacy window.localStorage session into data.json (one-time)', () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (key: string) => (key === 'legacy' ? 'LEGACY_TOKEN' : null) },
    };
    const { host, saveData } = makeHost();
    const storage = createDataJsonAuthStorage(host);
    expect(storage.getItem('legacy')).toBe('LEGACY_TOKEN');
    // Seeded into data.json so future loads no longer depend on localStorage.
    expect(host.settings.authStore?.['legacy']).toBe('LEGACY_TOKEN');
    expect(saveData).toHaveBeenCalled();
  });

  it('getItem returns null when the key is in neither store', () => {
    const { host } = makeHost();
    expect(createDataJsonAuthStorage(host).getItem('missing')).toBeNull();
  });

  it('removeItem deletes the key and persists', async () => {
    const { host, saveData } = makeHost({ k: 'v' });
    const storage = createDataJsonAuthStorage(host);
    await storage.removeItem('k');
    expect(host.settings.authStore?.['k']).toBeUndefined();
    expect(saveData).toHaveBeenCalled();
  });
});
