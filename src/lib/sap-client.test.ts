import { describe, it, expect, vi } from 'vitest';
import { basicAuthHeader, buildRemotePath, BASE_PATH, parseODataError, mapSapMessages, createSapClient } from './sap-client';
import type { InvokeRemoteImpl } from './sap-client';
import { SapError } from './errors';
import type { SapClientCallContext } from './types';
import createOk from '../__tests__/fixtures/create-ok.json';
import releaseOk from '../__tests__/fixtures/release-ok.json';
import releaseWarning from '../__tests__/fixtures/release-warning.json';
import createError from '../__tests__/fixtures/create-error.json';
import get404 from '../__tests__/fixtures/get-404.json';
import serviceRoot from '../__tests__/fixtures/service-root.json';

describe('buildRemotePath', () => {
  it('joins base path and appends sap-client', () => {
    expect(buildRemotePath('100', '/Request')).toBe(`${BASE_PATH}/Request?sap-client=100`);
  });

  it('uses & when the path already has a query string', () => {
    expect(buildRemotePath('100', "/Request('X')?$select=Request")).toBe(
      `${BASE_PATH}/Request('X')?$select=Request&sap-client=100`
    );
  });
});

describe('basicAuthHeader', () => {
  it('produces a base64 Basic header', () => {
    const h = basicAuthHeader({ username: 'foo', password: 'bar' });
    expect(h).toBe('Basic ' + Buffer.from('foo:bar').toString('base64'));
  });
});

describe('BASE_PATH', () => {
  it('matches the service registered path', () => {
    expect(BASE_PATH).toBe('/sap/opu/odata4/sap/zjira_api_transportrequest_o4/srvd_a2x/sap/zjira_api_transportrequest_o4/0001');
  });
});

describe('parseODataError', () => {
  it('extracts code and message from standard OData error', () => {
    const body = { error: { code: 'CX_X', message: { value: 'Something broke' } } };
    const e = parseODataError(500, body);
    expect(e).toBeInstanceOf(SapError);
    expect(e.code).toBe('CX_X');
    expect(e.message).toBe('Something broke');
    expect(e.httpStatus).toBe(500);
    expect(e.severity).toBe('error');
  });

  it('falls back to a synthetic code when JSON has no error.code', () => {
    const e = parseODataError(500, { weird: 'shape' });
    expect(e.code).toBe('HTTP_500');
    expect(e.message).toContain('Unknown SAP error');
  });

  it('returns AuthError-like SapError for 401', () => {
    const e = parseODataError(401, {});
    expect(e.httpStatus).toBe(401);
    expect(e.code).toBe('AUTH');
  });

  it('handles error.message as a plain string', () => {
    const e = parseODataError(500, { error: { code: 'CX_Y', message: 'plain string here' } });
    expect(e.code).toBe('CX_Y');
    expect(e.message).toBe('plain string here');
  });
});

describe('mapSapMessages', () => {
  it('maps numericSeverity to severity strings', () => {
    const ms = [
      { code: 'A', message: 'a', numericSeverity: 1 as const, transition: false, additionalTargets: [] },
      { code: 'B', message: 'b', numericSeverity: 2 as const, transition: false, additionalTargets: [] },
      { code: 'C', message: 'c', numericSeverity: 3 as const, transition: false, additionalTargets: [] },
      { code: 'D', message: 'd', numericSeverity: 4 as const, transition: false, additionalTargets: [] }
    ];
    const out = mapSapMessages(ms);
    expect(out.map((m) => m.severity)).toEqual(['info', 'warning', 'error', 'error']);
  });
});

// ---- programmable invokeRemote test harness -----------------------------------

const CLIENT = '100';
const conn: SapClientCallContext = { slotKey: 'sap-backend-1', client: CLIENT, username: 'u', password: 'p' };

interface FakeResponseInit {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

function fakeRes({ status, headers = {}, body }: FakeResponseInit) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return Promise.resolve({
    status,
    json: async () => (body === undefined ? {} : body),
    headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }
  });
}

type Route = (req: { path: string; method: string; headers: Record<string, string>; body?: string }) => ReturnType<typeof fakeRes> | null;

