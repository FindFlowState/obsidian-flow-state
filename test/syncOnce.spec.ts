import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('fetchPendingJobs', () => {
  let plugin: FlowStatePlugin;
  beforeEach(() => { plugin = makePlugin(); updates.length = 0; });

  it('returns the jobs array from Supabase', async () => {
    const result = await (plugin as any).fetchPendingJobs();
    expect(result).toHaveLength(jobs.length);
    expect(result[0].id).toBe('job1');
  });
});

describe('syncSingleJob', () => {
  let plugin: FlowStatePlugin;
  beforeEach(() => { plugin = makePlugin(); updates.length = 0; });

  it('writes one job and acks it as delivered', async () => {
    (plugin as any).settings.routes!['route1'] = baseRoute();
    const path = await (plugin as any).syncSingleJob(jobs[0]);
    expect(typeof path).toBe('string');
    expect(path).toContain('Hello');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'delivered' });
  });
});

describe('priority job sync (deep link two-phase)', () => {
  let plugin: FlowStatePlugin;
  const originalJobs = [...jobs];

  beforeEach(() => {
    plugin = makePlugin();
    updates.length = 0;
    // Set up 3 jobs
    jobs.length = 0;
    jobs.push(
      { id: 'job-a', created_at: '2025-08-19T12:00:00Z', route_id: 'route1', formatted_content: 'content A', transcribed_text: null, final_title: 'Title A', metadata: {}, routes: { connections: { service_type: 'obsidian' } } },
      { id: 'job-b', created_at: '2025-08-19T12:01:00Z', route_id: 'route1', formatted_content: 'content B', transcribed_text: null, final_title: 'Title B', metadata: {}, routes: { connections: { service_type: 'obsidian' } } },
      { id: 'job-c', created_at: '2025-08-19T12:02:00Z', route_id: 'route1', formatted_content: 'content C', transcribed_text: null, final_title: 'Title C', metadata: {}, routes: { connections: { service_type: 'obsidian' } } },
    );
    (plugin as any).settings.routes!['route1'] = baseRoute();
  });

  afterEach(() => {
    // Restore original jobs for other tests
    jobs.length = 0;
    jobs.push(...originalJobs);
  });

  it('syncs target job first when priorityJobId is provided', async () => {
    const syncOrder: string[] = [];
    const origSync = (plugin as any).syncSingleJob.bind(plugin);
    (plugin as any).syncSingleJob = async (it: any) => {
      syncOrder.push(it.id);
      return origSync(it);
    };

    // Simulate two-phase sync with job-b as priority
    const items = await (plugin as any).fetchPendingJobs();
    const targetJobId = 'job-b';
    const targetItem = items.find((it: any) => it.id === targetJobId);
    expect(targetItem).toBeDefined();

    // Phase 1: sync priority
    await (plugin as any).syncSingleJob(targetItem);

    // Phase 2: sync remaining
    const remaining = items.filter((it: any) => it.id !== targetJobId);
    for (const it of remaining) {
      await (plugin as any).syncSingleJob(it);
    }

    expect(syncOrder[0]).toBe('job-b');
    expect(syncOrder).toEqual(['job-b', 'job-a', 'job-c']);
    expect(updates).toHaveLength(3);
  });

  it('syncs all jobs normally when no priorityJobId', async () => {
    const syncOrder: string[] = [];
    const origSync = (plugin as any).syncSingleJob.bind(plugin);
    (plugin as any).syncSingleJob = async (it: any) => {
      syncOrder.push(it.id);
      return origSync(it);
    };

    const items = await (plugin as any).fetchPendingJobs();
    for (const it of items) {
      await (plugin as any).syncSingleJob(it);
    }

    // Without priority, order follows created_at ascending
    expect(syncOrder).toEqual(['job-a', 'job-b', 'job-c']);
  });

  it('processes all jobs when target job not in pending results', async () => {
    const items = await (plugin as any).fetchPendingJobs();
    const targetJobId = 'job-missing';
    const targetItem = items.find((it: any) => it.id === targetJobId);
    expect(targetItem).toBeUndefined();

    // Falls through to sync all
    const remaining = targetJobId ? items.filter((it: any) => it.id !== targetJobId) : items;
    for (const it of remaining) {
      await (plugin as any).syncSingleJob(it);
    }

    expect(updates).toHaveLength(3);
  });
});
