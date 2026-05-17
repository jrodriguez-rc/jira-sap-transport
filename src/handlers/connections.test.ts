import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('@forge/api', () => ({
  storage: {
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    query: () => ({
      where: () => ({
        getMany: async () => ({
          results: Array.from(store.entries())
            .filter(([k]) => k.startsWith('connections:'))
            .map(([key, value]) => ({ key, value }))
        })
      })
    })
  },
  default: {
    asApp: () => ({ requestJira: vi.fn() })
  },
  route: (s: TemplateStringsArray) => s.join('')
}));

import { listConnectionsResolver, saveConnectionResolver, deleteConnectionResolver, testConnectionResolver } from './connections';
import * as sapClientMod from '../lib/sap-client';

beforeEach(() => { store.clear(); });

describe('listConnectionsResolver', () => {
  it('returns connections stripped of passwords', async () => {
    store.set('connections:1', { id: '1', label: 'A', hostname: 'https://x', client: '100', username: 'u', password: 'secret' });
    const res = await listConnectionsResolver({ payload: {}, context: {} });
    expect(res[0]).not.toHaveProperty('password');
    expect(res[0].label).toBe('A');
  });
});

describe('saveConnectionResolver', () => {
  it('persists a new connection with a generated id when missing', async () => {
    const res = await saveConnectionResolver({
      payload: { label: 'A', hostname: 'https://x', client: '100', username: 'u', password: 'p' },
      context: {}
    });
    expect(res.id).toBeTruthy();
    expect(store.size).toBe(1);
  });

  it('updates an existing connection by id', async () => {
    store.set('connections:fixed', { id: 'fixed', label: 'old', hostname: 'https://x', client: '100', username: 'u', password: 'p' });
    await saveConnectionResolver({
      payload: { id: 'fixed', label: 'new', hostname: 'https://x', client: '100', username: 'u', password: 'p' },
      context: {}
    });
    expect((store.get('connections:fixed') as { label: string }).label).toBe('new');
  });

  it('rejects invalid hostnames', async () => {
    await expect(saveConnectionResolver({
      payload: { label: 'A', hostname: 'http://insecure', client: '100', username: 'u', password: 'p' },
      context: {}
    })).rejects.toThrow(/https/i);
  });

  it('rejects clients that are not 3 digits', async () => {
    await expect(saveConnectionResolver({
      payload: { label: 'A', hostname: 'https://x', client: '10', username: 'u', password: 'p' },
      context: {}
    })).rejects.toThrow(/client/i);
  });
});

describe('deleteConnectionResolver', () => {
  it('removes the entry', async () => {
    store.set('connections:1', { id: '1', label: 'A', hostname: 'https://x', client: '100', username: 'u', password: 'p' });
    await deleteConnectionResolver({ payload: { id: '1' }, context: {} });
    expect(store.size).toBe(0);
  });
});

describe('testConnectionResolver', () => {
  it('invokes sap-client.testConnection with the given connection', async () => {
    const spy = vi.spyOn(sapClientMod, 'createSapClient').mockReturnValue({
      testConnection: async () => ({ ok: true }),
      createTransport: vi.fn(),
      releaseTransport: vi.fn(),
      getTransport: vi.fn()
    } as never);
    const res = await testConnectionResolver({
      payload: { hostname: 'https://x', client: '100', username: 'u', password: 'p' },
      context: {}
    });
    expect(res).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
  });
});
