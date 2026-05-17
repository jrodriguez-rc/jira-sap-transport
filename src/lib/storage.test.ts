// src/lib/storage.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, unknown>();
const issueProps = new Map<string, unknown>();

vi.mock('@forge/api', () => ({
  storage: {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    query: vi.fn(() => ({
      where: () => ({
        getMany: async () => ({
          results: Array.from(store.entries()).map(([key, value]) => ({ key, value }))
        })
      })
    }))
  },
  default: {
    asApp: () => ({
      requestJira: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
        const match = path.match(/\/rest\/api\/3\/issue\/([^/]+)\/properties\/sap\.transports$/);
        if (!match) throw new Error('unexpected path ' + path);
        const key = match[1];
        if (!init || !init.method || init.method === 'GET') {
          const v = issueProps.get(key);
          return v === undefined
            ? { status: 404, json: async () => ({}) }
            : { status: 200, json: async () => ({ value: v }) };
        }
        if (init.method === 'PUT') {
          issueProps.set(key, JSON.parse(init.body!));
          return { status: 200, json: async () => ({}) };
        }
        throw new Error('unexpected method ' + init.method);
      })
    })
  },
  route: (s: TemplateStringsArray, ...args: unknown[]) =>
    s.reduce((acc, part, i) => acc + part + (args[i] ?? ''), '')
}));

// Reset both maps in every beforeEach in this file
beforeEach(() => {
  store.clear();
  issueProps.clear();
});

import { listConnections, getConnection, saveConnection, deleteConnection, toPublic } from './storage';
import type { Connection } from './types';

const sample: Connection = {
  id: 'dev-100',
  label: 'DEV',
  hostname: 'https://dev.sap.lan',
  client: '100',
  username: 'JIRAUSR',
  password: 'secret'
};

describe('connections storage', () => {
  it('saves and retrieves a connection', async () => {
    await saveConnection(sample);
    const got = await getConnection('dev-100');
    expect(got).toEqual(sample);
  });

  it('lists all connections', async () => {
    await saveConnection(sample);
    await saveConnection({ ...sample, id: 'qas-200', label: 'QAS', client: '200' });
    const list = await listConnections();
    expect(list.map((c) => c.id).sort()).toEqual(['dev-100', 'qas-200']);
  });

  it('deletes a connection', async () => {
    await saveConnection(sample);
    await deleteConnection('dev-100');
    expect(await getConnection('dev-100')).toBeUndefined();
  });

  it('toPublic strips the password', () => {
    const pub = toPublic(sample);
    expect(pub).toEqual({
      id: 'dev-100',
      label: 'DEV',
      hostname: 'https://dev.sap.lan',
      client: '100',
      username: 'JIRAUSR'
    });
    expect('password' in pub).toBe(false);
  });
});
