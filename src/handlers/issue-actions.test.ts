import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Connection, ProjectConfig } from '../lib/types';

const appStore = new Map<string, unknown>();
const issueProps = new Map<string, unknown>();
const userByAcct = new Map<string, { emailAddress: string }>([['acc1', { emailAddress: 'a@b.com' }]]);

vi.mock('@forge/api', () => ({
  storage: {
    get: vi.fn(async (k: string) => appStore.get(k)),
    set: vi.fn(async (k: string, v: unknown) => { appStore.set(k, v); }),
    delete: vi.fn(),
    query: () => ({ where: () => ({ getMany: async () => ({ results: [] }) }) })
  },
  default: {
    asApp: () => ({
      requestJira: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
        const propMatch = path.match(/\/issue\/([^/]+)\/properties\/sap\.transports$/);
        if (propMatch) {
          const key = propMatch[1];
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
        }
        const userMatch = path.match(/\/rest\/api\/3\/user\?accountId=(.+)$/);
        if (userMatch) {
          const u = userByAcct.get(decodeURIComponent(userMatch[1]));
          return { status: 200, json: async () => u ?? {} };
        }
        const issueMatch = path.match(/\/rest\/api\/3\/issue\/([^/?]+)(?:\?.*)?$/);
        if (issueMatch) {
          return { status: 200, json: async () => ({ key: issueMatch[1], fields: { summary: 'Hi' } }) };
        }
        throw new Error('unexpected path ' + path);
      })
    }),
    asUser: () => ({})
  },
  route: (s: TemplateStringsArray, ...args: unknown[]) =>
    s.reduce((acc, part, i) => acc + part + (args[i] ?? ''), '')
}));

vi.mock('../lib/sap-client', () => ({
  createSapClient: () => ({
    createTransport: vi.fn(async (i: { description: string }) => ({
      Request: 'DEVK900123', Description: i.description, Owner: 'JAIME',
      Type: 'K', TypeText: 'Workbench', Target: 'QAS', Status: 'D', StatusText: 'Modifiable', SAP__Messages: []
    })),
    releaseTransport: vi.fn(async (id: string) => ({
      Request: id, Description: 'x', Owner: 'JAIME', Type: 'K', TypeText: 'Workbench',
      Target: 'QAS', Status: 'R', StatusText: 'Released', SAP__Messages: []
    })),
    getTransport: vi.fn(async (id: string) => {
      if (id === 'NOPE') throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
      return { Request: id, Description: 'x', Owner: 'JAIME', Type: 'K', TypeText: 'Workbench',
        Target: 'QAS', Status: 'D', StatusText: 'Modifiable', SAP__Messages: [] };
    }),
    testConnection: vi.fn()
  }),
  BASE_PATH: '/sap'
}));

const conn: Connection = { id: 'c1', label: 'DEV', hostname: 'https://x', client: '100', username: 'u', password: 'p' };
const cfg: ProjectConfig = { connectionId: 'c1', projectCode: 'PRJX', descriptionTemplate: '', defaults: { type: 'K', target: 'QAS' } };

beforeEach(() => {
  appStore.clear();
  issueProps.clear();
  appStore.set('connections:c1', conn);
  appStore.set('project:10001:config', cfg);
});

import { createTransportResolver, linkTransportResolver, releaseTransportResolver, refreshTransportResolver, listTransportsResolver } from './issue-actions';

describe('createTransportResolver', () => {
  it('renders description, creates the transport and appends to issue property', async () => {
    const r = await createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K', descriptionOverride: '', target: 'QAS' },
      context: { accountId: 'acc1' }
    });
    expect(r.requestId).toBe('DEVK900123');
    const stored = issueProps.get('PROJ-1') as Array<{ requestId: string }>;
    expect(stored.map((e) => e.requestId)).toEqual(['DEVK900123']);
  });

  it('rejects when no connection is configured', async () => {
    appStore.delete('project:10001:config');
    await expect(createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc1' }
    })).rejects.toThrow(/connection/i);
  });
});

describe('linkTransportResolver', () => {
  it('validates and appends the existing transport', async () => {
    const r = await linkTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900200' },
      context: { accountId: 'acc1' }
    });
    expect(r.requestId).toBe('DEVK900200');
    const list = issueProps.get('PROJ-1') as Array<{ requestId: string }>;
    expect(list[0].requestId).toBe('DEVK900200');
  });

  it('fails when SAP says not found', async () => {
    await expect(linkTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'NOPE' },
      context: { accountId: 'acc1' }
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('releaseTransportResolver', () => {
  it('releases and updates the issue property entry', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'DEVK900123', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'Modifiable' }]);
    const r = await releaseTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900123' },
      context: { accountId: 'acc1' }
    });
    expect(r.status).toBe('R');
    const list = issueProps.get('PROJ-1') as Array<{ status: string; releasedAt?: string }>;
    expect(list[0].status).toBe('R');
    expect(list[0].releasedAt).toBeTruthy();
  });
});

describe('refreshTransportResolver', () => {
  it('refreshes status of one entry', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'DEVK900123', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'X', statusText: 'old' }]);
    const r = await refreshTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900123' },
      context: { accountId: 'acc1' }
    });
    expect(r.status).toBe('D');
    const list = issueProps.get('PROJ-1') as Array<{ status: string }>;
    expect(list[0].status).toBe('D');
  });
});

describe('listTransportsResolver', () => {
  it('returns the stored entries', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'DEVK900123', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }]);
    const r = await listTransportsResolver({ payload: { issueKey: 'PROJ-1' }, context: {} });
    expect(r).toHaveLength(1);
  });
});
