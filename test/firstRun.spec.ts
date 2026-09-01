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

const sampleModals: any[] = [];
vi.mock('../src/sampleNoteModal', () => ({
  SampleNoteModal: class {
    onChoice: (add: boolean) => Promise<void> | void;
    opened = false;
    constructor(_plugin: any, onChoice: any) { this.onChoice = onChoice; sampleModals.push(this); }
    open() { this.opened = true; }
  },
}));
// Tiny stand-in PDF so the spec doesn't drag the real 136KB asset through the transform
vi.mock('../src/welcomePdf', () => ({
  WELCOME_PDF_BASE64: Buffer.from('%PDF-1.4 sample').toString('base64'),
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

import { runFirstSignInSetup, welcomeNoteContent, sampleNoteContent, installSampleNote, STARTER_FOLDER, SAMPLE_NOTE_TITLE } from '../src/firstRun';
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
  sampleModals.length = 0;
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

    // The choice modal opened; nothing written, no view yet
    expect(sampleModals).toHaveLength(1);
    expect(sampleModals[0].opened).toBe(true);
    expect(plugin.app.vault.adapter.fs.size).toBe(0);
    expect(plugin.__leaf.setViewState).not.toHaveBeenCalled();

    // Skipping opens the ephemeral welcome view with the flow email in state
    await sampleModals[0].onChoice(false);
    expect(plugin.__leaf.setViewState).toHaveBeenCalledWith({
      type: WELCOME_VIEW_TYPE,
      active: true,
      state: { flowEmail: 'raj.inbox@in.example.com' },
    });
    expect(plugin.app.vault.adapter.fs.size).toBe(0);
  });

  it('writes the sample note + handwritten PDF only after the user opts in', async () => {
    const plugin = makePlugin();
    await runFirstSignInSetup(plugin);
    expect(plugin.app.vault.adapter.fs.size).toBe(0);

    await sampleModals[0].onChoice(true);

    const notePath = `${STARTER_FOLDER}/${SAMPLE_NOTE_TITLE}.md`;
    const note = plugin.app.vault.adapter.fs.get(notePath);
    expect(note?.type).toBe('file');
    expect(note?.content).toContain('ink on paper');
    expect(note?.content).toContain(`![[${STARTER_FOLDER}/${SAMPLE_NOTE_TITLE}.pdf]]`);
    expect(plugin.app.vault.adapter.fs.get(`${STARTER_FOLDER}/${SAMPLE_NOTE_TITLE}.pdf`)?.type).toBe('file');
    expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith(notePath, '', false);
    expect(plugin.__leaf.setViewState).not.toHaveBeenCalled();
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
    expect(sampleModals).toHaveLength(0);
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

describe('sampleNoteContent', () => {
  it('embeds the handwritten original underneath the transcription', () => {
    const md = sampleNoteContent('Flowstate/Welcome to Flowstate.pdf');
    expect(md).toContain('![[Flowstate/Welcome to Flowstate.pdf]]');
    expect(md.indexOf('ink on paper')).toBeLessThan(md.indexOf('![['));
  });
});