function makeInvokeRemote(routes: Route[]): { impl: InvokeRemoteImpl; calls: Array<{ key: string; path: string; method: string; headers: Record<string, string>; body?: string }> } {
  const calls: Array<{ key: string; path: string; method: string; headers: Record<string, string>; body?: string }> = [];
  const impl: InvokeRemoteImpl = (key, opts) => {
    const req = {
      path: opts.path,
      method: opts.method ?? 'GET',
      headers: opts.headers ?? {},
      body: opts.body
    };
    calls.push({ key, ...req });
    for (const r of routes) {
      const out = r(req);
      if (out) return out;
    }
    throw new Error(`Unrouted: ${req.method} ${req.path}`);
  };
  return { impl, calls };
}

// Convenience: a route that responds to the service-root call.
const serviceRootRoute: Route = (req) =>
  req.method === 'GET' && req.path === `${BASE_PATH}/?sap-client=${CLIENT}`
    ? fakeRes({ status: 200, body: serviceRoot, headers: { 'content-type': 'application/json' } })
    : null;

describe('createSapClient.testConnection', () => {
  it('returns ok:true on a valid service-root response', async () => {
    const { impl } = makeInvokeRemote([serviceRootRoute]);
    const client = createSapClient(conn, impl);
    expect(await client.testConnection()).toEqual({ ok: true });
  });

  it('returns ok:false with BAD_SERVICE when the service root has no Request entity set', async () => {
    const { impl } = makeInvokeRemote([
      (req) => req.method === 'GET' && req.path.startsWith(`${BASE_PATH}/?`)
        ? fakeRes({ status: 200, body: { '@odata.context': '$metadata', value: [] } })
        : null
    ]);
    const res = await createSapClient(conn, impl).testConnection();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('BAD_SERVICE');
    }
  });

  it('returns ok:false with NETWORK when invokeRemote itself throws', async () => {
    const throwing: InvokeRemoteImpl = async () => { throw new Error('connect timeout'); };
    const res = await createSapClient(conn, throwing).testConnection();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('NETWORK');
      expect(res.error.message).toContain('connect timeout');
    }
  });

  it('returns ok:false with the OData error when the service root returns non-200', async () => {
    const { impl } = makeInvokeRemote([
      (req) => req.method === 'GET' && req.path.startsWith(`${BASE_PATH}/?`)
        ? fakeRes({ status: 500, body: { error: { code: 'BOOM', message: { value: 'down' } } } })
        : null
    ]);
    const res = await createSapClient(conn, impl).testConnection();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('BOOM');
      expect(res.error.httpStatus).toBe(500);
    }
  });
});

