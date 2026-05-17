import { describe, it, expect } from 'vitest';
import { buildUrl, basicAuthHeader, BASE_PATH } from './sap-client';

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
