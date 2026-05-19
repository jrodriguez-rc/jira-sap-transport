import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Connection, ProjectConfig } from '../lib/types';

const appStore = new Map<string, unknown>();
const issueProps = new Map<string, unknown>();
const userByAcct = new Map<string, { emailAddress?: string }>([
  ['acc1', { emailAddress: 'a@b.com' }],
  ['acc-no-email', {}] // user exists but emailAddress is hidden
]);
// Identity of the user that /rest/api/3/myself answers for. Tests mutate this
// to simulate the no-email and 4xx error branches. Reset in beforeEach.
let currentUserAccountId = 'acc1';
// Special currentUserAccountId 'acc-403' triggers a non-200 from /myself; special
// issueKey 'BROKEN-1' triggers a non-200 from /issue. Both are wired here so the
// resolver's defensive error branches are exercised.

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: vi.fn(async (k: string) => appStore.get(k)),
    set: vi.fn(async (k: string, v: unknown) => { appStore.set(k, v); }),
    delete: vi.fn(),
    query: () => ({ where: () => ({ getMany: async () => ({ results: [] }) }) })
  },
  WhereConditions: {
    beginsWith: (value: string) => ({ condition: 'BEGINS_WITH', value })
  }
}));

vi.mock('@forge/api', () => ({
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
        const issueMatch = path.match(/\/rest\/api\/3\/issue\/([^/?]+)(?:\?.*)?$/);
        if (issueMatch) {
          if (issueMatch[1] === 'BROKEN-1') return { status: 500, json: async () => ({}) };
          return { status: 200, json: async () => ({ key: issueMatch[1], fields: { summary: 'Hi' } }) };
        }
        throw new Error('unexpected path ' + path);
      })
    }),
    asUser: () => ({
      requestJira: vi.fn(async (path: string) => {
        if (path.endsWith('/rest/api/3/myself')) {
          const acct = currentUserAccountId;
          if (acct === 'acc-403') return { status: 403, json: async () => ({}) };
          const u = userByAcct.get(acct);
          return { status: 200, json: async () => u ?? {} };
        }
        throw new Error('unexpected asUser path ' + path);
      })
    })
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

const conn: Connection = { id: 'c1', label: 'DEV', hostname: 'https://dev.sap.example', systemId: 'A4H', client: '100', username: 'u', password: 'p' };
const cfg: ProjectConfig = { connectionId: 'c1', projectCode: 'PRJX', descriptionTemplate: '', defaults: { type: 'K', target: 'QAS' } };

beforeEach(() => {
  appStore.clear();
  issueProps.clear();
  appStore.set('connections:c1', conn);
  appStore.set('project:10001:config', cfg);
  currentUserAccountId = 'acc1';
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

  it('persists the Connection systemId on the saved SapTransportEntry', async () => {
    await createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc1' }
    });
    const stored = issueProps.get('PROJ-1') as Array<{ systemId?: string }>;
    expect(stored[0].systemId).toBe('A4H');
  });

  it('rejects when no connection is configured', async () => {
    appStore.delete('project:10001:config');
    await expect(createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc1' }
    })).rejects.toThrow(/connection/i);
  });

  it('rejects when project config has no connectionId or override', async () => {
    appStore.set('project:10001:config', { projectCode: 'PRJX', descriptionTemplate: '', defaults: { type: 'K', target: 'QAS' } });
    await expect(createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc1' }
    })).rejects.toThrow(/No SAP connection configured/);
  });

  it('rejects when referenced connection is missing from storage', async () => {
    appStore.delete('connections:c1');
    await expect(createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc1' }
    })).rejects.toThrow(/does not exist/);
  });

  it('uses descriptionOverride when non-empty', async () => {
    const r = await createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K', descriptionOverride: 'Custom desc' },
      context: { accountId: 'acc1' }
    });
    expect(r.requestId).toBe('DEVK900123');
  });

  it('cascade: project template overrides connection template', async () => {
    appStore.set('connections:c1', { ...conn, descriptionTemplate: 'CONN: {{issue.key}}' });
    appStore.set('project:10001:config', { connectionId: 'c1', projectCode: 'PRJX', descriptionTemplate: 'PRJ: {{issue.key}}', defaults: { type: 'K', target: 'QAS' } });
    const r = await createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc1' }
    });
    expect(r.description).toBe('PRJ: PROJ-1');
  });

  it('cascade: connection template is used when project template is empty', async () => {
    appStore.set('connections:c1', { ...conn, descriptionTemplate: 'CONN: {{issue.key}}' });
    // project descriptionTemplate is '' (the existing default in beforeEach),
    // so the cascade must fall through to the connection template.
    const r = await createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc1' }
    });
    expect(r.description).toBe('CONN: PROJ-1');
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

  it('logs and rethrows when project has no configured connection', async () => {
    appStore.delete('project:10001:config');
    await expect(releaseTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900123' },
      context: { accountId: 'acc1' }
    })).rejects.toThrow(/connection/i);
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

  it('backfills the Connection systemId on legacy entries that lack it', async () => {
    // Legacy entry created before systemId was added to the model.
    issueProps.set('PROJ-1', [{ requestId: 'DEVK900123', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'X', statusText: 'old' }]);
    await refreshTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900123' },
      context: { accountId: 'acc1' }
    });
    const list = issueProps.get('PROJ-1') as Array<{ systemId?: string }>;
    expect(list[0].systemId).toBe('A4H');
  });

  it('logs and rethrows when SAP says not found', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'NOPE', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }]);
    await expect(refreshTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'NOPE' },
      context: { accountId: 'acc1' }
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('listTransportsResolver', () => {
  it('returns the stored entries', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'DEVK900123', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }]);
    const r = await listTransportsResolver({ payload: { issueKey: 'PROJ-1' }, context: {} });
    expect(r).toHaveLength(1);
  });
});

