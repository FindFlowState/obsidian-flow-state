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

    // Check attachment file was written under Flow State/_attachments
    const tf = (plugin as any).app.vault.getAbstractFileByPath('Flow State/_attachments/z.pdf');
    expect(tf).toBeTruthy();
  });
});
