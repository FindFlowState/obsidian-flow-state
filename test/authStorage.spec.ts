import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDataJsonAuthStorage, deviceAuthScope, type AuthStorageHost } from '../src/supabase';

const SCOPE = 'desktop';
const KEY = 'sb-ref-auth-token';

function makeHost(initial: Record<string, string> = {}) {
  const saveData = vi.fn(async (_data: unknown) => {});
  const host: AuthStorageHost = { settings: { authStore: { ...initial } }, saveData };
  return { host, saveData };
}

describe('createDataJsonAuthStorage (auth session persisted in data.json)', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('setItem writes to authStore under this device\'s scope and persists via saveData', async () => {
    const { host, saveData } = makeHost();
    const storage = createDataJsonAuthStorage(host, SCOPE);
    await storage.setItem(KEY, 'TOKEN');
    expect(host.settings.authStore?.[`${SCOPE}::${KEY}`]).toBe('TOKEN');
    expect(saveData).toHaveBeenCalledWith(host.settings);
  });

  it('getItem returns the value persisted in data.json', () => {
    const { host } = makeHost({ [`${SCOPE}::k`]: 'v' });
    expect(createDataJsonAuthStorage(host, SCOPE).getItem('k')).toBe('v');
  });

  it('getItem migrates a legacy window.localStorage session into data.json (one-time)', () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (key: string) => (key === 'legacy' ? 'LEGACY_TOKEN' : null) },
    };
    const { host, saveData } = makeHost();
    const storage = createDataJsonAuthStorage(host, SCOPE);
    expect(storage.getItem('legacy')).toBe('LEGACY_TOKEN');
    // Seeded into data.json so future loads no longer depend on localStorage.
    expect(host.settings.authStore?.[`${SCOPE}::legacy`]).toBe('LEGACY_TOKEN');
    expect(saveData).toHaveBeenCalled();
  });

  it('getItem returns null when the key is in neither store', () => {
    const { host } = makeHost();
    expect(createDataJsonAuthStorage(host, SCOPE).getItem('missing')).toBeNull();
  });

  it('removeItem deletes the key and persists', async () => {
    const { host, saveData } = makeHost({ [`${SCOPE}::k`]: 'v' });
    const storage = createDataJsonAuthStorage(host, SCOPE);
    await storage.removeItem('k');
    expect(host.settings.authStore?.[`${SCOPE}::k`]).toBeUndefined();
    expect(saveData).toHaveBeenCalled();
  });
});

// data.json travels between devices via Obsidian Sync. Supabase rotates the
// refresh token on every refresh and revokes the old one, so two devices on one
// token sign each other out.
describe('device scoping (shared data.json across synced devices)', () => {
  it('keeps mobile and desktop sessions apart in one shared authStore', async () => {
    const { host } = makeHost();
    const phone = createDataJsonAuthStorage(host, 'mobile');
    const desktop = createDataJsonAuthStorage(host, 'desktop');

    await phone.setItem(KEY, 'PHONE_TOKEN');
    await desktop.setItem(KEY, 'DESKTOP_TOKEN');

    // Neither device's refresh clobbers the other's session.
    expect(phone.getItem(KEY)).toBe('PHONE_TOKEN');
    expect(desktop.getItem(KEY)).toBe('DESKTOP_TOKEN');
  });

  it('signing out on one device leaves the other signed in', async () => {
    const { host } = makeHost();
    const phone = createDataJsonAuthStorage(host, 'mobile');
    const desktop = createDataJsonAuthStorage(host, 'desktop');
    await phone.setItem(KEY, 'PHONE_TOKEN');
    await desktop.setItem(KEY, 'DESKTOP_TOKEN');

    await desktop.removeItem(KEY);

    expect(desktop.getItem(KEY)).toBeNull();
    expect(phone.getItem(KEY)).toBe('PHONE_TOKEN');
  });

  it('claims an unscoped entry written before namespacing, and drops the shared copy', () => {
    const { host, saveData } = makeHost({ [KEY]: 'SHARED_TOKEN' });
    const phone = createDataJsonAuthStorage(host, 'mobile');

    expect(phone.getItem(KEY)).toBe('SHARED_TOKEN');
    expect(host.settings.authStore?.[`mobile::${KEY}`]).toBe('SHARED_TOKEN');
    // Removed, so the desktop can't adopt the same session and start a
    // rotation fight with the phone.
    expect(host.settings.authStore?.[KEY]).toBeUndefined();
    expect(saveData).toHaveBeenCalled();

    const desktop = createDataJsonAuthStorage(host, 'desktop');
    expect(desktop.getItem(KEY)).toBeNull();
  });

  it('scopes by platform', () => {
    // Platform.isMobile is false in the test mock.
    expect(deviceAuthScope()).toBe('desktop');
  });
});
