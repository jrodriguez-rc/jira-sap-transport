import { describe, it, expect } from 'vitest';
import { buildUrl, basicAuthHeader, BASE_PATH, parseODataError, mapSapMessages } from './sap-client';
import { SapError } from './errors';

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
