import { describe, it, expect, vi } from 'vitest';

// Mock @forge/api before importing index, since index imports resolvers that
// transitively reference @forge/api at module load time.
vi.mock('@forge/api', () => ({
  storage: {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    query: () => ({ where: () => ({ getMany: async () => ({ results: [] }) }) })
  },
  default: { asApp: () => ({ requestJira: vi.fn() }), fetch: vi.fn() },
  route: (s: TemplateStringsArray) => s.join('')
}));

import { bridgeSafe } from './index';

describe('bridgeSafe', () => {
  it('wraps a successful result in { ok: true, data }', async () => {
    const wrapped = bridgeSafe(async () => 'hello');
    const r = await wrapped({ payload: {}, context: {} });
    expect(r).toEqual({ ok: true, data: 'hello' });
  });

  it('wraps a thrown SapError-like into { ok: false, error }', async () => {
    const wrapped = bridgeSafe(async () => {
      const e = Object.assign(new Error('boom'), {
        code: 'X1',
        severity: 'error' as const,
        httpStatus: 500,
        target: 'description'
      });
      throw e;
    });
    const r = await wrapped({ payload: {}, context: {} });
    expect(r).toEqual({
      ok: false,
      error: { code: 'X1', message: 'boom', severity: 'error', httpStatus: 500, target: 'description' }
    });
  });

  it('uses UNKNOWN code and error severity for plain Errors', async () => {
    const wrapped = bridgeSafe(async () => {
      throw new Error('plain');
    });
    const r = await wrapped({ payload: {}, context: {} });
    expect(r).toEqual({
      ok: false,
      error: { code: 'UNKNOWN', message: 'plain', severity: 'error', httpStatus: undefined, target: undefined }
    });
  });
});
