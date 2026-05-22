// src/handlers/issue-actions.ts
import api, { route } from '@forge/api';
import { getProjectConfig, getConnection, getIssueTransports, setIssueTransports } from '../lib/storage';
import { createSapClient } from '../lib/sap-client';
import { render } from '../lib/template';
import { ConfigError } from '../lib/errors';
import { logEvent } from '../lib/logger';
import type {
  Connection, ProjectConfig, RequestType, SapTransportEntry, TransportConfig,
} from '../lib/types';

interface ResolverArgs<P = unknown> { payload: P; context: { accountId?: string } }

/**
 * Resolve the Connection for an already-loaded ProjectConfig. Callers that
 * also need the project itself already have it (they loaded it to find the
 * matching TransportConfig), so we don't re-read it from KVS here — that
 * avoided a 2× read on the issue.create / automation.create hot path.
 */
async function resolveConnection(project: ProjectConfig): Promise<Connection> {
  if (project.connectionOverride) return project.connectionOverride;
  if (project.connectionId) {
    const c = await getConnection(project.connectionId);
    if (!c) throw new ConfigError('Referenced SAP connection does not exist');
    return c;
  }
  throw new ConfigError('No SAP connection configured for project');
}

async function fetchUserEmail(): Promise<string> {
  // /rest/api/3/myself returns the calling user's own profile, and Atlassian
  // always returns `emailAddress` to the user themselves (privacy filters only
  // hide emails between users). Using `asUser()` so the call is scoped to the
  // human who triggered the action, not the app actor.
  const res = await api.asUser().requestJira(route`/rest/api/3/myself`);
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

function toEntry(rt: RequestType, conn: Connection): SapTransportEntry {
  return {
    requestId: rt.Request,
    type: rt.Type,
    target: rt.Target,
    description: rt.Description,
    createdAt: new Date().toISOString(),
    status: rt.Status,
    statusText: rt.StatusText,
    systemId: conn.systemId,
  };
}

/**
 * Shared implementation used by both the panel resolver (`createTransportResolver`)
 * and the automation handler (`automationCreate`). Both first locate the config
 * (by id or by label respectively) and then call this function.
 */
export async function createTransportFromConfig(args: {
  projectId: string;
  issueKey: string;
  project: ProjectConfig;
  config: TransportConfig;
  descriptionOverride?: string;
  emailOverride?: string;
}): Promise<SapTransportEntry> {
  const { project } = args;
  const conn = await resolveConnection(project);
  const email = args.emailOverride ?? (await fetchUserEmail());
  const issue = await fetchIssue(args.issueKey);

  const renderCtx = {
    issue,
    project: { code: args.config.projectCode },
    user: { email },
    date: { iso: new Date().toISOString().slice(0, 10) },
  };
  // Cascade: per-call override > project template > connection template > engine default.
  // render() treats empty strings as "use DEFAULT_TEMPLATE", so passing '' is the right
  // way to delegate to the engine when nothing else is configured.
  const templateOverride = args.descriptionOverride?.trim();
  const projectTemplate = project.descriptionTemplate?.trim();
  const connectionTemplate = conn.descriptionTemplate?.trim();
  const effective = templateOverride || projectTemplate || connectionTemplate || '';
  const rendered = render(effective, renderCtx);

  const client = createSapClient(conn);
  const rt = await client.createTransport({
    description: rendered.text,
    type: args.config.type,
    email,
    target: args.config.target,
  });

  const entry = toEntry(rt, conn);
  const list = await getIssueTransports(args.issueKey);
  await setIssueTransports(args.issueKey, [...list, entry]);
  return entry;
}

export async function createTransportResolver(args: ResolverArgs<{
  projectId: string;
  issueKey: string;
  configId: string;
  descriptionOverride?: string;
  emailOverride?: string;
}>) {
  const started = Date.now();
  try {
    const project = await getProjectConfig(args.payload.projectId);
    if (!project) throw new ConfigError('Project not configured');
    const config = project.configs?.find((c) => c.id === args.payload.configId);
    if (!config) throw new ConfigError(`Transport configuration not found: ${args.payload.configId}`);
    const entry = await createTransportFromConfig({
      projectId: args.payload.projectId,
      issueKey: args.payload.issueKey,
      project,
      config,
      descriptionOverride: args.payload.descriptionOverride,
      emailOverride: args.payload.emailOverride,
    });
    logEvent('info', {
      action: 'issue.create',
      projectId: args.payload.projectId,
      issueKey: args.payload.issueKey,
      requestId: entry.requestId,
      durationMs: Date.now() - started,
      outcome: 'ok',
    });
    return entry;
  } catch (e) {
    logEvent('error', {
      action: 'issue.create',
      projectId: args.payload.projectId,
      issueKey: args.payload.issueKey,
      durationMs: Date.now() - started,
      outcome: 'fail',
      errorCode: (e as { code?: string }).code,
      message: (e as Error).message,
    });
    throw e;
  }
}

export async function linkTransportResolver(args: ResolverArgs<{ projectId: string; issueKey: string; requestId: string }>) {
  const started = Date.now();
  try {
    const project = await getProjectConfig(args.payload.projectId);
    if (!project) throw new ConfigError('Project not configured: no SAP connection selected');
    const conn = await resolveConnection(project);
    const client = createSapClient(conn);
    const rt = await client.getTransport(args.payload.requestId);
    const entry = toEntry(rt, conn);
    const list = await getIssueTransports(args.payload.issueKey);
    // If the entry already exists, refresh its fields from the current
    // Connection (notably backfilling systemId for entries created before
    // SID was added to the model).
    const existingIndex = list.findIndex((e) => e.requestId === entry.requestId);
    if (existingIndex === -1) {
      await setIssueTransports(args.payload.issueKey, [...list, entry]);
    } else {
      const next = [...list];
      next[existingIndex] = { ...list[existingIndex], ...entry };
      await setIssueTransports(args.payload.issueKey, next);
    }
    logEvent('info', { action: 'issue.link', projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: entry.requestId, durationMs: Date.now() - started, outcome: 'ok' });
    return entry;
  } catch (e) {
    logEvent('error', { action: 'issue.link', projectId: args.payload.projectId, issueKey: args.payload.issueKey, durationMs: Date.now() - started, outcome: 'fail', errorCode: (e as { code?: string }).code, message: (e as Error).message });
    throw e;
  }
}

export async function releaseTransportResolver(args: ResolverArgs<{ projectId: string; issueKey: string; requestId: string }>) {
  const started = Date.now();
  try {
    const project = await getProjectConfig(args.payload.projectId);
    if (!project) throw new ConfigError('Project not configured: no SAP connection selected');
    const conn = await resolveConnection(project);
    const client = createSapClient(conn);
    const rt = await client.releaseTransport(args.payload.requestId);
    const list = await getIssueTransports(args.payload.issueKey);
    const next = list.map((e) =>
      e.requestId === rt.Request
        ? { ...e, systemId: conn.systemId, status: rt.Status, statusText: rt.StatusText, releasedAt: new Date().toISOString() }
        : e,
    );
    await setIssueTransports(args.payload.issueKey, next);
    logEvent('info', { action: 'issue.release', projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: args.payload.requestId, durationMs: Date.now() - started, outcome: 'ok' });
    return { requestId: rt.Request, status: rt.Status, statusText: rt.StatusText };
  } catch (e) {
    logEvent('error', { action: 'issue.release', projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: args.payload.requestId, durationMs: Date.now() - started, outcome: 'fail', errorCode: (e as { code?: string }).code, message: (e as Error).message });
    throw e;
  }
}

export async function refreshTransportResolver(args: ResolverArgs<{ projectId: string; issueKey: string; requestId: string }>) {
  const started = Date.now();
  try {
    const project = await getProjectConfig(args.payload.projectId);
    if (!project) throw new ConfigError('Project not configured: no SAP connection selected');
    const conn = await resolveConnection(project);
    const client = createSapClient(conn);
    const rt = await client.getTransport(args.payload.requestId);
    const list = await getIssueTransports(args.payload.issueKey);
    const next = list.map((e) =>
      e.requestId === rt.Request ? { ...e, systemId: conn.systemId, status: rt.Status, statusText: rt.StatusText } : e,
    );
    await setIssueTransports(args.payload.issueKey, next);
    logEvent('info', { action: 'issue.refresh', projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: args.payload.requestId, durationMs: Date.now() - started, outcome: 'ok' });
    return { requestId: rt.Request, status: rt.Status, statusText: rt.StatusText };
  } catch (e) {
    logEvent('error', { action: 'issue.refresh', projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: args.payload.requestId, durationMs: Date.now() - started, outcome: 'fail', errorCode: (e as { code?: string }).code, message: (e as Error).message });
    throw e;
  }
}

export async function listTransportsResolver(args: ResolverArgs<{ issueKey: string }>): Promise<SapTransportEntry[]> {
  return getIssueTransports(args.payload.issueKey);
}
