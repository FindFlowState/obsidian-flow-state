import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('obsidian', async () => await import('./mocks/obsidian'));
vi.mock('../src/config', () => ({
  DEFAULT_SUPABASE_URL: 'http://127.0.0.1:54321',
  DEFAULT_SUPABASE_ANON_KEY: 'test-anon-key',
  DEFAULT_INGEST_EMAIL_DOMAIN: 'in.example.com',
  BUILD_ENV: 'test',
}));
vi.mock('../src/supabase', () => ({
  getSupabase: () => ({}),
  createDataJsonAuthStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

import FlowStatePlugin from '../src/main';
import { firstDeliveryNoticeText, deliveryNoticeText } from '../src/firstRun';
import { Notice } from './mocks/obsidian';

function makePlugin() {
  const plugin: any = new (FlowStatePlugin as any)();
  plugin.settings = { routes: {}, firstSyncNoticeShown: false };
  plugin.saveData = vi.fn(async () => {});
  return plugin as FlowStatePlugin;
}

beforeEach(() => {
  (Notice as any).shown.length = 0;
});

describe('notifyDelivered', () => {
  it('shows the one-time first-delivery notice, then short counts afterwards', () => {
    const plugin = makePlugin();

    plugin.notifyDelivered(['Flowstate/Meeting notes.md']);
    expect((Notice as any).shown).toEqual([firstDeliveryNoticeText('Flowstate/Meeting notes.md')]);
    expect((Notice as any).shown[0]).toContain('"Meeting notes"');
    expect(plugin.settings.firstSyncNoticeShown).toBe(true);
    expect((plugin as any).saveData).toHaveBeenCalled();

    plugin.notifyDelivered(['Flowstate/A.md', 'Flowstate/B.md']);
    expect((Notice as any).shown[1]).toBe(deliveryNoticeText(2));
  });

  it('stays quiet when nothing was delivered', () => {
    const plugin = makePlugin();
    plugin.notifyDelivered([]);
    expect((Notice as any).shown).toHaveLength(0);
    expect(plugin.settings.firstSyncNoticeShown).toBe(false);
  });

  it('skips the long notice for users who already had a delivery', () => {
    const plugin = makePlugin();
    plugin.settings.firstSyncNoticeShown = true;
    plugin.notifyDelivered(['Flowstate/C.md']);
    expect((Notice as any).shown).toEqual([deliveryNoticeText(1)]);
  });
});

describe('delivery notice text', () => {
  it('pluralizes and strips the extension', () => {
    expect(deliveryNoticeText(1)).toBe('Flowstate: 1 new note in your vault');
    expect(deliveryNoticeText(3)).toBe('Flowstate: 3 new notes in your vault');
    expect(firstDeliveryNoticeText('a/b/Groceries.md')).toContain('"Groceries"');
  });
});
