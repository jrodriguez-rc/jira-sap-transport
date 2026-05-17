import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProjectConfig } from '../lib/types';

const appStore = new Map<string, unknown>();
const issueProps = new Map<string, unknown>();

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
          const k = propMatch[1];
          if (!init?.method || init.method === 'GET') {
            const v = issueProps.get(k);
            return v === undefined
              ? { status: 404, json: async () => ({}) }
              : { status: 200, json: async () => ({ value: v }) };
          }
          issueProps.set(k, JSON.parse(init.body!));
          return { status: 200, json: async () => ({}) };
        }
        if (path.includes('/rest/api/3/user')) return { status: 200, json: async () => ({ emailAddress: 'a@b.com' }) };
        if (path.includes('/rest/api/3/issue/')) return { status: 200, json: async () => ({ key: 'PROJ-1', fields: { summary: 'Hi' } }) };
        throw new Error('unexpected ' + path);
      })
    })
  },
  route: (s: TemplateStringsArray, ...args: unknown[]) =>
    s.reduce((acc, part, i) => acc + part + (args[i] ?? ''), '')
}));

const createTransportCalls: Array<{ description: string; type: string; email: string; target?: string }> = [];

vi.mock('../lib/sap-client', () => ({
  createSapClient: () => ({
    createTransport: vi.fn(async (input: { description: string; type: string; email: string; target?: string }) => {
      createTransportCalls.push(input);
      return {
        Request: 'DEVK900123', Description: 'x', Owner: 'JAIME', Type: 'K', TypeText: 'Workbench',
        Target: 'QAS', Status: 'D', StatusText: 'Modifiable', SAP__Messages: []
      };
    }),
    releaseTransport: vi.fn(async (id: string) => {
      if (id === 'BAD_PLAIN') throw 'plain string error';
      if (id === 'BAD_SAP') {
        const { SapError } = await import('../lib/errors');
        throw new SapError({ code: 'SAP', message: 'release failed', severity: 'error' });
      }
      return { Request: id, Description: 'x', Owner: 'JAIME', Type: 'K', TypeText: 'Workbench',
        Target: 'QAS', Status: 'R', StatusText: 'Released', SAP__Messages: [] };
    }),
    getTransport: vi.fn(async (id: string) => ({
      Request: id, Description: 'x', Owner: 'JAIME', Type: 'K', TypeText: 'Workbench',
      Target: 'QAS', Status: 'D', StatusText: 'Modifiable', SAP__Messages: []
    })),
    testConnection: vi.fn()
  }),
  BASE_PATH: '/sap'
}));

import { automationCreate, automationRelease, automationLink } from './automation';

const cfg: ProjectConfig = { connectionId: 'c1', projectCode: 'P', descriptionTemplate: '', defaults: { type: 'K' } };

beforeEach(() => {
  appStore.clear();
  issueProps.clear();
  createTransportCalls.length = 0;
  appStore.set('project:10001:config', cfg);
  appStore.set('connections:c1', { id: 'c1', label: 'DEV', hostname: 'https://x', client: '100', username: 'u', password: 'p' });
});

describe('automationCreate', () => {
  it('creates and outputs smart values', async () => {
    const r = await automationCreate({ payload: { projectId: '10001', issueKey: 'PROJ-1', email: 'a@b.com', type: 'K' }, context: { accountId: 'acc' } });
    expect(r.sapTransport.requestId).toBe('DEVK900123');
    expect(r.sapTransport.error).toBe('');
  });

  it('forwards the email input to createTransport', async () => {
    const r = await automationCreate({
      payload: { projectId: '10001', issueKey: 'PROJ-1', email: 'auto@b.com', type: 'K' },
      context: { accountId: 'acc' }
    });
    expect(r.sapTransport.requestId).toBe('DEVK900123');
    expect(createTransportCalls.length).toBeGreaterThan(0);
    expect(createTransportCalls[createTransportCalls.length - 1].email).toBe('auto@b.com');
  });
});

