import { describe, it, expect } from 'vitest';
import { resolvePath } from './template';

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
