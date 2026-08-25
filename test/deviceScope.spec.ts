import { describe, it, expect, vi } from 'vitest';
import {
  createDataJsonAuthStorage,
  deviceAuthScope,
  deviceId,
  platformAuthScope,
  type AuthStorageHost,
  type LocalStorageHost,
} from '../src/supabase';

const KEY = 'sb-ref-auth-token';
const ID_KEY = 'flow-state:device-id';

/**
 * One machine's Obsidian app storage — vault-local, never synced. `appId` is
 * Obsidian's per-install id; omit it to model it being unavailable.
 */
function fakeApp(appId?: string): LocalStorageHost & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    appId,
    loadLocalStorage: (key) => data.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      data.set(key, value);
    },
  };
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

describe('deviceId', () => {
  it('seeds from Obsidian s install id when there is nothing stored', () => {
    const app = fakeApp('install-abc');
    expect(deviceId(app)).toBe('install-abc');
    // Persisted, so a later launch reads it back directly.
    expect(app.data.get(ID_KEY)).toBe('install-abc');
  });

  it('re-derives the same id after storage is cleared', () => {
    const app = fakeApp('install-abc');
    const first = deviceId(app);
    app.data.clear();
    // The whole point of seeding: the device lands back on its own slot rather
    // than a fresh one, so the user isn't signed out.
    expect(deviceId(app)).toBe(first);
  });

  it('lets a stored id win over a changed install id', () => {
    const app = fakeApp('install-abc');
    deviceId(app);
    const moved = { ...app, appId: 'install-CHANGED' };
    // appId is undocumented, so it must never be able to move a device that
    // already has a slot.
    expect(deviceId(moved)).toBe('install-abc');
  });

  it('mints a random id when no install id is available', () => {
    const app = fakeApp();
    const id = deviceId(app);
    expect(id).toBeTruthy();
    expect(app.data.get(ID_KEY)).toBe(id);
    expect(deviceId(app)).toBe(id);
  });

  it('gives two machines different ids', () => {
    expect(deviceId(fakeApp('install-a'))).not.toBe(deviceId(fakeApp('install-b')));
    expect(deviceId(fakeApp())).not.toBe(deviceId(fakeApp()));
  });

  it('returns null when a minted id silently fails to persist', () => {
    // An id we cannot read back would differ on the next launch, which would
    // sign the user out every time. Better to report none.
    expect(deviceId({ loadLocalStorage: () => null, saveLocalStorage: () => {} })).toBeNull();
  });

  it('still trusts a seeded id that fails to persist', () => {
    // Unlike a minted id, this one is re-derivable from appId next launch.
    const id = deviceId({
      appId: 'install-abc',
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    });
    expect(id).toBe('install-abc');
  });

  it('returns null when storage throws, and when there is no app at all', () => {
    const throwing: LocalStorageHost = {
      loadLocalStorage: () => {
        throw new Error('unavailable');
      },
      saveLocalStorage: () => {
        throw new Error('unavailable');
      },
    };
    expect(deviceId(throwing)).toBeNull();
    expect(deviceId(undefined)).toBeNull();
  });
});

describe('deviceAuthScope', () => {
  it('carries the platform and this machine s id', () => {
    const app = fakeApp('install-abc');
    expect(deviceAuthScope(app)).toBe(`${platformAuthScope()}-install-abc`);
  });

  it('is stable across calls on one machine', () => {
    const app = fakeApp();
    expect(deviceAuthScope(app)).toBe(deviceAuthScope(app));
  });

  it('degrades to the platform scope when no id can be established', () => {
    expect(deviceAuthScope(undefined)).toBe(platformAuthScope());
  });
});

// The bug: two Macs on one synced vault shared the `desktop::` slot. Supabase
// rotates the refresh token on every refresh and revokes the previous one, so
// whichever refreshed second got "Invalid Refresh Token: Already Used".
describe('two same-platform devices on one synced vault', () => {
  it('keeps their sessions in separate slots', async () => {
    const vault = sharedVault();
    const macA = device(vault, fakeApp('install-a'));
    const macB = device(vault, fakeApp('install-b'));

    await macA.setItem(KEY, 'TOKEN_A');
    await macB.setItem(KEY, 'TOKEN_B');

    expect(macA.getItem(KEY)).toBe('TOKEN_A');
    expect(macB.getItem(KEY)).toBe('TOKEN_B');
  });

  it('survives a rotation round that used to sign one of them out', async () => {
    const vault = sharedVault();
    const macA = device(vault, fakeApp('install-a'));
    const macB = device(vault, fakeApp('install-b'));
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
    const macA = device(vault, fakeApp('install-a'));
    const macB = device(vault, fakeApp('install-b'));
    await macA.setItem(KEY, 'TOKEN_A');
    await macB.setItem(KEY, 'TOKEN_B');

    await macA.removeItem(KEY);

    expect(macA.getItem(KEY)).toBeNull();
    expect(macB.getItem(KEY)).toBe('TOKEN_B');
  });

  it('reproduces the fight when both share one slot (pre-fix behaviour)', async () => {
    // Same two devices, but scoped by platform alone as before this change.
    const vault = sharedVault();
    const shared = () =>
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
    const mac = device(vault, fakeApp('install-a'));

    expect(mac.getItem(KEY)).toBe('EXISTING');
    // Claimed into this device's own slot, so the next launch reads it directly.
    expect(vault.settings.authStore[`${legacy}::${KEY}`]).toBeUndefined();
    expect(mac.getItem(KEY)).toBe('EXISTING');
  });

  it('the first of two devices keeps the session, the second signs in once', async () => {
    const legacy = platformAuthScope();
    const vault = sharedVault({ [`${legacy}::${KEY}`]: 'EXISTING' });
    const macA = device(vault, fakeApp('install-a'));
    const macB = device(vault, fakeApp('install-b'));

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
    const mac = device(vault, fakeApp('install-a'));
    expect(mac.getItem(KEY)).toBe('ANCIENT');
    expect(vault.settings.authStore[KEY]).toBeUndefined();
  });

  it('does not sign the user out when no device id can be established', () => {
    // Scope collapses to the platform slot, which is where the session already is.
    const legacy = platformAuthScope();
    const vault = sharedVault({ [`${legacy}::${KEY}`]: 'EXISTING' });
    const host: AuthStorageHost = { settings: vault.settings, saveData: vault.saveData };
    const mac = createDataJsonAuthStorage(host, deviceAuthScope(host.app));
    expect(mac.getItem(KEY)).toBe('EXISTING');
  });
});
