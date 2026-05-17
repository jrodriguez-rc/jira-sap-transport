import api from '@forge/api';
import { SapError, type SapErrorSeverity } from './errors';
import type { RequestType, SapClientCallContext, SapMessage, TransportType } from './types';

export const BASE_PATH =
  '/sap/opu/odata4/sap/zjira_api_transportrequest_o4/srvd_a2x/sap/zjira_api_transportrequest_o4/0001';

export function buildUrl(conn: Pick<SapClientCallContext, 'hostname' | 'client'>, path: string): string {
  const host = conn.hostname.replace(/\/+$/, '');
  const sep = path.includes('?') ? '&' : '?';
  return `${host}${BASE_PATH}${path}${sep}sap-client=${encodeURIComponent(conn.client)}`;
}

export function basicAuthHeader(conn: { username: string; password: string }): string {
  const token = Buffer.from(`${conn.username}:${conn.password}`).toString('base64');
  return `Basic ${token}`;
}

interface ODataError {
  error?: { code?: string; message?: { value?: string } | string; target?: string };
}

export function parseODataError(status: number, body: unknown): SapError {
  const odata = (body ?? {}) as ODataError;
  const err = odata.error ?? {};
  const code = err.code ?? (status === 401 ? 'AUTH' : `HTTP_${status}`);
  const rawMessage = typeof err.message === 'string'
    ? err.message
    : (err.message?.value ?? `Unknown SAP error (HTTP ${status})`);
  return new SapError({
    code,
    message: rawMessage,
    severity: 'error',
    target: err.target,
    httpStatus: status
  });
}

export function mapSapMessages(messages: SapMessage[]): Array<{
  code: string;
  message: string;
  severity: SapErrorSeverity;
  target?: string;
}> {
  return messages.map((m) => ({
    code: m.code,
    message: m.message,
    target: m.target,
    severity: m.numericSeverity === 1 ? 'info' : m.numericSeverity === 2 ? 'warning' : 'error'
  }));
}

export interface SapClient {
  testConnection(): Promise<{ ok: true } | { ok: false; error: SapError }>;
  createTransport(input: { description: string; type: TransportType; email: string; target?: string }): Promise<RequestType>;
  releaseTransport(requestId: string): Promise<RequestType>;
  getTransport(requestId: string): Promise<RequestType>;
}

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  json: () => Promise<unknown>;
  headers: { get: (name: string) => string | null };
}>;

export function createSapClient(conn: SapClientCallContext, fetchImpl: FetchLike = (api.fetch as unknown as FetchLike)): SapClient {
  const auth = basicAuthHeader(conn);

  async function safeJson(res: { json: () => Promise<unknown> }): Promise<unknown> {
    try { return await res.json(); } catch { return {}; }
  }

  let csrfToken: string | null = null;
  let csrfCookie: string | null = null;

  function extractCookies(setCookieHeader: string | null): string | null {
    if (!setCookieHeader) return null;
    // set-cookie may be comma-joined when multiple cookies are returned via headers.get().
    // Each piece is `name=value; Path=...; HttpOnly; SameSite=...`. We need only the `name=value`.
    const pairs = setCookieHeader
      .split(/,(?=[^;]+=[^;]+)/)             // split on commas that precede another "name=value"
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean);
    return pairs.length > 0 ? pairs.join('; ') : null;
  }

  async function fetchCsrf(): Promise<{ token: string | null; cookie: string | null }> {
    const url = buildUrl(conn, '/');
    const res = await fetchImpl(url, { method: 'GET', headers: { Authorization: auth, 'x-csrf-token': 'Fetch', Accept: 'application/json' } });
    return {
      token: res.headers.get('x-csrf-token'),
      cookie: extractCookies(res.headers.get('set-cookie'))
    };
  }

  async function callJson(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: unknown }> {
    const url = buildUrl(conn, path);
    const isUnsafe = !!init?.method && init.method !== 'GET';
    const headers: Record<string, string> = {
      Authorization: auth,
      Accept: 'application/json'
    };
    if (csrfToken && isUnsafe) headers['x-csrf-token'] = csrfToken;
    if (csrfCookie) headers['Cookie'] = csrfCookie;

    let bodyStr: string | undefined;
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(init.body);
    }

    let res = await fetchImpl(url, { method: init?.method ?? 'GET', headers, body: bodyStr });

    if (res.status === 403 && isUnsafe && res.headers.get('x-csrf-token') === 'Required') {
      const { token, cookie } = await fetchCsrf();
      if (!token) {
        throw new SapError({ code: 'CSRF_FETCH_FAILED', message: 'SAP required CSRF token but did not return one', severity: 'error', httpStatus: 403 });
      }
      csrfToken = token;
      if (cookie) csrfCookie = cookie;
      headers['x-csrf-token'] = csrfToken;
      if (csrfCookie) headers['Cookie'] = csrfCookie;
      res = await fetchImpl(url, { method: init?.method ?? 'GET', headers, body: bodyStr });
    }

    const body = await safeJson(res);
    return { status: res.status, body };
  }

  return {
    async testConnection() {
      try {
        const { status, body } = await callJson('/');
        if (status !== 200) return { ok: false as const, error: parseODataError(status, body) };
        const list = (body as { value?: Array<{ name: string }> }).value ?? [];
        if (!list.some((e) => e.name === 'Request')) {
          return { ok: false as const, error: new SapError({ code: 'BAD_SERVICE', message: 'Service root missing Request entity set', severity: 'error', httpStatus: 200 }) };
        }
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, error: new SapError({ code: 'NETWORK', message: (e as Error).message, severity: 'error' }) };
      }
    },

    async createTransport(input) {
      if (input.description.length > 60) {
        throw new RangeError(`description exceeds 60 chars (${input.description.length}); truncate before calling sap-client`);
      }
      const payload: Record<string, string> = {
        Description: input.description,
        Type: input.type,
        Email: input.email
      };
      if (input.target) payload.Target = input.target;
      const { status, body } = await callJson('/Request/SAP__self.Create', { method: 'POST', body: payload });
      if (status >= 400) throw parseODataError(status, body);
      return body as RequestType;
    },

    async releaseTransport(requestId) {
      const { status, body } = await callJson(`/Request('${encodeURIComponent(requestId)}')/SAP__self.Release`, { method: 'POST', body: {} });
      if (status >= 400) throw parseODataError(status, body);
      return body as RequestType;
    },

    async getTransport(requestId) {
      const path = `/Request('${encodeURIComponent(requestId)}')?$select=Request,Description,Owner,Type,TypeText,Target,Status,StatusText`;
      const { status, body } = await callJson(path);
      if (status >= 400) throw parseODataError(status, body);
      return body as RequestType;
    }
  };
}