describe('createSapClient.createTransport', () => {
  it('creates a transport and returns the entity', async () => {
    const { impl } = makeInvokeRemote([
      (req) =>
        req.method === 'POST' && req.path.startsWith(`${BASE_PATH}/Request/SAP__self.Create`)
          ? fakeRes({ status: 201, body: createOk })
          : null
    ]);
    const r = await createSapClient(conn, impl).createTransport({ description: 'PROJ-1 Hello', type: 'K', email: 'a@b.com', target: 'QAS' });
    expect(r.Request).toBe('DEVK900123');
    expect(r.Status).toBe('D');
  });

  it('forwards client + auth to invokeRemote and uses slotKey as the remote key', async () => {
    const { impl, calls } = makeInvokeRemote([
      (req) =>
        req.method === 'POST' && req.path.startsWith(`${BASE_PATH}/Request/SAP__self.Create`)
          ? fakeRes({ status: 201, body: createOk })
          : null
    ]);
    await createSapClient(conn, impl).createTransport({ description: 'X', type: 'K', email: 'a@b.com' });
    expect(calls[0].key).toBe('sap-backend-1');
    expect(calls[0].path).toContain(`sap-client=${CLIENT}`);
    expect(calls[0].headers.Authorization).toMatch(/^Basic /);
  });

  it('throws SapError parsed from the OData response on 4xx', async () => {
    const { impl } = makeInvokeRemote([
      (req) =>
        req.method === 'POST' && req.path.startsWith(`${BASE_PATH}/Request/SAP__self.Create`)
          ? fakeRes({ status: 400, body: createError })
          : null
    ]);
    await expect(
      createSapClient(conn, impl).createTransport({ description: 'X', type: 'K', email: 'a@b.com', target: 'BAD' })
    ).rejects.toMatchObject({ code: 'INVALID_TARGET', httpStatus: 400 });
  });

  it('throws RangeError when description exceeds 60 chars', async () => {
    const { impl } = makeInvokeRemote([]);
    await expect(
      createSapClient(conn, impl).createTransport({ description: 'a'.repeat(61), type: 'K', email: 'a@b.com' })
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('createSapClient.releaseTransport', () => {
  it('returns the entity on success', async () => {
    const { impl } = makeInvokeRemote([
      (req) =>
        req.method === 'POST' && req.path.includes("/Request('DEVK900123')/SAP__self.Release")
          ? fakeRes({ status: 200, body: releaseOk })
          : null
    ]);
    const r = await createSapClient(conn, impl).releaseTransport('DEVK900123');
    expect(r.Status).toBe('R');
  });

  it('still resolves with warnings in SAP__Messages', async () => {
    const { impl } = makeInvokeRemote([
      (req) =>
        req.method === 'POST' && req.path.includes("/Request('DEVK900999')/SAP__self.Release")
          ? fakeRes({ status: 200, body: releaseWarning })
          : null
    ]);
    const r = await createSapClient(conn, impl).releaseTransport('DEVK900999');
    expect(r.SAP__Messages?.[0].numericSeverity).toBe(2);
  });
});

describe('createSapClient.getTransport', () => {
  it('returns the entity', async () => {
    const { impl } = makeInvokeRemote([
      (req) =>
        req.method === 'GET' && req.path.includes("/Request('DEVK900123')")
          ? fakeRes({ status: 200, body: createOk })
          : null
    ]);
    const r = await createSapClient(conn, impl).getTransport('DEVK900123');
    expect(r.Request).toBe('DEVK900123');
  });

  it('throws SapError on 404', async () => {
    const { impl } = makeInvokeRemote([
      (req) =>
        req.method === 'GET' && req.path.includes("/Request('NOPE')")
          ? fakeRes({ status: 404, body: get404 })
          : null
    ]);
    await expect(createSapClient(conn, impl).getTransport('NOPE')).rejects.toMatchObject({
      code: 'NOT_FOUND', httpStatus: 404
    });
  });

  it('throws SapError with code AUTH on 401', async () => {
    const { impl } = makeInvokeRemote([
      (req) =>
        req.method === 'GET' && req.path.includes("/Request('UNAUTHZ')")
          ? fakeRes({ status: 401, body: {} })
          : null
    ]);
    await expect(createSapClient(conn, impl).getTransport('UNAUTHZ')).rejects.toMatchObject({
      code: 'AUTH', httpStatus: 401
    });
  });
});

describe('createSapClient CSRF retry — negative cases', () => {
  it('does NOT fetch CSRF token for GET 403 (no retry on safe methods)', async () => {
    let csrfFetchCount = 0;
    const { impl } = makeInvokeRemote([
      (req) => {
        if (req.method === 'GET' && req.path.includes("/Request('FORBID')")) {
          return fakeRes({ status: 403, body: {} });
        }
        if (req.method === 'GET' && req.path === `${BASE_PATH}/?sap-client=${CLIENT}` && req.headers['x-csrf-token'] === 'Fetch') {
          csrfFetchCount += 1;
          return fakeRes({ status: 200, body: serviceRoot });
        }
        return null;
      }
    ]);
    await expect(createSapClient(conn, impl).getTransport('FORBID')).rejects.toMatchObject({ httpStatus: 403 });
    expect(csrfFetchCount).toBe(0);
  });

  it('throws CSRF_FETCH_FAILED when SAP demands CSRF but the fetch returns no token', async () => {
    const { impl } = makeInvokeRemote([
      (req) =>
        req.method === 'POST' && req.path.startsWith(`${BASE_PATH}/Request/SAP__self.Create`)
          ? fakeRes({ status: 403, headers: { 'x-csrf-token': 'Required' }, body: {} })
          : null,
      (req) =>
        req.method === 'GET' && req.path === `${BASE_PATH}/?sap-client=${CLIENT}` && req.headers['x-csrf-token'] === 'Fetch'
          ? fakeRes({ status: 200, body: serviceRoot })
          : null
    ]);
    await expect(
      createSapClient(conn, impl).createTransport({ description: 'X', type: 'K', email: 'a@b.com' })
    ).rejects.toMatchObject({ code: 'CSRF_FETCH_FAILED', httpStatus: 403 });
  });
});

describe('createSapClient CSRF retry', () => {
  it('fetches token on 403 with x-csrf-token: Required, then retries POST with the token', async () => {
    let phase: 'first' | 'fetch' | 'retry' = 'first';
    const { impl } = makeInvokeRemote([
      (req) => {
        if (req.method === 'POST' && req.path.startsWith(`${BASE_PATH}/Request/SAP__self.Create`)) {
          if (phase === 'first') {
            phase = 'fetch';
            return fakeRes({ status: 403, headers: { 'x-csrf-token': 'Required' }, body: {} });
          }
          if (req.headers['x-csrf-token'] !== 'ABCD1234') return fakeRes({ status: 403, body: {} });
          return fakeRes({ status: 201, body: createOk });
        }
        if (req.method === 'GET' && req.path === `${BASE_PATH}/?sap-client=${CLIENT}` && req.headers['x-csrf-token'] === 'Fetch') {
          phase = 'retry';
          return fakeRes({ status: 200, headers: { 'x-csrf-token': 'ABCD1234' }, body: serviceRoot });
        }
        return null;
      }
    ]);
    const client = createSapClient(conn, impl);
    const r = await client.createTransport({ description: 'X', type: 'K', email: 'a@b.com' });
    expect(r.Request).toBe('DEVK900123');
  });
});

describe('createSapClient CSRF + session cookie', () => {
  it('captures set-cookie on Fetch and replays it as Cookie on retry', async () => {
    let phase: 'first' | 'fetch' | 'retry' = 'first';
    const { impl, calls } = makeInvokeRemote([
      (req) => {
        if (req.method === 'POST' && req.path.startsWith(`${BASE_PATH}/Request/SAP__self.Create`)) {
          if (phase === 'first') {
            phase = 'fetch';
            return fakeRes({ status: 403, headers: { 'x-csrf-token': 'Required' }, body: {} });
          }
          return fakeRes({ status: 201, body: createOk });
        }
        if (req.method === 'GET' && req.path === `${BASE_PATH}/?sap-client=${CLIENT}` && req.headers['x-csrf-token'] === 'Fetch') {
          phase = 'retry';
          return fakeRes({
            status: 200,
            headers: {
              'x-csrf-token': 'TOKEN_X',
              'set-cookie': 'SAP_SESSIONID_NPL_001=ABCDEF; Path=/; HttpOnly'
            },
            body: serviceRoot
          });
        }
        return null;
      }
    ]);

    const client = createSapClient(conn, impl);
    const r = await client.createTransport({ description: 'X', type: 'K', email: 'a@b.com' });
    expect(r.Request).toBe('DEVK900123');

    // Three calls: the initial POST (403), the CSRF Fetch GET, and the retry POST.
    expect(calls).toHaveLength(3);
    const retry = calls[2];
    expect(retry.method).toBe('POST');
    expect(retry.headers['x-csrf-token']).toBe('TOKEN_X');
    expect(retry.headers['Cookie']).toBe('SAP_SESSIONID_NPL_001=ABCDEF');
  });
});

describe('default invokeRemote bridge', () => {
  it('delegates to @forge/api invokeRemote when no impl is provided', async () => {
    vi.resetModules();
    vi.doMock('@forge/api', () => ({
      default: {
        invokeRemote: vi.fn(async () => ({
          status: 200,
          json: async () => serviceRoot,
          headers: { get: () => null }
        }))
      }
    }));
    const mod = await import('./sap-client');
    const c = mod.createSapClient(conn);
    const res = await c.testConnection();
    expect(res).toEqual({ ok: true });
    const api = (await import('@forge/api')).default as unknown as { invokeRemote: { mock: { calls: unknown[] } } };
    expect(api.invokeRemote.mock.calls.length).toBeGreaterThan(0);
    vi.doUnmock('@forge/api');
  });
});
