import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../src/time';

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-28T12:00:00Z');
  const at = (iso: string) => formatRelativeTime(iso, now);

  it('covers the ladder from just-now to dates', () => {
    expect(at('2026-08-28T11:59:40Z')).toBe('just now');
    expect(at('2026-08-28T11:45:00Z')).toBe('15m ago');
    expect(at('2026-08-28T09:00:00Z')).toBe('3h ago');
    expect(at('2026-08-27T09:00:00Z')).toBe('yesterday');
    expect(at('2026-08-25T09:00:00Z')).toBe('3d ago');
    expect(at('2026-08-12T09:00:00Z')).toMatch(/Aug/);
  });

  it('treats future/invalid timestamps as just now', () => {
    expect(at('2026-08-28T12:05:00Z')).toBe('just now');
  });
});
