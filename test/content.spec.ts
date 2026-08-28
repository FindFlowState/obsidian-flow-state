import { describe, it, expect } from 'vitest';
import {
  parseFrontMatterConfig,
  resolveFrontMatter,
  formatDate,
  formatTime,
  frontMatterValueToText,
  renderFrontMatterPreview,
  type FrontMatterConfig,
} from '../src/content';

// Local-time construction keeps these assertions timezone-independent.
const CAPTURED = new Date(2025, 7, 19, 9, 5); // Aug 19 2025, 09:05 local

function cfg(properties: Array<{ key: string; value: unknown }>, enabled = true): FrontMatterConfig {
  return { enabled, properties };
}

describe('formatDate / formatTime', () => {
  it('formats local date as YYYY-MM-DD', () => {
    expect(formatDate(CAPTURED)).toBe('2025-08-19');
  });

  it('zero-pads month, day, hour, minute', () => {
    const d = new Date(2026, 0, 3, 4, 7);
    expect(formatDate(d)).toBe('2026-01-03');
    expect(formatTime(d)).toBe('04:07');
  });

  it('formats local time as HH:MM', () => {
    expect(formatTime(CAPTURED)).toBe('09:05');
  });
});

describe('parseFrontMatterConfig', () => {
  it('returns null for null/undefined/non-object/array configs', () => {
    expect(parseFrontMatterConfig(null)).toBeNull();
    expect(parseFrontMatterConfig(undefined)).toBeNull();
    expect(parseFrontMatterConfig('nope')).toBeNull();
    expect(parseFrontMatterConfig(42)).toBeNull();
    expect(parseFrontMatterConfig([])).toBeNull();
  });

  it('returns null when front_matter is missing or malformed', () => {
    expect(parseFrontMatterConfig({ embed_original: true })).toBeNull();
    expect(parseFrontMatterConfig({ front_matter: 'x' })).toBeNull();
    expect(parseFrontMatterConfig({ front_matter: [] })).toBeNull();
    expect(parseFrontMatterConfig({ front_matter: null })).toBeNull();
  });

  it('parses enabled flag strictly (only literal true enables)', () => {
    expect(parseFrontMatterConfig({ front_matter: { enabled: true, properties: [] } })?.enabled).toBe(true);
    expect(parseFrontMatterConfig({ front_matter: { enabled: 'true', properties: [] } })?.enabled).toBe(false);
    expect(parseFrontMatterConfig({ front_matter: { properties: [] } })?.enabled).toBe(false);
  });

  it('tolerates a non-array properties field', () => {
    const parsed = parseFrontMatterConfig({ front_matter: { enabled: true, properties: 'bad' } });
    expect(parsed).toEqual({ enabled: true, properties: [] });
  });

  it('drops malformed property entries and trims keys', () => {
    const parsed = parseFrontMatterConfig({
      front_matter: {
        enabled: true,
        properties: [
          null,
          'oops',
          ['a'],
          { value: 'no key' },
          { key: 42, value: 'non-string key' },
          { key: '   ', value: 'blank key' },
          { key: '  course  ', value: 'MATH 241' },
        ],
      },
    });
    expect(parsed?.properties).toEqual([{ key: 'course', value: 'MATH 241' }]);
  });

  it('drops prototype-polluting keys', () => {
    const parsed = parseFrontMatterConfig({
      front_matter: {
        enabled: true,
        properties: [
          { key: '__proto__', value: 'x' },
          { key: 'constructor', value: 'x' },
          { key: 'prototype', value: 'x' },
          { key: 'safe', value: 'ok' },
        ],
      },
    });
    expect(parsed?.properties).toEqual([{ key: 'safe', value: 'ok' }]);
  });

  it('coexists with other destination_config keys', () => {
    const parsed = parseFrontMatterConfig({
      embed_original: false,
      front_matter: { enabled: true, properties: [{ key: 'type', value: 'note' }] },
    });
    expect(parsed?.properties).toHaveLength(1);
  });
});

