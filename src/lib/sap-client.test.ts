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
    const client = createSapClient(conn);
    expect(await client.testConnection()).toEqual({ ok: true });
  });
});

describe('createSapClient.createTransport', () => {
  it('creates a transport and returns the entity', async () => {
    const client = createSapClient(conn);
    const r = await client.createTransport({ description: 'PROJ-1 Hello', type: 'K', email: 'a@b.com', target: 'QAS' });
    expect(r.Request).toBe('DEVK900123');
    expect(r.Status).toBe('D');
  });

  it('throws SapError parsed from the OData response on 4xx', async () => {
    const client = createSapClient(conn);
    await expect(
      client.createTransport({ description: 'X', type: 'K', email: 'a@b.com', target: 'BAD' })
    ).rejects.toMatchObject({ code: 'INVALID_TARGET', httpStatus: 400 });
  });

  it('throws RangeError when description exceeds 60 chars', async () => {
    const client = createSapClient(conn);
    await expect(
      client.createTransport({ description: 'a'.repeat(61), type: 'K', email: 'a@b.com' })
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('createSapClient.releaseTransport', () => {
  it('returns the entity on success', async () => {
    const r = await createSapClient(conn).releaseTransport('DEVK900123');
    expect(r.Status).toBe('R');
  });

  it('still resolves with warnings in SAP__Messages', async () => {
    const r = await createSapClient(conn).releaseTransport('DEVK900999');
    expect(r.SAP__Messages?.[0].numericSeverity).toBe(2);
  });
});

describe('createSapClient.getTransport', () => {
  it('returns the entity', async () => {
    const r = await createSapClient(conn).getTransport('DEVK900123');
    expect(r.Request).toBe('DEVK900123');
  });

  it('throws SapError on 404', async () => {
    await expect(createSapClient(conn).getTransport('NOPE')).rejects.toMatchObject({
      code: 'NOT_FOUND', httpStatus: 404
    });
  });

  it('throws SapError with code AUTH on 401', async () => {
    await expect(createSapClient(conn).getTransport('UNAUTHZ')).rejects.toMatchObject({
      code: 'AUTH', httpStatus: 401
    });
  });
});
