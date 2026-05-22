// src/handlers/automation.ts
import { createTransportFromConfig, linkTransportResolver, releaseTransportResolver } from './issue-actions';
import { getIssueTransports, getProjectConfig } from '../lib/storage';
import type { TransportType, SapTransportEntry } from '../lib/types';
import { ConfigError, SapError } from '../lib/errors';
import { logEvent } from '../lib/logger';

interface AutomationArgs<P> { payload: P; context: { accountId?: string } }

export interface AutomationCreateOutput {
  requestId: string;
  status: string;
  statusText: string;
  error: string;
}

function flatOut(entry: { requestId: string; status: string; statusText: string }, error = ''): AutomationCreateOutput {
  return { requestId: entry.requestId, status: entry.status, statusText: entry.statusText, error };
}

export async function automationCreate(args: AutomationArgs<{
  projectId: string; issueKey: string; configLabel: string; email: string;
}>): Promise<AutomationCreateOutput> {
  const started = Date.now();
  try {
    const project = await getProjectConfig(args.payload.projectId);
    if (!project) {
      throw new ConfigError(`Project ${args.payload.projectId} is not configured`);
    }
    const config = (project.configs ?? []).find((c) => c.label === args.payload.configLabel);
    if (!config) {
      const available = (project.configs ?? []).map((c) => `"${c.label}"`).join(', ') || '<none>';
      throw new ConfigError(
        `No transport configuration with label "${args.payload.configLabel}" in this project. Available: ${available}`,
      );
    }
    const entry = await createTransportFromConfig({
      projectId: args.payload.projectId,
      issueKey: args.payload.issueKey,
      project,
      config,
      emailOverride: args.payload.email,
    });
    logEvent('info', { action: 'automation.create', projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: entry.requestId, durationMs: Date.now() - started, outcome: 'ok' });
    return flatOut({ requestId: entry.requestId, status: entry.status, statusText: entry.statusText });
  } catch (e) {
    logEvent('error', { action: 'automation.create', projectId: args.payload.projectId, issueKey: args.payload.issueKey, durationMs: Date.now() - started, outcome: 'fail', errorCode: (e as { code?: string }).code, message: (e as Error).message });
    return flatOut({ requestId: '', status: '', statusText: '' }, errMsg(e));
  }
}

export async function automationLink(args: AutomationArgs<{ projectId: string; issueKey: string; requestId: string }>): Promise<AutomationCreateOutput> {
  const started = Date.now();
  try {
    const entry = await linkTransportResolver({
      payload: args.payload,
      context: { accountId: args.context.accountId ?? 'automation' }
    });
    logEvent('info', { action: 'automation.link', projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: entry.requestId, durationMs: Date.now() - started, outcome: 'ok' });
    return flatOut({ requestId: entry.requestId, status: entry.status, statusText: entry.statusText });
  } catch (e) {
    logEvent('error', { action: 'automation.link', projectId: args.payload.projectId, issueKey: args.payload.issueKey, durationMs: Date.now() - started, outcome: 'fail', errorCode: (e as { code?: string }).code, message: (e as Error).message });
    return flatOut({ requestId: '', status: '', statusText: '' }, errMsg(e));
  }
}

export async function automationRelease(args: AutomationArgs<{
  projectId: string; issueKey: string;
  mode: 'all-linked' | 'by-id' | 'latest';
  requestId?: string;
  onlyType?: TransportType | 'any';
}>): Promise<{ released: string[]; skipped: string[]; failed: Array<{ requestId: string; error: string }> }> {
  const started = Date.now();
  const all = await getIssueTransports(args.payload.issueKey);
  let candidates: SapTransportEntry[];
  switch (args.payload.mode) {
    case 'by-id':
      if (!args.payload.requestId) throw new Error('requestId required for mode=by-id');
      candidates = all.filter((e) => e.requestId === args.payload.requestId);
      break;
    case 'latest':
      candidates = all.length === 0 ? [] : [all[all.length - 1]];
      break;
    case 'all-linked':
    default: {
      const t = args.payload.onlyType;
      candidates = all.filter((e) =>
        e.status !== 'R' && (!t || t === 'any' || e.type === t)
      );
    }
  }

  const released: string[] = [];
  const skipped: string[] = all.filter((e) => !candidates.includes(e)).map((e) => e.requestId);
  const failed: Array<{ requestId: string; error: string }> = [];

  for (const c of candidates) {
    try {
      await releaseTransportResolver({
        payload: { projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: c.requestId },
        context: { accountId: args.context.accountId ?? 'automation' }
      });
      released.push(c.requestId);
    } catch (e) {
      failed.push({ requestId: c.requestId, error: errMsg(e) });
    }
  }

  logEvent('info', { action: 'automation.release', projectId: args.payload.projectId, issueKey: args.payload.issueKey, released, skipped, failed, durationMs: Date.now() - started, outcome: failed.length === 0 ? 'ok' : 'partial' });
  return { released, skipped, failed };
}

function errMsg(e: unknown): string {
  if (e instanceof SapError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
