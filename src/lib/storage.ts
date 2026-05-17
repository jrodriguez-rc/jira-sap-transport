// src/lib/storage.ts
import { storage } from '@forge/api';
import type { Connection, ConnectionPublic } from './types';

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
