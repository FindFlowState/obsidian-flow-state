// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('obsidian', async () => await import('./mocks/obsidian'));

// Signed-in session with a purchased-credits-only balance (top-up pricing).
const session = { user: { id: 'user-1', email: 'demo@flowstate.test' } };
const credits = { purchased_credits: 25 };

vi.mock('../src/supabase', () => ({
  getSupabase: vi.fn(() => ({})),
  getCurrentSession: vi.fn(async () => session),
  signOut: vi.fn(async () => {}),
  sendMagicLink: vi.fn(async () => {}),
  listObsidianRoutes: vi.fn(async () => []),
  deleteRoute: vi.fn(async () => {}),
  fetchRouteById: vi.fn(async () => null),
  fetchUserCredits: vi.fn(async () => credits),
}));

import { FlowStateSettingTab, DEFAULT_SETTINGS } from '../src/settings';

const pluginStub = {
  saveData: async () => {},
  getMyConnectionId: async () => 'conn-1',
  clearMyConnectionId: () => {},
} as any;

async function renderSettingsTab(): Promise<HTMLElement> {
  const tab = new FlowStateSettingTab({} as any, pluginStub, { ...DEFAULT_SETTINGS });
  tab.display();
  // display() kicks off async renders (auth check, credits fetch); let them settle
  await new Promise((r) => setTimeout(r, 20));
  return (tab as unknown as { containerEl: HTMLElement }).containerEl;
}

describe('settings tab credits section (top-up-only pricing)', () => {
  beforeEach(() => {
    credits.purchased_credits = 25;
  });

  it('describes the 25-free-credit start and top-up packs', async () => {
    const el = await renderSettingsTab();
    const text = el.textContent ?? '';
    expect(text).toContain('You get 25 free credits to get started');
    expect(text).toContain('Buy a top-up pack — credits never expire');
  });

  it('shows the purchased balance as the total and in the header badge', async () => {
    credits.purchased_credits = 1025;
    const el = await renderSettingsTab();
    const text = el.textContent ?? '';
    expect(text).toContain('Total Credits');
    expect(text).toContain('1025');
    expect(text).toContain('(1025)'); // collapsed-header badge
  });

  it('has no subscription or unlimited-plan UI left', async () => {
    const el = await renderSettingsTab();
    const text = el.textContent ?? '';
    expect(text).not.toMatch(/subscription/i);
    expect(text).not.toMatch(/unlimited/i);
    expect(text).not.toContain('50 free credits');
  });
});
