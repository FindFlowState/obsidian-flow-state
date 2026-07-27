import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('obsidian', async () => await import('./mocks/obsidian'));
import FlowStatePlugin from '../src/main';
import type { Route, Job } from '@flowstate/supabase-types';

const mockDownload = vi.fn().mockResolvedValue(new Uint8Array([1,2,3]));
vi.mock('../src/storage', () => ({ downloadFromStorage: (...args:any[]) => mockDownload(...args) }));

function makePlugin() {
  const p = new (FlowStatePlugin as any)();
  (p as any).settings = { supabaseUrl: 'http://localhost', supabaseAnonKey: 'anon', routes: {} };
  return p as FlowStatePlugin;
}

function routeWithAttachments(): Route {
  return {
    id: 'route1', name: 'Test', slug: 'test', user_id: 'u1',
    content_types: ['writing'] as any, destination_location: 'Inbox',
    destination_config: null, include_original_file: true,
    title_template: 'Note {{yyyy}}-{{mm}}-{{dd}}.md',
    append_to_existing: null, is_active: true, connection_id: 'conn1',
  } as any;
}

function jobWithOriginal(): Job {
  return {
    id: 'job1', created_at: '2025-08-19T12:00:00Z', route_id: 'route1',
    formatted_content: '# Body', transcribed_text: null as any, final_title: 'Hello',
    metadata: { original_object: { bucket: 'uploads', name: 'x/y/z.pdf' } },
  } as any;
}

describe('attachments', () => {
  let plugin: FlowStatePlugin;
  beforeEach(() => { plugin = makePlugin(); });

  it('downloads and saves original alongside note when enabled', async () => {
    (plugin as any).settings.routes!['route1'] = routeWithAttachments();
    const p = await (plugin as any).writeJobToVault(jobWithOriginal(), '# body');
    expect(p).toBe('Inbox/Hello.md');

    // With no attachment folder configured in Obsidian, the original lands in
    // the note's own folder (the baseFolder passed by writeJobToVault).
    const tf = (plugin as any).app.vault.getAbstractFileByPath('Inbox/z.pdf');
    expect(tf).toBeTruthy();
  });

  // Regression: attachments used to be written via vault.adapter.writeBinary,
  // which puts the bytes on disk without registering the file with the Vault.
  // Obsidian's index — and Sync on top of it — then never learn about the file,
  // so the note reaches other devices with an unreadable attachment next to it.
  it('registers the attachment with the Vault, not just on disk', async () => {
    (plugin as any).settings.routes!['route1'] = routeWithAttachments();
    await (plugin as any).writeJobToVault(jobWithOriginal(), '# body');

    const vault = (plugin as any).app.vault;
    expect(vault.registered.has('Inbox/z.pdf')).toBe(true);
    expect(vault.getAbstractFileByPath('Inbox/z.pdf')).toBeTruthy();
  });

  it('writes the downloaded bytes intact', async () => {
    (plugin as any).settings.routes!['route1'] = routeWithAttachments();
    await (plugin as any).writeJobToVault(jobWithOriginal(), '# body');

    const vault = (plugin as any).app.vault;
    const bytes = new Uint8Array(await vault.readBinary(vault.getAbstractFileByPath('Inbox/z.pdf')));
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  // Regression: maybeDownloadOriginal took a baseFolder but never passed it on,
  // so relative attachment settings resolved against the vault root instead of
  // the note's folder.
  it('resolves a "subfolder under current folder" setting against the note folder', async () => {
    (plugin as any).app.vault.getConfig = () => './attachments';
    (plugin as any).settings.routes!['route1'] = routeWithAttachments();
    await (plugin as any).writeJobToVault(jobWithOriginal(), '# body');

    const vault = (plugin as any).app.vault;
    expect(vault.getAbstractFileByPath('Inbox/attachments/z.pdf')).toBeTruthy();
  });

  it('resolves a "same folder as current file" setting to the note folder', async () => {
    (plugin as any).app.vault.getConfig = () => './';
    (plugin as any).settings.routes!['route1'] = routeWithAttachments();
    await (plugin as any).writeJobToVault(jobWithOriginal(), '# body');

    const vault = (plugin as any).app.vault;
    expect(vault.getAbstractFileByPath('Inbox/z.pdf')).toBeTruthy();
    // Never a literal "." folder.
    expect(vault.getAbstractFileByPath('.')).toBeNull();
  });
});
