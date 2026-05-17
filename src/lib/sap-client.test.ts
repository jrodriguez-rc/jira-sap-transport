import { describe, it, expect } from 'vitest';
import { buildUrl, basicAuthHeader, BASE_PATH, parseODataError, mapSapMessages } from './sap-client';
import { SapError } from './errors';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createSapClient, BASE_PATH as BP } from './sap-client';
import createOk from '../__tests__/fixtures/create-ok.json';
import releaseOk from '../__tests__/fixtures/release-ok.json';
import releaseWarning from '../__tests__/fixtures/release-warning.json';
import createError from '../__tests__/fixtures/create-error.json';
import get404 from '../__tests__/fixtures/get-404.json';
import serviceRoot from '../__tests__/fixtures/service-root.json';

describe('buildUrl', () => {
  const conn = { hostname: 'https://dev.sap.lan', client: '100', username: 'u', password: 'p' };

  it('joins base path and appends sap-client', () => {
    expect(buildUrl(conn, '/Request')).toBe(
      `https://dev.sap.lan${BASE_PATH}/Request?sap-client=100`
    );
  });

  it('uses & when the path already has a query string', () => {
    expect(buildUrl(conn, "/Request('X')?$select=Request")).toBe(
      `https://dev.sap.lan${BASE_PATH}/Request('X')?$select=Request&sap-client=100`
    );
  });

  it('strips a trailing slash from hostname', () => {
    expect(buildUrl({ ...conn, hostname: 'https://dev.sap.lan/' }, '/x')).toBe(
      `https://dev.sap.lan${BASE_PATH}/x?sap-client=100`
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

const HOST = 'https://dev.sap.lan';
const CLIENT = '100';

const handlers = [
  http.get(`${HOST}${BP}/`, ({ request }) => {
    const u = new URL(request.url);
    if (u.searchParams.get('sap-client') !== CLIENT) return new HttpResponse(null, { status: 400 });
    return HttpResponse.json(serviceRoot);
  }),
  http.post(`${HOST}${BP}/Request/SAP__self.Create`, async ({ request }) => {
    const u = new URL(request.url);
    if (u.searchParams.get('sap-client') !== CLIENT) return new HttpResponse(null, { status: 400 });
    const body = (await request.json()) as { Target?: string };
    if (body.Target === 'BAD') return HttpResponse.json(createError, { status: 400 });
    return HttpResponse.json(createOk, { status: 201 });
  }),
  http.post(`${HOST}${BP}/Request\\('DEVK900123'\\)/SAP__self.Release`, () => HttpResponse.json(releaseOk)),
  http.post(`${HOST}${BP}/Request\\('DEVK900999'\\)/SAP__self.Release`, () => HttpResponse.json(releaseWarning)),
  http.get(`${HOST}${BP}/Request\\('DEVK900123'\\)`, () => HttpResponse.json(createOk)),
  http.get(`${HOST}${BP}/Request\\('NOPE'\\)`, () => HttpResponse.json(get404, { status: 404 })),
  http.get(`${HOST}${BP}/Request\\('UNAUTHZ'\\)`, () => HttpResponse.json({}, { status: 401 }))
];

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const conn = { hostname: HOST, client: CLIENT, username: 'u', password: 'p' };

describe('createSapClient.testConnection', () => {
  it('returns ok:true on a valid service-root response', async () => {
    const client = createSapClient(conn, globalThis.fetch as never);
    expect(await client.testConnection()).toEqual({ ok: true });
  });
});

describe('createSapClient.createTransport', () => {
  it('creates a transport and returns the entity', async () => {
    const client = createSapClient(conn, globalThis.fetch as never);
    const r = await client.createTransport({ description: 'PROJ-1 Hello', type: 'K', email: 'a@b.com', target: 'QAS' });
    expect(r.Request).toBe('DEVK900123');
    expect(r.Status).toBe('D');
  });

  it('throws SapError parsed from the OData response on 4xx', async () => {
    const client = createSapClient(conn, globalThis.fetch as never);
    await expect(
      client.createTransport({ description: 'X', type: 'K', email: 'a@b.com', target: 'BAD' })
    ).rejects.toMatchObject({ code: 'INVALID_TARGET', httpStatus: 400 });
  });

  it('throws RangeError when description exceeds 60 chars', async () => {
    const client = createSapClient(conn, globalThis.fetch as never);
    await expect(
      client.createTransport({ description: 'a'.repeat(61), type: 'K', email: 'a@b.com' })
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('createSapClient.releaseTransport', () => {
  it('returns the entity on success', async () => {
    const r = await createSapClient(conn, globalThis.fetch as never).releaseTransport('DEVK900123');
    expect(r.Status).toBe('R');
  });

  it('still resolves with warnings in SAP__Messages', async () => {
    const r = await createSapClient(conn, globalThis.fetch as never).releaseTransport('DEVK900999');
    expect(r.SAP__Messages?.[0].numericSeverity).toBe(2);
  });
});

describe('createSapClient.getTransport', () => {
  it('returns the entity', async () => {
    const r = await createSapClient(conn, globalThis.fetch as never).getTransport('DEVK900123');
    expect(r.Request).toBe('DEVK900123');
  });

  it('throws SapError on 404', async () => {
    await expect(createSapClient(conn, globalThis.fetch as never).getTransport('NOPE')).rejects.toMatchObject({
      code: 'NOT_FOUND', httpStatus: 404
    });
  });

  it('throws SapError with code AUTH on 401', async () => {
    await expect(createSapClient(conn, globalThis.fetch as never).getTransport('UNAUTHZ')).rejects.toMatchObject({
      code: 'AUTH', httpStatus: 401
    });
  });
});

describe('parseODataError extra shapes', () => {
  it('handles error.message as a plain string', () => {
    const e = parseODataError(500, { error: { code: 'CX_Y', message: 'plain string here' } });
    expect(e.code).toBe('CX_Y');
    expect(e.message).toBe('plain string here');
  });
});

describe('createSapClient.testConnection extra branches', () => {
  it('returns ok:false with code BAD_SERVICE when the service root has no Request entity set', async () => {
    server.use(
      http.get(`${HOST}${BP}/`, () => HttpResponse.json({ '@odata.context': '$metadata', value: [] }))
    );
    const res = await createSapClient(conn, globalThis.fetch as never).testConnection();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('BAD_SERVICE');
    }
  });

  it('returns ok:false with code NETWORK when fetch itself throws', async () => {
    const throwingFetch = async () => { throw new Error('connect timeout'); };
    const res = await createSapClient(conn, throwingFetch as never).testConnection();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('NETWORK');
      expect(res.error.message).toContain('connect timeout');
    }
  });
});

describe('createSapClient CSRF retry — negative cases', () => {
  it('does NOT fetch CSRF token for GET 403 (no retry on safe methods)', async () => {
    let csrfFetchCount = 0;
    server.use(
      http.get(`${HOST}${BP}/Request%28%27FORBID%27%29`, () => new HttpResponse(null, { status: 403 })),
      http.get(`${HOST}${BP}/Request\\('FORBID'\\)`, () => new HttpResponse(null, { status: 403 })),
      http.get(`${HOST}${BP}/`, ({ request }) => {
        if (request.headers.get('x-csrf-token') === 'Fetch') {
          csrfFetchCount += 1;
        }
        return HttpResponse.json(serviceRoot);
      })
    );
    await expect(createSapClient(conn, globalThis.fetch as never).getTransport('FORBID')).rejects.toMatchObject({ httpStatus: 403 });
    expect(csrfFetchCount).toBe(0);
  });

  it('throws CSRF_FETCH_FAILED when SAP demands CSRF but the fetch returns no token', async () => {
    server.use(
      http.post(`${HOST}${BP}/Request/SAP__self.Create`, () =>
        new HttpResponse(null, { status: 403, headers: { 'x-csrf-token': 'Required' } })
      ),
      http.get(`${HOST}${BP}/`, () =>
        new HttpResponse(JSON.stringify(serviceRoot), { status: 200, headers: { 'content-type': 'application/json' } })
      )
    );
    await expect(
      createSapClient(conn, globalThis.fetch as never).createTransport({ description: 'X', type: 'K', email: 'a@b.com' })
    ).rejects.toMatchObject({ code: 'CSRF_FETCH_FAILED', httpStatus: 403 });
  });
});

describe('createSapClient CSRF retry', () => {
  it('fetches token on 403 with x-csrf-token: Required, then retries POST with the token', async () => {
    let phase: 'first' | 'fetch' | 'retry' = 'first';
    server.use(
      http.post(`${HOST}${BP}/Request/SAP__self.Create`, ({ request }) => {
        if (phase === 'first') {
          phase = 'fetch';
          return new HttpResponse(null, { status: 403, headers: { 'x-csrf-token': 'Required' } });
        }
        // phase === 'retry'
        const token = request.headers.get('x-csrf-token');
        if (token !== 'ABCD1234') return new HttpResponse(null, { status: 403 });
        return HttpResponse.json(createOk, { status: 201 });
      }),
      http.get(`${HOST}${BP}/`, ({ request }) => {
        if (request.headers.get('x-csrf-token') !== 'Fetch') {
          return HttpResponse.json(serviceRoot);
        }
        phase = 'retry';
        return new HttpResponse(JSON.stringify(serviceRoot), {
          status: 200,
          headers: { 'x-csrf-token': 'ABCD1234', 'content-type': 'application/json' }
        });
      })
    );

    const client = createSapClient(conn, globalThis.fetch as never);
    const r = await client.createTransport({ description: 'X', type: 'K', email: 'a@b.com' });
    expect(r.Request).toBe('DEVK900123');
  });
});

describe('createSapClient CSRF + session cookie', () => {
  it('captures set-cookie on Fetch and replays it as Cookie on retry', async () => {
    // Use a hand-rolled fetch stub (rather than globalThis.fetch + msw) so we can
    // assert on exactly what the client passes as the Cookie header, without
    // undici's auto-tracking cookie jar muddying the assertion.
    type FetchInit = { method?: string; headers?: Record<string, string>; body?: string };
    const calls: Array<{ url: string; init: FetchInit }> = [];

    function makeRes(status: number, headers: Record<string, string>, body: unknown) {
      const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      return Promise.resolve({
        status,
        json: async () => body,
        headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }
      });
    }

    let phase: 'first' | 'fetch' | 'retry' = 'first';
    const fakeFetch = (url: string, init?: FetchInit) => {
      calls.push({ url, init: init ?? {} });
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.includes('/Request/SAP__self.Create')) {
        if (phase === 'first') {
          phase = 'fetch';
          return makeRes(403, { 'x-csrf-token': 'Required' }, null);
        }
        return makeRes(201, { 'content-type': 'application/json' }, createOk);
      }
      if (method === 'GET' && (init?.headers as Record<string, string> | undefined)?.['x-csrf-token'] === 'Fetch') {
        phase = 'retry';
        return makeRes(
          200,
          {
            'x-csrf-token': 'TOKEN_X',
            'set-cookie': 'SAP_SESSIONID_NPL_001=ABCDEF; Path=/; HttpOnly',
            'content-type': 'application/json'
          },
          serviceRoot
        );
      }
      return makeRes(200, { 'content-type': 'application/json' }, serviceRoot);
    };

    const client = createSapClient(conn, fakeFetch as never);
    const r = await client.createTransport({ description: 'X', type: 'K', email: 'a@b.com' });
    expect(r.Request).toBe('DEVK900123');

    // Three calls: the initial POST (403), the CSRF Fetch GET, and the retry POST.
    expect(calls).toHaveLength(3);
    const retry = calls[2];
    expect(retry.init.method).toBe('POST');
    expect(retry.init.headers?.['x-csrf-token']).toBe('TOKEN_X');
    expect(retry.init.headers?.['Cookie']).toBe('SAP_SESSIONID_NPL_001=ABCDEF');
  });
});
