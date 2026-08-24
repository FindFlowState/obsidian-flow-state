import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createDataJsonAuthStorage,
  deviceAuthScope,
  deviceId,
  platformAuthScope,
  type AuthStorageHost,
  type LocalStorageHost,
} from '../src/supabase';

const KEY = 'sb-ref-auth-token';

/** A vault-local store standing in for one machine's Obsidian app storage. */
function fakeApp(): LocalStorageHost & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    loadLocalStorage: (key) => data.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      data.set(key, value);
    },
  };
}

function fakeWindowLocalStorage() {
  const data = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    },
  };
  return data;
}

/** One synced `data.json`, shared by every device in a test. */
function sharedVault(initial: Record<string, string> = {}) {
  const settings = { authStore: { ...initial } };
  const saveData = vi.fn(async (_data: unknown) => {});
  return { settings, saveData };
}

/** A device attached to the shared vault, with its own vault-local storage. */
function device(vault: ReturnType<typeof sharedVault>, app: LocalStorageHost) {
  const host: AuthStorageHost = { settings: vault.settings, saveData: vault.saveData, app };
  return createDataJsonAuthStorage(host, deviceAuthScope(app));
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('deviceId', () => {
  it('mints an id and returns the same one on every later call', () => {
    const app = fakeApp();
    const first = deviceId(app);
    expect(first).toBeTruthy();
    expect(deviceId(app)).toBe(first);
  });

  it('gives two machines different ids', () => {
    expect(deviceId(fakeApp())).not.toBe(deviceId(fakeApp()));
  });

  it('prefers Obsidian vault-local storage over window.localStorage', () => {
    fakeWindowLocalStorage();
    const app = fakeApp();
    const id = deviceId(app);
    expect(app.data.get('flow-state:device-id')).toBe(id);
  });

  it('falls back to window.localStorage on Obsidian older than 1.8.7', () => {
    // loadLocalStorage/saveLocalStorage are @since 1.8.7; minAppVersion is 1.4.10.
    const store = fakeWindowLocalStorage();
    const id = deviceId({});
    expect(id).toBeTruthy();
    expect(store.get('flow-state:device-id')).toBe(id);
  });

  it('returns null when no store can persist anything', () => {
    // No app storage, no window — nothing to write an id to.
    expect(deviceId({})).toBeNull();
  });

  it('returns null when a store silently drops the write', () => {
    // An id we cannot read back would differ on the next launch, which would
    // sign the user out every time. Better to report none.
    const id = deviceId({ loadLocalStorage: () => null, saveLocalStorage: () => {} });
    expect(id).toBeNull();
  });

  it('survives a store that throws', () => {
    const store = fakeWindowLocalStorage();
    const id = deviceId({
      loadLocalStorage: () => {
        throw new Error('unavailable');
      },
      saveLocalStorage: () => {
        throw new Error('unavailable');
      },
    });
    expect(id).toBeTruthy();
    expect(store.get('flow-state:device-id')).toBe(id);
  });
});

describe('deviceAuthScope', () => {
  it('carries the platform and this machine s id', () => {
    const app = fakeApp();
    expect(deviceAuthScope(app)).toBe(`${platformAuthScope()}-${deviceId(app)}`);
  });

  it('is stable across calls on one machine', () => {
    const app = fakeApp();
    expect(deviceAuthScope(app)).toBe(deviceAuthScope(app));
  });

  it('degrades to the platform scope when no id can be persisted', () => {
    expect(deviceAuthScope({})).toBe(platformAuthScope());
  });
});

// The bug: two Macs on one synced vault shared the `desktop::` slot. Supabase
// rotates the refresh token on every refresh and revokes the previous one, so
// whichever refreshed second got "Invalid Refresh Token: Already Used".
describe('two same-platform devices on one synced vault', () => {
  it('keeps their sessions in separate slots', async () => {
    const vault = sharedVault();
    const macA = device(vault, fakeApp());
    const macB = device(vault, fakeApp());

    await macA.setItem(KEY, 'TOKEN_A');
    await macB.setItem(KEY, 'TOKEN_B');

    expect(macA.getItem(KEY)).toBe('TOKEN_A');
    expect(macB.getItem(KEY)).toBe('TOKEN_B');
  });

  it('survives a rotation round that used to sign one of them out', async () => {
    const vault = sharedVault();
    const macA = device(vault, fakeApp());
    const macB = device(vault, fakeApp());
    await macA.setItem(KEY, 'rt-A-1');
    await macB.setItem(KEY, 'rt-B-1');

    // Each refresh writes the rotated token back to storage, and the synced
    // data.json is immediately visible to the other machine.
    await macA.setItem(KEY, 'rt-A-2');
    await macB.setItem(KEY, 'rt-B-2');
    await macA.setItem(KEY, 'rt-A-3');

    // Neither device is holding a token the other already rotated away.
    expect(macA.getItem(KEY)).toBe('rt-A-3');
    expect(macB.getItem(KEY)).toBe('rt-B-2');
  });

  it('signing out on one leaves the other signed in', async () => {
    const vault = sharedVault();
    const macA = device(vault, fakeApp());
    const macB = device(vault, fakeApp());
    await macA.setItem(KEY, 'TOKEN_A');
    await macB.setItem(KEY, 'TOKEN_B');

    await macA.removeItem(KEY);

    expect(macA.getItem(KEY)).toBeNull();
    expect(macB.getItem(KEY)).toBe('TOKEN_B');
  });

  it('reproduces the fight when both share one slot (pre-fix behaviour)', async () => {
    // Same two devices, but scoped by platform alone as before this change.
    const vault = sharedVault();
    const shared = (): ReturnType<typeof createDataJsonAuthStorage> =>
      createDataJsonAuthStorage(
        { settings: vault.settings, saveData: vault.saveData },
        platformAuthScope()
      );
    const macA = shared();
    const macB = shared();

    await macA.setItem(KEY, 'rt-A-1');
    await macB.setItem(KEY, 'rt-B-1');

    // Mac A's session is gone — it now reads Mac B's token, refreshes with it,
    // and Supabase revokes the family. This is what Rob was hitting.
    expect(macA.getItem(KEY)).toBe('rt-B-1');
  });
});

describe('upgrading from the platform-only scope', () => {
  it('a lone device adopts its old session and stays signed in', () => {
    const legacy = platformAuthScope();
    const vault = sharedVault({ [`${legacy}::${KEY}`]: 'EXISTING' });
    const mac = device(vault, fakeApp());

    expect(mac.getItem(KEY)).toBe('EXISTING');
    // Claimed into this device's own slot, so the next launch reads it directly.
    expect(vault.settings.authStore[`${legacy}::${KEY}`]).toBeUndefined();
    expect(mac.getItem(KEY)).toBe('EXISTING');
  });

  it('the first of two devices keeps the session, the second signs in once', async () => {
    const legacy = platformAuthScope();
    const vault = sharedVault({ [`${legacy}::${KEY}`]: 'EXISTING' });
    const macA = device(vault, fakeApp());
    const macB = device(vault, fakeApp());

    expect(macA.getItem(KEY)).toBe('EXISTING');
    // Mac B signs in once rather than adopting the same token and fighting.
    expect(macB.getItem(KEY)).toBeNull();

    await macB.setItem(KEY, 'FRESH');
    expect(macA.getItem(KEY)).toBe('EXISTING');
    expect(macB.getItem(KEY)).toBe('FRESH');
  });

  it('a phone does not adopt a desktop session', () => {
    const vault = sharedVault({ [`desktop::${KEY}`]: 'DESKTOP_TOKEN' });
    const phone = createDataJsonAuthStorage(
      { settings: vault.settings, saveData: vault.saveData },
      'mobile-phone-id',
      'mobile'
    );
    expect(phone.getItem(KEY)).toBeNull();
  });

  it('still adopts the unscoped entry written before any namespacing', () => {
    const vault = sharedVault({ [KEY]: 'ANCIENT' });
    const mac = device(vault, fakeApp());
    expect(mac.getItem(KEY)).toBe('ANCIENT');
    expect(vault.settings.authStore[KEY]).toBeUndefined();
  });

  it('does not sign the user out when the device id cannot be persisted', () => {
    // Scope collapses to the platform slot, which is where the session already is.
    const legacy = platformAuthScope();
    const vault = sharedVault({ [`${legacy}::${KEY}`]: 'EXISTING' });
    const host: AuthStorageHost = { settings: vault.settings, saveData: vault.saveData, app: {} };
    const mac = createDataJsonAuthStorage(host, deviceAuthScope(host.app));
    expect(mac.getItem(KEY)).toBe('EXISTING');
  });
});
