import { describe, it, expect } from 'vitest';
import { resolvePath, renderRaw, render, DEFAULT_TEMPLATE, truncateTo60 } from './template';

describe('resolvePath', () => {
  const ctx = {
    issue: {
      key: 'PROJ-1',
      fields: {
        summary: 'Hello',
        customfield_10001: { value: 'Option A' },
        labels: ['a', 'b']
      }
    }
  };

  it('walks dotted paths', () => {
    expect(resolvePath(ctx, 'issue.key')).toBe('PROJ-1');
    expect(resolvePath(ctx, 'issue.fields.summary')).toBe('Hello');
    expect(resolvePath(ctx, 'issue.fields.customfield_10001.value')).toBe('Option A');
  });

  it('returns undefined for missing paths', () => {
    expect(resolvePath(ctx, 'issue.fields.missing')).toBeUndefined();
    expect(resolvePath(ctx, 'nope.at.all')).toBeUndefined();
  });

  it('returns the value as-is for non-string scalars', () => {
    const c = { n: 42, b: true, x: null };
    expect(resolvePath(c, 'n')).toBe(42);
    expect(resolvePath(c, 'b')).toBe(true);
    expect(resolvePath(c, 'x')).toBeNull();
  });

  it('returns objects/arrays as-is (caller decides what to do)', () => {
    expect(resolvePath(ctx, 'issue.fields.labels')).toEqual(['a', 'b']);
    expect(resolvePath(ctx, 'issue.fields')).toEqual(ctx.issue.fields);
  });
});

describe('renderRaw', () => {
  const ctx = {
    issue: { key: 'PROJ-1', fields: { summary: 'Hi', missing: undefined, weird: { x: 1 } } },
    user: { email: 'a@b.com' }
  };

  it('substitutes {{path}} tokens', () => {
    const r = renderRaw('{{issue.key}} - {{issue.fields.summary}}', ctx);
    expect(r.text).toBe('PROJ-1 - Hi');
    expect(r.warnings).toEqual([]);
  });

  it('emits warning and empty string for missing paths', () => {
    const r = renderRaw('A {{issue.fields.nope}} B', ctx);
    expect(r.text).toBe('A  B');
    expect(r.warnings).toEqual(['Path "issue.fields.nope" not found']);
  });

  it('emits warning and empty string for non-scalar values', () => {
    const r = renderRaw('X {{issue.fields.weird}} Y', ctx);
    expect(r.text).toBe('X  Y');
    expect(r.warnings).toEqual(['Path "issue.fields.weird" resolves to non-scalar value']);
  });

  it('coerces numbers and booleans to strings', () => {
    const r = renderRaw('{{n}} {{b}}', { n: 42, b: true });
    expect(r.text).toBe('42 true');
  });

  it('treats null/undefined as empty string without warning when path exists but is null', () => {
    const r = renderRaw('X{{v}}Y', { v: null });
    expect(r.text).toBe('XY');
    expect(r.warnings).toEqual([]);
  });

  it('preserves literal text outside of tokens', () => {
    const r = renderRaw('hello world', ctx);
    expect(r.text).toBe('hello world');
  });

  it('handles multiple occurrences of the same token', () => {
    const r = renderRaw('{{issue.key}}/{{issue.key}}', ctx);
    expect(r.text).toBe('PROJ-1/PROJ-1');
  });
});

describe('truncateTo60', () => {
  it('keeps strings ≤60 chars untouched', () => {
    expect(truncateTo60('a'.repeat(60))).toEqual({ text: 'a'.repeat(60), truncated: false });
    expect(truncateTo60('short')).toEqual({ text: 'short', truncated: false });
  });

  it('cuts at last whitespace ≤60', () => {
    const t = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp'; // > 60
    const r = truncateTo60(t);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(60);
    expect(t.startsWith(r.text)).toBe(true);
    expect(r.text.endsWith(' ')).toBe(false);
  });

  it('hard-cuts at 60 when no whitespace exists in the first 60', () => {
    const t = 'a'.repeat(80);
    const r = truncateTo60(t);
    expect(r.text).toBe('a'.repeat(60));
    expect(r.truncated).toBe(true);
  });
});

describe('render', () => {
  const ctx = { issue: { key: 'PROJ-1', fields: { summary: 'Hello world' } } };

  it('uses the default template when input is empty/whitespace', () => {
    const r = render('', ctx);
    expect(r.text).toBe('PROJ-1 Hello world');
    expect(DEFAULT_TEMPLATE).toBe('{{issue.key}} {{issue.fields.summary}}');
  });

  it('returns RenderResult with length and truncated flag', () => {
    const r = render('{{issue.key}} {{issue.fields.summary}}', ctx);
    expect(r.text).toBe('PROJ-1 Hello world');
    expect(r.length).toBe(18);
    expect(r.truncated).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('truncates and sets the flag when the rendered text exceeds 60 chars', () => {
    const long = { issue: { key: 'PROJ-1', fields: { summary: 'word '.repeat(20) } } };
    const r = render('{{issue.key}} {{issue.fields.summary}}', long);
    expect(r.text.length).toBeLessThanOrEqual(60);
    expect(r.truncated).toBe(true);
    expect(r.length).toBeGreaterThan(60);
  });

  it('forwards warnings from rendering', () => {
    const r = render('{{issue.missing}}', ctx);
    expect(r.warnings).toContain('Path "issue.missing" not found');
  });
});
