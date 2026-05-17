// src/handlers/issue-actions.ts
import api, { route } from '@forge/api';
import { getProjectConfig, getConnection, getIssueTransports, setIssueTransports } from '../lib/storage';
import { createSapClient } from '../lib/sap-client';
import { render } from '../lib/template';
import { ConfigError } from '../lib/errors';
import type { Connection, ProjectConfig, RequestType, SapTransportEntry, TransportType } from '../lib/types';

interface ResolverArgs<P = unknown> { payload: P; context: { accountId?: string } }

async function resolveConnection(projectId: string): Promise<{ conn: Connection; cfg: ProjectConfig }> {
  const cfg = await getProjectConfig(projectId);
  if (!cfg) throw new ConfigError('Project not configured: no SAP connection selected');
  if (cfg.connectionOverride) return { conn: cfg.connectionOverride, cfg };
  if (cfg.connectionId) {
    const c = await getConnection(cfg.connectionId);
    if (!c) throw new ConfigError('Referenced SAP connection does not exist');
    return { conn: c, cfg };
  }
  throw new ConfigError('No SAP connection configured for project');
}

async function fetchUserEmail(accountId: string): Promise<string> {
  const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
  if (res.status !== 200) throw new Error(`Cannot resolve user email (status ${res.status})`);
  const u = (await res.json()) as { emailAddress?: string };
  if (!u.emailAddress) throw new Error('User has no email visible to the app');
  return u.emailAddress;
}

async function fetchIssue(issueKey: string): Promise<unknown> {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`);
  if (res.status !== 200) throw new Error(`Cannot read issue ${issueKey} (status ${res.status})`);
  return res.json();
}

function toEntry(rt: RequestType): SapTransportEntry {
  return {
    requestId: rt.Request,
    type: rt.Type,
    target: rt.Target,
    description: rt.Description,
    createdAt: new Date().toISOString(),
    status: rt.Status,
    statusText: rt.StatusText
  };
}

export async function createTransportResolver(args: ResolverArgs<{
  projectId: string; issueKey: string; type: TransportType; descriptionOverride?: string; target?: string;
}>) {
  const { conn, cfg } = await resolveConnection(args.payload.projectId);
  const accountId = args.context.accountId;
  if (!accountId) throw new Error('Missing accountId');
  const email = await fetchUserEmail(accountId);
  const issue = await fetchIssue(args.payload.issueKey);

  const renderCtx = { issue, project: { code: cfg.projectCode }, user: { email }, date: { iso: new Date().toISOString().slice(0, 10) } };
  const rendered = args.payload.descriptionOverride && args.payload.descriptionOverride.trim().length > 0
    ? render(args.payload.descriptionOverride, renderCtx)
    : render(cfg.descriptionTemplate, renderCtx);

  const client = createSapClient(conn);
  const rt = await client.createTransport({
    description: rendered.text,
    type: args.payload.type,
    email,
    target: args.payload.target ?? cfg.defaults.target
  });

  const entry = toEntry(rt);
  const list = await getIssueTransports(args.payload.issueKey);
  await setIssueTransports(args.payload.issueKey, [...list, entry]);
  return entry;
}

export async function linkTransportResolver(args: ResolverArgs<{ projectId: string; issueKey: string; requestId: string }>) {
  const { conn } = await resolveConnection(args.payload.projectId);
  const client = createSapClient(conn);
  const rt = await client.getTransport(args.payload.requestId);
  const entry = toEntry(rt);
  const list = await getIssueTransports(args.payload.issueKey);
  if (!list.some((e) => e.requestId === entry.requestId)) {
    await setIssueTransports(args.payload.issueKey, [...list, entry]);
  }
  return entry;
}

export async function releaseTransportResolver(args: ResolverArgs<{ projectId: string; issueKey: string; requestId: string }>) {
  const { conn } = await resolveConnection(args.payload.projectId);
  const client = createSapClient(conn);
  const rt = await client.releaseTransport(args.payload.requestId);
  const list = await getIssueTransports(args.payload.issueKey);
  const next = list.map((e) =>
    e.requestId === rt.Request
      ? { ...e, status: rt.Status, statusText: rt.StatusText, releasedAt: new Date().toISOString() }
      : e
  );
  await setIssueTransports(args.payload.issueKey, next);
  return { requestId: rt.Request, status: rt.Status, statusText: rt.StatusText };
}

export async function refreshTransportResolver(args: ResolverArgs<{ projectId: string; issueKey: string; requestId: string }>) {
  const { conn } = await resolveConnection(args.payload.projectId);
  const client = createSapClient(conn);
  const rt = await client.getTransport(args.payload.requestId);
  const list = await getIssueTransports(args.payload.issueKey);
  const next = list.map((e) =>
    e.requestId === rt.Request ? { ...e, status: rt.Status, statusText: rt.StatusText } : e
  );
  await setIssueTransports(args.payload.issueKey, next);
  return { requestId: rt.Request, status: rt.Status, statusText: rt.StatusText };
}

export async function listTransportsResolver(args: ResolverArgs<{ issueKey: string }>): Promise<SapTransportEntry[]> {
  return getIssueTransports(args.payload.issueKey);
}
