// src/lib/storage.ts
import api, { storage, route } from '@forge/api';
import type { Connection, ConnectionPublic, ProjectConfig, SapTransportEntry } from './types';

const CONN_PREFIX = 'connections:';

export async function saveConnection(c: Connection): Promise<void> {
  await storage.set(CONN_PREFIX + c.id, c);
}

export async function getConnection(id: string): Promise<Connection | undefined> {
  return (await storage.get(CONN_PREFIX + id)) as Connection | undefined;
}

export async function deleteConnection(id: string): Promise<void> {
  await storage.delete(CONN_PREFIX + id);
}

export async function listConnections(): Promise<Connection[]> {
  // Forge storage.query lists by key prefix; the mock in tests returns everything.
  const result = await storage.query().where('key', { condition: 'STARTS_WITH', value: CONN_PREFIX } as never).getMany();
  return (result.results as Array<{ key: string; value: Connection }>)
    .map((r) => r.value)
    .filter((v): v is Connection => v != null && typeof v === 'object');
}

export function toPublic(c: Connection): ConnectionPublic {
  const { password: _password, ...pub } = c;
  return pub;
}

const PROJECT_PREFIX = 'project:';

export async function saveProjectConfig(projectId: string, cfg: ProjectConfig): Promise<void> {
  await storage.set(`${PROJECT_PREFIX}${projectId}:config`, cfg);
}

export async function getProjectConfig(projectId: string): Promise<ProjectConfig | undefined> {
  return (await storage.get(`${PROJECT_PREFIX}${projectId}:config`)) as ProjectConfig | undefined;
}

const ISSUE_PROPERTY_KEY = 'sap.transports';

export async function getIssueTransports(issueKey: string): Promise<SapTransportEntry[]> {
  const res = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}/properties/${ISSUE_PROPERTY_KEY}`
  );
  if (res.status === 404) return [];
  if (res.status !== 200) throw new Error(`Issue property fetch failed: ${res.status}`);
  const body = (await res.json()) as { value: SapTransportEntry[] };
  return body.value ?? [];
}

export async function setIssueTransports(issueKey: string, entries: SapTransportEntry[]): Promise<void> {
  const res = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}/properties/${ISSUE_PROPERTY_KEY}`,
    { method: 'PUT', body: JSON.stringify(entries), headers: { 'Content-Type': 'application/json' } }
  );
  if (res.status >= 300) throw new Error(`Issue property write failed: ${res.status}`);
}
