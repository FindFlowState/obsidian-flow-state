import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('obsidian', async () => await import('./mocks/obsidian'));
import FlowStatePlugin from '../src/main';
import { formatDate, formatTime } from '../src/content';
import type { Route, Job } from '@flowstate/supabase-types';

vi.mock('../src/storage', () => ({ downloadFromStorage: vi.fn() }));

const CREATED_AT = '2025-08-19T12:00:00Z';

function makePlugin() {
  const p = new (FlowStatePlugin as any)();
  (p as any).settings = { supabaseUrl: '', supabaseAnonKey: '', routes: {} };
  return p as FlowStatePlugin;
}

function baseJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job1',
    created_at: CREATED_AT,
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

function fmRoute(overrides: Partial<Route> = {}): Route {
  return baseRoute({
    destination_config: {
      embed_original: true,
      front_matter: {
        enabled: true,
        properties: [
          { key: 'type', value: 'lecture-note' },
          { key: 'captured', value: '{{date}}' },
          { key: 'at', value: '{{time}}' },
          { key: 'tags', value: 'flowstate, math' },
        ],
      },
    } as any,
    ...overrides,
  });
}

async function readVault(plugin: FlowStatePlugin, path: string): Promise<string> {
  const tf = (plugin as any).app.vault.getAbstractFileByPath(path);
  expect(tf).toBeTruthy();
  return (plugin as any).app.vault.read(tf);
}

describe('writeJobToVault front matter', () => {
  let plugin: FlowStatePlugin;
  beforeEach(() => { plugin = makePlugin(); });

  it('stamps configured properties on a new note, in order, with tokens resolved from the capture time', async () => {
    (plugin as any).settings.routes!['route1'] = fmRoute();
    const path = await (plugin as any).writeJobToVault(baseJob(), '# body');
    const contents = await readVault(plugin, path);

    const captured = new Date(CREATED_AT);
    expect(contents).toBe(
      '---\n' +
      'type: lecture-note\n' +
      `captured: ${formatDate(captured)}\n` +
      `at: ${formatTime(captured)}\n` +
      'tags:\n  - flowstate\n  - math\n' +
      '---\n' +
      '# body',
    );
  });

  it('writes no front matter when the config is disabled', async () => {
    const route = fmRoute();
    ((route.destination_config as any).front_matter).enabled = false;
    (plugin as any).settings.routes!['route1'] = route;

    const path = await (plugin as any).writeJobToVault(baseJob(), '# body');
    const contents = await readVault(plugin, path);
    expect(contents).toBe('# body');
  });

  it('writes no front matter when destination_config has no front_matter key', async () => {
    (plugin as any).settings.routes!['route1'] = baseRoute({
      destination_config: { embed_original: true } as any,
    });
    const path = await (plugin as any).writeJobToVault(baseJob(), '# body');
    const contents = await readVault(plugin, path);
    expect(contents).toBe('# body');
  });

  it('writes no front matter when enabled with zero properties', async () => {
    (plugin as any).settings.routes!['route1'] = baseRoute({
      destination_config: { front_matter: { enabled: true, properties: [] } } as any,
    });
    const path = await (plugin as any).writeJobToVault(baseJob(), '# body');
    const contents = await readVault(plugin, path);
    expect(contents).toBe('# body');
  });

  it('never touches front matter when appending to an existing note', async () => {
    (plugin as any).settings.routes!['route1'] = fmRoute({
      destination_location: 'Inbox/append.md',
      append_to_existing: true,
    });
    await (plugin as any).app.vault.create('Inbox/append.md', '---\nowner: me\n---\nexisting');

    const path = await (plugin as any).writeJobToVault(baseJob(), 'new');
    const contents = await readVault(plugin, path);
    expect(contents).toBe('---\nowner: me\n---\nexisting\n\n# Hello\n\nnew');
  });

  it('stamps properties when append mode creates the destination file', async () => {
    (plugin as any).settings.routes!['route1'] = fmRoute({
      destination_location: 'Inbox/append.md',
      append_to_existing: true,
    });

    const path = await (plugin as any).writeJobToVault(baseJob(), 'new');
    expect(path).toBe('Inbox/append.md');
    const contents = await readVault(plugin, path);
    expect(contents.startsWith('---\ntype: lecture-note\n')).toBe(true);
    expect(contents).toContain('# Hello');
    expect(contents).toContain('new');
  });

  it('still delivers the note when processFrontMatter fails', async () => {
    (plugin as any).settings.routes!['route1'] = fmRoute();
    (plugin as any).app.fileManager.processFrontMatter = async () => {
      throw new Error('yaml exploded');
    };

    const path = await (plugin as any).writeJobToVault(baseJob(), '# body');
    const contents = await readVault(plugin, path);
    expect(contents).toBe('# body');
  });

  it('falls back to now for an unparseable created_at instead of failing', async () => {
    (plugin as any).settings.routes!['route1'] = fmRoute();
    const path = await (plugin as any).writeJobToVault(
      baseJob({ created_at: 'not-a-date' as any }),
      '# body',
    );
    const contents = await readVault(plugin, path);
    expect(contents).toMatch(/^---\ntype: lecture-note\ncaptured: \d{4}-\d{2}-\d{2}\n/);
  });

  it('conflict-suffixed files also get properties', async () => {
    (plugin as any).settings.routes!['route1'] = fmRoute();
    await (plugin as any).app.vault.create('Inbox/Hello.md', 'taken');

    const path = await (plugin as any).writeJobToVault(baseJob({ id: 'job2' }), 'b');
    expect(path).toBe('Inbox/Hello 1.md');
    const contents = await readVault(plugin, path);
    expect(contents.startsWith('---\ntype: lecture-note\n')).toBe(true);
  });
});
