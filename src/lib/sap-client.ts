import { SapError, type SapErrorSeverity } from './errors';
import type { SapClientCallContext, SapMessage } from './types';

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