describe('resolveFrontMatter', () => {
  it('returns empty record for null or disabled config', () => {
    expect(resolveFrontMatter(null, CAPTURED)).toEqual({});
    expect(resolveFrontMatter(cfg([{ key: 'a', value: 'b' }], false), CAPTURED)).toEqual({});
  });

  it('passes static strings through', () => {
    expect(resolveFrontMatter(cfg([{ key: 'course', value: 'MATH 241' }]), CAPTURED))
      .toEqual({ course: 'MATH 241' });
  });

  it('resolves {{date}} and {{time}} tokens', () => {
    const out = resolveFrontMatter(
      cfg([
        { key: 'captured', value: '{{date}}' },
        { key: 'at', value: '{{time}}' },
      ]),
      CAPTURED,
    );
    expect(out).toEqual({ captured: '2025-08-19', at: '09:05' });
  });

  it('resolves tokens embedded in longer strings and tolerates inner spaces', () => {
    const out = resolveFrontMatter(
      cfg([{ key: 'note', value: 'captured {{ date }} at {{time}}' }]),
      CAPTURED,
    );
    expect(out).toEqual({ note: 'captured 2025-08-19 at 09:05' });
  });

  it('splits comma values into lists, trimming and dropping empties', () => {
    const out = resolveFrontMatter(cfg([{ key: 'tags', value: ' flowstate, math, , lecture ' }]), CAPTURED);
    expect(out).toEqual({ tags: ['flowstate', 'math', 'lecture'] });
  });

  it('resolves tokens inside comma lists', () => {
    const out = resolveFrontMatter(cfg([{ key: 'tags', value: 'daily/{{date}}, inbox' }]), CAPTURED);
    expect(out).toEqual({ tags: ['daily/2025-08-19', 'inbox'] });
  });

  it('coerces booleans and numbers', () => {
    const out = resolveFrontMatter(
      cfg([
        { key: 'reviewed', value: 'false' },
        { key: 'done', value: 'true' },
        { key: 'priority', value: '3' },
        { key: 'score', value: '-1.5' },
      ]),
      CAPTURED,
    );
    expect(out).toEqual({ reviewed: false, done: true, priority: 3, score: -1.5 });
  });

  it('leaves leading-zero and mixed strings as text', () => {
    const out = resolveFrontMatter(
      cfg([
        { key: 'code', value: '007' },
        { key: 'course', value: 'MATH 241' },
        { key: 'version', value: '1.2.3' },
      ]),
      CAPTURED,
    );
    expect(out).toEqual({ code: '007', course: 'MATH 241', version: '1.2.3' });
  });

  it('passes non-string values through untouched', () => {
    const out = resolveFrontMatter(
      cfg([
        { key: 'count', value: 7 },
        { key: 'flag', value: true },
        { key: 'nothing', value: null },
      ]),
      CAPTURED,
    );
    expect(out).toEqual({ count: 7, flag: true, nothing: null });
  });

  it('resolves string items inside stored arrays', () => {
    const out = resolveFrontMatter(
      cfg([{ key: 'tags', value: ['flowstate', '{{date}}', 3] }]),
      CAPTURED,
    );
    expect(out).toEqual({ tags: ['flowstate', '2025-08-19', 3] });
  });

  it('keeps configured order and lets the first duplicate key win', () => {
    const out = resolveFrontMatter(
      cfg([
        { key: 'b', value: '1' },
        { key: 'a', value: '2' },
        { key: 'b', value: '3' },
      ]),
      CAPTURED,
    );
    expect(Object.keys(out)).toEqual(['b', 'a']);
    expect(out.b).toBe(1);
  });
});

describe('frontMatterValueToText', () => {
  it('joins arrays with commas and stringifies scalars', () => {
    expect(frontMatterValueToText(['a', 'b'])).toBe('a, b');
    expect(frontMatterValueToText(true)).toBe('true');
    expect(frontMatterValueToText(3)).toBe('3');
    expect(frontMatterValueToText(null)).toBe('');
    expect(frontMatterValueToText('x')).toBe('x');
  });
});

describe('renderFrontMatterPreview', () => {
  it('renders scalars and lists between --- fences', () => {
    const text = renderFrontMatterPreview({ type: 'note', tags: ['a', 'b'] });
    expect(text).toBe('---\ntype: note\ntags:\n  - a\n  - b\n---');
  });

  it('renders an empty block for no properties', () => {
    expect(renderFrontMatterPreview({})).toBe('---\n---');
  });
});
