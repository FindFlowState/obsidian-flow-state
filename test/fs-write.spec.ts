import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('obsidian', async () => await import('./mocks/obsidian'));
import FlowStatePlugin from '../src/main';
import type { Route, Job } from '@flowstate/supabase-types';

vi.mock('../src/storage', () => ({ downloadFromStorage: vi.fn() }));

function makePlugin() {
  const p = new (FlowStatePlugin as any)();
  // minimal settings
  (p as any).settings = { supabaseUrl: '', supabaseAnonKey: '', routes: {} };
  return p as FlowStatePlugin;
}

function baseJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job1',
    created_at: '2025-08-19T12:00:00Z',
    route_id: 'route1',
    formatted_content: '# Hello\nWorld',
    transcribed_text: null as any,
    final_title: 'Hello',
    metadata: {},
    ...overrides,
  } as any;
}

function baseRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: 'route1', name: 'Test', slug: 'test', user_id: 'u1',
    content_types: ['writing'] as any,
    destination_location: 'Inbox',
    destination_config: null,
    include_original_file: false,
    title_template: 'Note {{yyyy}}-{{mm}}-{{dd}}.md',
    append_to_existing: null,
    is_active: true,
    connection_id: 'conn1',
    ...overrides,
  } as any;
}

describe('writeJobToVault', () => {
  let plugin: FlowStatePlugin;
  beforeEach(() => { plugin = makePlugin(); });

  it('creates new file under folder using final_title', async () => {
    (plugin as any).settings.routes!['route1'] = baseRoute();
    const path = await (plugin as any).writeJobToVault(baseJob(), '# body');
    expect(path).toBe('Inbox/Hello.md');

    const tf = (plugin as any).app.vault.getAbstractFileByPath(path);
    const contents = await (plugin as any).app.vault.read(tf);
    expect(contents).toContain('# body');
  });

  it('appends to existing file when append_to_existing is true', async () => {
    (plugin as any).settings.routes!['route1'] = baseRoute({
      destination_location: 'Inbox/append.md',
      append_to_existing: true,
    });

    // Pre-create the file
    await (plugin as any).app.vault.create('Inbox/append.md', 'existing');

    const path = await (plugin as any).writeJobToVault(baseJob(), 'new');
    expect(path).toBe('Inbox/append.md');

    const tf = (plugin as any).app.vault.getAbstractFileByPath('Inbox/append.md');
    const contents = await (plugin as any).app.vault.read(tf);
    expect(contents).toBe('existing\n\n# Hello\n\nnew');
  });

  it('resolves conflicts by suffixing with index', async () => {
    (plugin as any).settings.routes!['route1'] = baseRoute();
    await (plugin as any).app.vault.create('Inbox/Hello.md', 'a');

    const p2 = await (plugin as any).writeJobToVault(baseJob({ id: 'job2' }), 'b');
    expect(p2).toBe('Inbox/Hello 1.md');
  });
});
