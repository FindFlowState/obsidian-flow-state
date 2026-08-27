import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('obsidian', async () => await import('./mocks/obsidian'));
vi.mock('../src/config', () => ({
  DEFAULT_SUPABASE_URL: 'http://127.0.0.1:54321',
  DEFAULT_SUPABASE_ANON_KEY: 'test-anon-key',
  DEFAULT_INGEST_EMAIL_DOMAIN: 'in.example.com',
  BUILD_ENV: 'test',
}));

const created: any[] = [];
let existingRoutes: any[] = [];
let currentUid: string | null = 'user-1';

vi.mock('../src/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getUser: async () => ({ data: { user: currentUid ? { id: currentUid } : null }, error: null }),
    },
  }),
  listObsidianRoutes: async () => existingRoutes,
  createProject: async (_supa: any, _app: any, params: any) => {
    const row = { id: 'route-new', slug: 'inbox', user_id: currentUid, is_active: true, ...params };
    created.push(row);
    return row;
  },
  fetchUserHandle: async () => 'raj',
}));

import { runFirstSignInSetup, welcomeNoteContent, STARTER_FOLDER } from '../src/firstRun';
import { WELCOME_VIEW_TYPE } from '../src/welcomeView';
import { Plugin } from './mocks/obsidian';

function makePlugin() {
  const plugin: any = new Plugin();
  plugin.settings = { routes: {}, starterSetupUsers: [] };
  const leaf = { setViewState: vi.fn(async () => {}) };
  plugin.app.workspace = { getLeaf: vi.fn(() => leaf) };
  plugin.__leaf = leaf;
  plugin.getMyConnectionId = async () => 'conn-1';
  plugin.saveSettings = vi.fn(async () => {});
  return plugin;
}

beforeEach(() => {
  created.length = 0;
  existingRoutes = [];
  currentUid = 'user-1';
});

describe('runFirstSignInSetup', () => {
  it('creates a starter flow and opens the welcome view for a fresh account — without touching the vault', async () => {
    const plugin = makePlugin();
    const delivered = await runFirstSignInSetup(plugin);

    expect(delivered).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe('Inbox');
    expect(created[0].destination_location).toBe(STARTER_FOLDER);
    expect(plugin.settings.routes['route-new']).toBeTruthy();
    expect(plugin.settings.starterSetupUsers).toContain('user-1');

    // Welcome screen opens as an ephemeral view, with the flow email in state
    expect(plugin.__leaf.setViewState).toHaveBeenCalledWith({
      type: WELCOME_VIEW_TYPE,
      active: true,
      state: { flowEmail: 'raj.inbox@in.example.com' },
    });
    // Nothing was written to the vault
    expect(plugin.app.vault.adapter.fs.size).toBe(0);
  });

  it('does nothing for an account that already has flows in this vault', async () => {
    existingRoutes = [{ id: 'route-old', slug: 'journal', user_id: 'user-1', is_active: true }];
    const plugin = makePlugin();
    const delivered = await runFirstSignInSetup(plugin);

    expect(delivered).toBe(false);
    expect(created).toHaveLength(0);
    expect(plugin.app.vault.adapter.fs.size).toBe(0);
    // Still marked done, so we never auto-create later
    expect(plugin.settings.starterSetupUsers).toContain('user-1');
  });

  it('runs at most once per account', async () => {
    const plugin = makePlugin();
    plugin.settings.starterSetupUsers = ['user-1'];
    const delivered = await runFirstSignInSetup(plugin);

    expect(delivered).toBe(false);
    expect(created).toHaveLength(0);
    expect(plugin.__leaf.setViewState).not.toHaveBeenCalled();
  });

  it('is a no-op when not signed in', async () => {
    currentUid = null;
    const plugin = makePlugin();
    const delivered = await runFirstSignInSetup(plugin);

    expect(delivered).toBe(false);
    expect(created).toHaveLength(0);
    expect(plugin.settings.starterSetupUsers).toHaveLength(0);
  });
});

describe('welcomeNoteContent', () => {
  it('includes the flow email when known and omits the bullet when not', () => {
    expect(welcomeNoteContent('raj.inbox@in.example.com')).toContain('raj.inbox@in.example.com');
    expect(welcomeNoteContent(null)).not.toContain('Email a photo');
  });
});
