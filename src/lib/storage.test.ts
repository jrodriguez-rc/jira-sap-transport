// src/lib/storage.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, unknown>();
const issueProps = new Map<string, unknown>();

// Special issue keys trigger non-2xx server responses so the defensive
// throw-on-error branches in getIssueTransports / setIssueTransports are exercised.
// Special issue key 'PROP-EMPTY' returns 200 but with an empty body (no .value),
// to hit the `body.value ?? []` fallback in storage.ts.
vi.mock('@forge/kvs', () => ({
  kvs: {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    query: vi.fn(() => ({
      where: (_property: string, clause: { value?: string }) => ({
        getMany: async () => {
          const prefix = clause?.value ?? '';
          return {
            results: Array.from(store.entries())
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, value]) => ({ key, value }))
          };
        }
      })
    }))
  },
  WhereConditions: {
    beginsWith: (value: string) => ({ condition: 'BEGINS_WITH', value })
  }
}));

vi.mock('@forge/api', () => ({
  default: {
    asApp: () => ({
      requestJira: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
        const match = path.match(/\/rest\/api\/3\/issue\/([^/]+)\/properties\/sap\.transports$/);
        if (!match) throw new Error('unexpected path ' + path);
        const key = match[1];
        if (!init || !init.method || init.method === 'GET') {
          if (key === 'GET-500') return { status: 500, json: async () => ({}) };
          if (key === 'PROP-EMPTY') return { status: 200, json: async () => ({}) };
          const v = issueProps.get(key);
          return v === undefined
            ? { status: 404, json: async () => ({}) }
            : { status: 200, json: async () => ({ value: v }) };
        }
        if (init.method === 'PUT') {
          if (key === 'PUT-409') return { status: 409, json: async () => ({}) };
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
  slotKey: 'sap-backend-1',
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
      slotKey: 'sap-backend-1',
      client: '100',
      username: 'JIRAUSR'
    });
    expect('password' in pub).toBe(false);
  });
});

import { getProjectConfig, saveProjectConfig, getIssueTransports, setIssueTransports } from './storage';
import type { ProjectConfig, SapTransportEntry } from './types';

const cfg: ProjectConfig = {
  connectionId: 'dev-100',
  projectCode: 'PROJX',
  descriptionTemplate: '{{issue.key}}',
  defaults: { type: 'K' }
};

describe('project config storage', () => {
  it('saves and reads project config', async () => {
    await saveProjectConfig('10001', cfg);
    expect(await getProjectConfig('10001')).toEqual(cfg);
  });

  it('returns undefined for unknown project', async () => {
    expect(await getProjectConfig('99999')).toBeUndefined();
  });
});

describe('issue transports', () => {
  const entry: SapTransportEntry = {
    requestId: 'DEVK900123',
    type: 'K',
    target: 'QAS',
    description: 'PROJ-1 Hello',
    createdAt: '2026-05-17T10:00:00Z',
    status: 'D',
    statusText: 'Modifiable'
  };

  it('returns [] for an issue with no property', async () => {
    expect(await getIssueTransports('PROJ-1')).toEqual([]);
  });

  it('sets and reads the transport list', async () => {
    await setIssueTransports('PROJ-1', [entry]);
    expect(await getIssueTransports('PROJ-1')).toEqual([entry]);
  });

  it('returns [] when the issue property exists but has no .value', async () => {
    expect(await getIssueTransports('PROP-EMPTY')).toEqual([]);
  });

  it('throws when the property GET fails with a non-200/404 status', async () => {
    await expect(getIssueTransports('GET-500')).rejects.toThrow(/Issue property fetch failed/);
  });

  it('throws when the property PUT fails with a 3xx+ status', async () => {
    await expect(setIssueTransports('PUT-409', [entry])).rejects.toThrow(/Issue property write failed/);
  });
});
