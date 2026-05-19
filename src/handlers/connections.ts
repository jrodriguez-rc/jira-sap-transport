// src/handlers/connections.ts
import { listConnections, saveConnection, getConnection, deleteConnection, toPublic } from '../lib/storage';
import { createSapClient } from '../lib/sap-client';
import type { Connection } from '../lib/types';

interface ResolverArgs<P = unknown> { payload: P; context: unknown }

function validateConnection(c: Partial<Connection>): asserts c is Omit<Connection, 'id'> {
  if (!c.hostname || !/^https:\/\/.+/.test(c.hostname)) {
    throw new Error('hostname must be an https URL');
  }
  if (!c.client || !/^\d{3}$/.test(c.client)) {
    throw new Error('client must be exactly 3 digits');
  }
  if (!c.username || !c.password || !c.label) {
    throw new Error('label, username and password are required');
  }
}

export async function listConnectionsResolver(_args: ResolverArgs) {
  const all = await listConnections();
  return all.map(toPublic);
}

export async function saveConnectionResolver(args: ResolverArgs<Partial<Connection>>) {
  const providedId = args.payload.id;
  // When editing an existing connection without supplying a new password,
  // reuse the stored one so admins can rename / tweak fields without
  // re-typing the secret. If the id is unknown we fall through and the
  // standard "password required" validation kicks in below.
  if (providedId && (!args.payload.password || args.payload.password.length === 0)) {
    const existing = await getConnection(providedId);
    if (existing) {
      args.payload = { ...args.payload, password: existing.password };
    }
  }
  validateConnection(args.payload);
  const id = providedId ?? `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const conn: Connection = {
    id,
    label: args.payload.label,
    hostname: args.payload.hostname,
    client: args.payload.client,
    username: args.payload.username,
    password: args.payload.password
  };
  await saveConnection(conn);
  return { id };
}

export async function deleteConnectionResolver(args: ResolverArgs<{ id: string }>) {
  await deleteConnection(args.payload.id);
  return { ok: true };
}

export async function testConnectionResolver(args: ResolverArgs<{ id?: string; hostname?: string; client?: string; username?: string; password?: string }>) {
  let conn: { hostname: string; client: string; username: string; password: string };
  if (args.payload.id) {
    const stored = await getConnection(args.payload.id);
    if (!stored) {
      return { ok: false as const, error: { code: 'NOT_FOUND', message: 'Connection not found', severity: 'error' as const } };
    }
    conn = { hostname: stored.hostname, client: stored.client, username: stored.username, password: stored.password };
  } else {
    if (!args.payload.hostname || !/^https:\/\/.+/.test(args.payload.hostname)) {
      return { ok: false as const, error: { code: 'INVALID_HOSTNAME', message: 'hostname must be an https URL', severity: 'error' as const } };
    }
    if (!args.payload.client || !args.payload.username || !args.payload.password) {
      return { ok: false as const, error: { code: 'INVALID_PAYLOAD', message: 'hostname, client, username and password are required for ad-hoc test', severity: 'error' as const } };
    }
    conn = { hostname: args.payload.hostname, client: args.payload.client, username: args.payload.username, password: args.payload.password };
  }
  const client = createSapClient(conn);
  return client.testConnection();
}
