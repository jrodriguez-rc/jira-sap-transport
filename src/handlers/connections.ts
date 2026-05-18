// src/handlers/connections.ts
import { listConnections, saveConnection, deleteConnection, toPublic } from '../lib/storage';
import { createSapClient } from '../lib/sap-client';
import { isValidSlotKey } from '../lib/types';
import type { Connection } from '../lib/types';

interface ResolverArgs<P = unknown> { payload: P; context: unknown }

function validateConnection(c: Partial<Connection>): asserts c is Omit<Connection, 'id'> {
  if (!c.slotKey || !isValidSlotKey(c.slotKey)) {
    throw new Error('slotKey must be one of sap-backend-1 ... sap-backend-25');
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
  validateConnection(args.payload);
  const id = providedId ?? `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const conn: Connection = {
    id,
    label: args.payload.label,
    slotKey: args.payload.slotKey,
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

export async function testConnectionResolver(args: ResolverArgs<{ slotKey: string; client: string; username: string; password: string }>) {
  if (!isValidSlotKey(args.payload.slotKey)) {
    return { ok: false as const, error: { code: 'INVALID_SLOT', message: 'slotKey must be one of sap-backend-1 ... sap-backend-25', severity: 'error' as const } };
  }
  const client = createSapClient(args.payload);
  return client.testConnection();
}
