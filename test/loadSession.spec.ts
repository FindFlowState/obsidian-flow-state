import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSessionOrNull } from '../src/supabase';
import type { Database } from '../src/types';

// Only `auth.getSession` is touched; the rest of the client is irrelevant here.
function clientWith(getSession: () => Promise<unknown>) {
  return { auth: { getSession } } as unknown as SupabaseClient<Database>;
}

const session = { access_token: 'a', refresh_token: 'r', user: { id: 'u1', email: 'u@example.com' } };

describe('loadSessionOrNull (settings tab must always render a sign-in state)', () => {
  beforeEach(() => {
    // The plugin uses window timers (popout-window safe); there is no window
    // in the node test environment, so route them to the globals vitest's
    // fake timers patch.
    (globalThis as { window?: unknown }).window = {
      setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as { window?: unknown }).window;
  });

  it('returns the session when one is stored and valid', async () => {
    const supabase = clientWith(async () => ({ data: { session }, error: null }));
    await expect(loadSessionOrNull(supabase)).resolves.toBe(session);
  });

  it('returns null when nothing is stored', async () => {
    const supabase = clientWith(async () => ({ data: { session: null }, error: null }));
    await expect(loadSessionOrNull(supabase)).resolves.toBeNull();
  });

  it('treats a refresh error (revoked token, offline) as signed out instead of throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const supabase = clientWith(async () => ({
      data: { session: null },
      error: { name: 'AuthApiError', message: 'Invalid Refresh Token: Refresh Token Not Found' },
    }));
    await expect(loadSessionOrNull(supabase)).resolves.toBeNull();
  });

  it('treats a thrown error as signed out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const supabase = clientWith(async () => { throw new Error('boom'); });
    await expect(loadSessionOrNull(supabase)).resolves.toBeNull();
  });

  it('gives up after the timeout when the session check never settles', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const supabase = clientWith(() => new Promise(() => {}));
    const result = loadSessionOrNull(supabase, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toBeNull();
  });
});
