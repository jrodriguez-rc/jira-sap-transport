import Resolver from '@forge/resolver';
import {
  listConnectionsResolver, saveConnectionResolver, deleteConnectionResolver, testConnectionResolver
} from './handlers/connections';
import {
  getProjectConfigResolver, saveProjectConfigResolver, previewTemplateResolver
} from './handlers/project-config';
import {
  createTransportResolver, linkTransportResolver, releaseTransportResolver,
  refreshTransportResolver, listTransportsResolver
} from './handlers/issue-actions';
import { automationCreate, automationLink, automationRelease } from './handlers/automation';
import type { SapErrorJSON } from './lib/errors';

export type ResolverResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: SapErrorJSON };

// Wrap a resolver so thrown errors become a structured Result that survives
// the @forge/bridge boundary. The frontend dispatches on `result.ok`.
// Accepts either sync or async resolvers and any context shape — each handler
// module declares its own ResolverArgs/AutomationArgs context type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bridgeSafe<A extends { payload: any; context: any }, T>(fn: (args: A) => T | Promise<T>) {
  return async (args: A): Promise<ResolverResult<Awaited<T>>> => {
    try {
      const data = await fn(args);
      return { ok: true, data };
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'UNKNOWN';
      const message = (e as Error).message ?? 'Unknown error';
      const severity = (e as { severity?: 'info' | 'warning' | 'error' }).severity ?? 'error';
      const httpStatus = (e as { httpStatus?: number }).httpStatus;
      const target = (e as { target?: string }).target;
      return { ok: false, error: { code, message, severity, target, httpStatus } };
    }
  };
}

const resolver = new Resolver();

// Wrap every resolver that can throw into bridgeSafe.
resolver.define('connections.list', bridgeSafe(listConnectionsResolver));
resolver.define('connections.save', bridgeSafe(saveConnectionResolver));
resolver.define('connections.delete', bridgeSafe(deleteConnectionResolver));
// connections.test already returns its own Result-like shape and never throws,
// so it is intentionally NOT wrapped — keeps the admin-page consumer simple.
resolver.define('connections.test', testConnectionResolver);

resolver.define('project.getConfig', bridgeSafe(getProjectConfigResolver));
resolver.define('project.saveConfig', bridgeSafe(saveProjectConfigResolver));
resolver.define('project.previewTemplate', bridgeSafe(previewTemplateResolver));

resolver.define('issue.create', bridgeSafe(createTransportResolver));
resolver.define('issue.link', bridgeSafe(linkTransportResolver));
resolver.define('issue.release', bridgeSafe(releaseTransportResolver));
resolver.define('issue.refresh', bridgeSafe(refreshTransportResolver));
resolver.define('issue.list', bridgeSafe(listTransportsResolver));

resolver.define('automation.create', bridgeSafe(automationCreate));
resolver.define('automation.link', bridgeSafe(automationLink));
resolver.define('automation.release', bridgeSafe(automationRelease));

export const handler = resolver.getDefinitions();

// Plain Forge function handlers for jiraAutomationAction modules.
// These receive the automation rule's configured payload directly as `payload`,
// not wrapped in a @forge/bridge dispatcher envelope, so they cannot share
// `handler` (which is a @forge/resolver dispatcher). They also bypass
// bridgeSafe because the automation runtime expects raw results, not Result envelopes.

export const automationCreateHandler = (payload: Parameters<typeof automationCreate>[0]['payload'], context: { accountId?: string }) =>
  automationCreate({ payload, context });

export const automationReleaseHandler = (payload: Parameters<typeof automationRelease>[0]['payload'], context: { accountId?: string }) =>
  automationRelease({ payload, context });

export const automationLinkHandler = (payload: Parameters<typeof automationLink>[0]['payload'], context: { accountId?: string }) =>
  automationLink({ payload, context });
