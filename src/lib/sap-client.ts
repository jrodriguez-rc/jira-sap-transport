import type { SapClientCallContext } from './types';

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