// The following tests cover defensive error branches that previously had no
// coverage: connection-override path, /user 4xx, user with no email,
// /issue 4xx, missing accountId without emailOverride, and link-idempotency.
describe('createTransportResolver — defensive branches', () => {
  it('uses connectionOverride when project config supplies one (skips connectionId lookup)', async () => {
    appStore.set('project:10001:config', {
      projectCode: 'PRJX',
      descriptionTemplate: '',
      defaults: { type: 'K', target: 'QAS' },
      connectionOverride: { hostname: 'https://qas.sap.example', client: '200', username: 'u2', password: 'p2' }
    });
    const r = await createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc1' }
    });
    expect(r.requestId).toBe('DEVK900123');
  });

  it('rejects when /myself returns a non-200 status', async () => {
    currentUserAccountId = 'acc-403';
    await expect(createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc-403' }
    })).rejects.toThrow(/Cannot resolve user email/);
  });

  it('rejects when /myself returns 200 but no emailAddress', async () => {
    currentUserAccountId = 'acc-no-email';
    await expect(createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc-no-email' }
    })).rejects.toThrow(/no email visible/);
  });

  it('rejects when /issue returns a non-200 status', async () => {
    await expect(createTransportResolver({
      payload: { projectId: '10001', issueKey: 'BROKEN-1', type: 'K' },
      context: { accountId: 'acc1' }
    })).rejects.toThrow(/Cannot read issue/);
  });

  it('uses emailOverride and skips the /myself lookup entirely', async () => {
    // accountId is missing on purpose — the emailOverride path is the bypass.
    const r = await createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K', emailOverride: 'auto@bot.com' },
      context: {}
    });
    expect(r.requestId).toBe('DEVK900123');
  });
});

describe('linkTransportResolver — idempotency', () => {
  it('does not append the entry twice when the same requestId is already linked', async () => {
    issueProps.set('PROJ-1', [{
      requestId: 'DEVK900123', type: 'K', target: 'QAS', description: 'x',
      createdAt: '2026-01-01', status: 'D', statusText: 'm'
    }]);
    await linkTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900123' },
      context: { accountId: 'acc1' }
    });
    const list = issueProps.get('PROJ-1') as Array<{ requestId: string }>;
    expect(list).toHaveLength(1);
  });
});

describe('refreshTransportResolver — entries that do not match', () => {
  it('keeps non-matching entries unchanged when refreshing one specific requestId', async () => {
    issueProps.set('PROJ-1', [
      { requestId: 'DEVK900123', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'X', statusText: 'old' },
      { requestId: 'OTHER-999', type: 'K', target: 'QAS', description: 'y', createdAt: '2026-01-02', status: 'D', statusText: 'modifiable' }
    ]);
    await refreshTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900123' },
      context: { accountId: 'acc1' }
    });
    const list = issueProps.get('PROJ-1') as Array<{ requestId: string; status: string; statusText: string }>;
    // The refreshed entry got the new status; the un-targeted entry is untouched.
    expect(list.find((e) => e.requestId === 'DEVK900123')?.status).toBe('D');
    expect(list.find((e) => e.requestId === 'OTHER-999')?.statusText).toBe('modifiable');
  });
});
