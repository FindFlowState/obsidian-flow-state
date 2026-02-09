import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('obsidian', async () => await import('./mocks/obsidian'));
import FlowStatePlugin from '../src/main';
import type { Job, Route } from '@flowstate/supabase-types';

const updates: any[] = [];
const jobs: any[] = [{
  id: 'job1',
  created_at: '2025-08-19T12:00:00Z',
  route_id: 'route1',
  formatted_content: 'content',
  transcribed_text: null,
  final_title: 'Hello',
  metadata: {},
  routes: { connections: { service_type: 'obsidian' } }
}];

vi.mock('../src/supabase', async () => {
  return {
    getSupabase: () => ({
      from: (table: string) => {
        if (table === 'jobs') {
          return {
            select: () => ({
              eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ data: jobs, error: null }) }) }) }) })
            }),
            update: (patch: any) => ({
              eq: () => ({ eq: () => { updates.push(patch); return { data: null, error: null }; } })
            }),
          } as any;
        }
        return {} as any;
      },
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    }),
    exchangeFromObsidianParams: vi.fn(),
    fetchRouteById: vi.fn(async (_supabase: any, id: string) => baseRoute({ id } as any)),
    ensureObsidianConnection: vi.fn(),
  };
});

function makePlugin() {
  const p = new (FlowStatePlugin as any)();
  (p as any).settings = { supabaseUrl: 'x', supabaseAnonKey: 'y', routes: {} };
  return p as FlowStatePlugin;
}

function baseRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: 'route1', name: 'Test', slug: 'test', user_id: 'u1',
    content_types: ['writing'] as any, destination_location: 'Inbox',
    destination_config: null, include_original_file: false,
    title_template: 'Note {{yyyy}}-{{mm}}-{{dd}}.md',
    append_to_existing: null, is_active: true, connection_id: 'conn1',
    ...overrides,
  } as any;
}

describe('syncOnce', () => {
  let plugin: FlowStatePlugin;
  beforeEach(() => { plugin = makePlugin(); updates.length = 0; });

  it('writes files and marks jobs as delivered', async () => {
    (plugin as any).settings.routes!['route1'] = baseRoute();
    const paths = await (plugin as any).syncOnce();
    expect(paths).toHaveLength(1);
    expect(updates).toContainEqual(expect.objectContaining({ status: 'delivered' }));
  });
});
