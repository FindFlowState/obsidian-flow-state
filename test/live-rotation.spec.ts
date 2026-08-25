/**
 * End-to-end check against a real GoTrue that two devices sharing one synced
 * `data.json` collapse onto a single session, and that device-scoped slots
 * leave both devices independently refreshable.
 *
 * Scope note: this covers the storage collision, which is what the plugin
 * controls. It deliberately doesn't assert that GoTrue revokes a replayed
 * token's family — that's server-side behaviour which varies by version and
 * config (the local CLI stack keeps handing back the successor instead), and
 * production audit logs already show the revocation happening there.
 *
 * Skipped unless a live Supabase is pointed at:
 *
 *   LIVE_SUPABASE_URL=http://127.0.0.1:54321 \
 *   LIVE_SUPABASE_ANON_KEY=... \
 *   LIVE_TEST_EMAIL=... LIVE_SERVICE_ROLE_KEY=... \
 *   npx vitest run test/live-rotation.spec.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createDataJsonAuthStorage, type AuthStorageHost } from '../src/supabase';

const BASE_URL = process.env.LIVE_SUPABASE_URL;
const ANON = process.env.LIVE_SUPABASE_ANON_KEY;
const EMAIL = process.env.LIVE_TEST_EMAIL;
const SERVICE = process.env.LIVE_SERVICE_ROLE_KEY;
const live = Boolean(BASE_URL && ANON && EMAIL && SERVICE);

// supabase CLI default: a refresh token replayed within 10s is handed the same
// successor, so a genuine reuse has to land after that grace window.
const REUSE_INTERVAL_MS = 11_000;
const KEY = `sb-${new URL(BASE_URL ?? 'http://localhost').hostname.split('.')[0]}-auth-token`;

/** One synced data.json shared by every device in a test. */
function sharedVault() {
  const settings: { authStore?: Record<string, string> } = { authStore: {} };
  const saveData = vi.fn(async (_d: unknown) => {});
  return { settings, saveData };
}

function clientOn(vault: ReturnType<typeof sharedVault>, scope: string) {
  const host: AuthStorageHost = { settings: vault.settings, saveData: vault.saveData };
  return createClient(BASE_URL as string, ANON as string, {
    auth: {
      persistSession: true,
      // The refreshing is driven explicitly so the test is deterministic.
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: createDataJsonAuthStorage(host, scope, 'desktop'),
      storageKey: KEY,
    },
  });
}

/**
 * Sign in the way the plugin does — a magic link, minted here with the service
 * role so the test doesn't depend on password logins being enabled.
 */
async function signIn(client: ReturnType<typeof clientOn>) {
  const admin = createClient(BASE_URL as string, SERVICE as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL as string });
  expect(link.error).toBeNull();
  const tokenHash = link.data.properties?.hashed_token;
  expect(tokenHash).toBeTruthy();

  const { data, error } = await client.auth.verifyOtp({
    token_hash: tokenHash as string,
    type: 'magiclink',
  });
  expect(error).toBeNull();
  return data.session!;
}

const storedToken = (vault: ReturnType<typeof sharedVault>, scope: string): string | undefined => {
  const raw = vault.settings.authStore?.[`${scope}::${KEY}`];
  return raw ? JSON.parse(raw).refresh_token : undefined;
};

describe.skipIf(!live)('two devices on one synced data.json (real GoTrue)', () => {
  it('pre-fix: two devices on one slot end up on a single token', async () => {
    const vault = sharedVault();
    const macA = clientOn(vault, 'desktop');
    const macB = clientOn(vault, 'desktop');

    const a = await signIn(macA);
    const b = await signIn(macB);
    expect(a.refresh_token).not.toBe(b.refresh_token);

    // Mac B's sign-in overwrote the one slot, so Mac A's session is gone from
    // storage: on next load it adopts B's token and they rotate over each other.
    expect(storedToken(vault, 'desktop')).toBe(b.refresh_token);
  }, 60_000);

  it('post-fix: device-scoped slots keep both sessions refreshable', async () => {
    const vault = sharedVault();
    const macA = clientOn(vault, 'desktop-aaaa');
    const macB = clientOn(vault, 'desktop-bbbb');

    const a = await signIn(macA);
    const b = await signIn(macB);
    expect(storedToken(vault, 'desktop-aaaa')).toBe(a.refresh_token);
    expect(storedToken(vault, 'desktop-bbbb')).toBe(b.refresh_token);

    // Interleave refreshes the way two live devices would, past the grace window.
    for (let round = 0; round < 2; round++) {
      const ra = await macA.auth.refreshSession();
      expect(ra.error).toBeNull();
      const rb = await macB.auth.refreshSession();
      expect(rb.error).toBeNull();
      await new Promise((r) => setTimeout(r, REUSE_INTERVAL_MS));
    }

    // Both still hold live sessions, and neither slot holds the other's token.
    const finalA = await macA.auth.refreshSession();
    const finalB = await macB.auth.refreshSession();
    expect(finalA.error).toBeNull();
    expect(finalB.error).toBeNull();
    expect(storedToken(vault, 'desktop-aaaa')).not.toBe(storedToken(vault, 'desktop-bbbb'));
  }, 120_000);
});