describe('automationLink', () => {
  it('appends an existing transport', async () => {
    const r = await automationLink({ payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900200' }, context: {} });
    expect(r.sapTransport.requestId).toBe('DEVK900200');
  });
});

describe('automationRelease', () => {
  it('all-linked releases every non-released entry', async () => {
    issueProps.set('PROJ-1', [
      { requestId: 'A', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' },
      { requestId: 'B', type: 'W', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'R', statusText: 'Released' }
    ]);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'all-linked' }, context: {} });
    expect(r.released).toEqual(['A']);
    expect(r.skipped).toEqual(['B']);
  });

  it('by-id releases the specified one', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'A', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }]);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'by-id', requestId: 'A' }, context: {} });
    expect(r.released).toEqual(['A']);
  });

  it('latest releases the last entry in the list', async () => {
    issueProps.set('PROJ-1', [
      { requestId: 'A', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' },
      { requestId: 'B', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-02', status: 'D', statusText: 'm' }
    ]);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'latest' }, context: {} });
    expect(r.released).toEqual(['B']);
  });

  it('all-linked + onlyType filter limits scope', async () => {
    issueProps.set('PROJ-1', [
      { requestId: 'A', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' },
      { requestId: 'B', type: 'W', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }
    ]);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'all-linked', onlyType: 'W' }, context: {} });
    expect(r.released).toEqual(['B']);
  });

  it('collects failures (SapError formatted as "CODE: msg")', async () => {
    issueProps.set('PROJ-1', [
      { requestId: 'BAD_SAP', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }
    ]);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'by-id', requestId: 'BAD_SAP' }, context: {} });
    expect(r.released).toEqual([]);
    expect(r.failed).toEqual([{ requestId: 'BAD_SAP', error: 'SAP: release failed' }]);
  });

  it('collects failures from non-Error throws via String(e) fallback', async () => {
    issueProps.set('PROJ-1', [
      { requestId: 'BAD_PLAIN', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }
    ]);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'by-id', requestId: 'BAD_PLAIN' }, context: {} });
    expect(r.failed).toEqual([{ requestId: 'BAD_PLAIN', error: 'plain string error' }]);
  });

  it('throws when mode=by-id without requestId', async () => {
    issueProps.set('PROJ-1', []);
    await expect(automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'by-id' }, context: {} }))
      .rejects.toThrow(/requestId required/);
  });

  it('latest on empty list yields nothing', async () => {
    issueProps.set('PROJ-1', []);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'latest' }, context: {} });
    expect(r.released).toEqual([]);
    expect(r.skipped).toEqual([]);
  });
});

describe('automationCreate / automationLink error paths', () => {
  it('automationCreate returns error string when resolver throws', async () => {
    appStore.delete('project:10001:config');
    const r = await automationCreate({ payload: { projectId: '10001', issueKey: 'PROJ-1', email: 'a@b.com', type: 'K' }, context: { accountId: 'acc' } });
    expect(r.sapTransport.requestId).toBe('');
    expect(r.sapTransport.error).toMatch(/configur/i);
  });

  it('automationLink returns error string when resolver throws', async () => {
    appStore.delete('project:10001:config');
    const r = await automationLink({ payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'X' }, context: {} });
    expect(r.sapTransport.requestId).toBe('');
    expect(r.sapTransport.error).toMatch(/configur/i);
  });
});

import { automationCreateHandler, automationReleaseHandler, automationLinkHandler } from '../index';

describe('automation function-module handlers (index exports)', () => {
  it('automationCreateHandler accepts (payload, context) directly', async () => {
    const r = await automationCreateHandler(
      { projectId: '10001', issueKey: 'PROJ-1', email: 'a@b.com', type: 'K' },
      { accountId: 'acc' }
    );
    expect(r.sapTransport.requestId).toBeTruthy();
  });

  it('automationLinkHandler accepts (payload, context) directly', async () => {
    const r = await automationLinkHandler(
      { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900200' },
      {}
    );
    expect(r.sapTransport.requestId).toBe('DEVK900200');
  });

  it('automationReleaseHandler accepts (payload, context) directly', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'A', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }]);
    const r = await automationReleaseHandler(
      { projectId: '10001', issueKey: 'PROJ-1', mode: 'by-id', requestId: 'A' },
      {}
    );
    expect(r.released).toEqual(['A']);
  });
});
