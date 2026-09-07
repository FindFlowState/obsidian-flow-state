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

// Tiny stand-in PDF so the spec doesn't drag the real 280KB asset through the transform
vi.mock('../src/samplePdf', () => ({
  SAMPLE_PDF_BASE64: Buffer.from('%PDF-1.3 sample').toString('base64'),
}));

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

import { runFirstSignInSetup, welcomeNoteContent, sampleNoteContent, installSampleNote, STARTER_FOLDER, SAMPLE_NOTE_TITLE, SAMPLE_ACTION_HREF } from '../src/firstRun';
import { WELCOME_VIEW_TYPE } from '../src/welcomeView';
import { Plugin } from './mocks/obsidian';

function makePlugin() {
  const plugin: any = new Plugin();
  plugin.settings = { routes: {}, starterSetupUsers: [] };
  const leaf = { setViewState: vi.fn(async () => {}) };
  plugin.app.workspace = { getLeaf: vi.fn(() => leaf), openLinkText: vi.fn(async () => {}) };
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
  it('creates a starter flow and offers the sample note for a fresh account — without touching the vault', async () => {
    const plugin = makePlugin();
    const delivered = await runFirstSignInSetup(plugin);

    expect(delivered).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe('Inbox');
    expect(created[0].destination_location).toBe(STARTER_FOLDER);
    expect(plugin.settings.routes['route-new']).toBeTruthy();
    expect(plugin.settings.starterSetupUsers).toContain('user-1');

    // Straight to the welcome screen — no interstitial, nothing written
    expect(plugin.app.vault.adapter.fs.size).toBe(0);
    expect(plugin.__leaf.setViewState).toHaveBeenCalledWith({
      type: WELCOME_VIEW_TYPE,
      active: true,
      state: { flowEmail: 'raj.inbox@in.example.com', sampleAdded: false },
    });
  });

  it('writes the sample note + handwritten PDF when the sample link is used', async () => {
    const plugin = makePlugin();
    await runFirstSignInSetup(plugin);
    expect(plugin.app.vault.adapter.fs.size).toBe(0);

    const notePath = await installSampleNote(plugin.app);

    // Vault root, not the flow's folder
    expect(notePath).toBe(`${SAMPLE_NOTE_TITLE}.md`);
    const note = plugin.app.vault.adapter.fs.get(notePath);
    expect(note?.type).toBe('file');
    expect(note?.content).toContain('Lorem Ipsum');
    // Attachment goes wherever a real delivery would put it (no baseFolder),
    // and the note links it the same way
    expect(note?.content).toMatch(/!\[\[.*Where Lorem Ipsum comes from\.pdf\]\]/);
  });

  it('replays for an already-set-up vault when forced, without a duplicate starter flow', async () => {
    existingRoutes = [{ id: 'route-old', slug: 'journal', user_id: 'user-1', is_active: true }];
    const plugin = makePlugin();
    plugin.settings.starterSetupUsers = ['user-1'];

    const delivered = await runFirstSignInSetup(plugin, { force: true });

    expect(delivered).toBe(true);
    expect(created).toHaveLength(0);
    expect(plugin.__leaf.setViewState).toHaveBeenCalled();
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

  it('puts Try it now, with the sample CTA, above the capture routes', () => {
    // The CTA placeholder link is present in both states — welcomeView swaps
    // the paragraph for a card and reads sampleAdded for the card's wording.
    const offered = welcomeNoteContent(null, false);
    expect(offered).toContain(`(${SAMPLE_ACTION_HREF})`);
    // ...under its own "Try it now" heading, below the capture routes
    expect(offered.indexOf('## Try it now')).toBeLessThan(offered.indexOf('## Capture your notes'));
    expect(offered.indexOf('## Try it now')).toBeLessThan(offered.indexOf(SAMPLE_ACTION_HREF));
  });
});

describe('sampleNoteContent', () => {
  it('embeds the handwritten original underneath the transcription', () => {
    const md = sampleNoteContent('attachments/Where Lorem Ipsum comes from.pdf');
    expect(md).toContain('![[attachments/Where Lorem Ipsum comes from.pdf]]');
    expect(md.indexOf('Lorem Ipsum')).toBeLessThan(md.indexOf('![['));
  });
});
