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

const resolver = new Resolver();

resolver.define('connections.list', listConnectionsResolver);
resolver.define('connections.save', saveConnectionResolver);
resolver.define('connections.delete', deleteConnectionResolver);
resolver.define('connections.test', testConnectionResolver);

resolver.define('project.getConfig', getProjectConfigResolver);
resolver.define('project.saveConfig', saveProjectConfigResolver);
resolver.define('project.previewTemplate', previewTemplateResolver);

resolver.define('issue.create', createTransportResolver);
resolver.define('issue.link', linkTransportResolver);
resolver.define('issue.release', releaseTransportResolver);
resolver.define('issue.refresh', refreshTransportResolver);
resolver.define('issue.list', listTransportsResolver);

resolver.define('automation.create', automationCreate);
resolver.define('automation.link', automationLink);
resolver.define('automation.release', automationRelease);

export const handler = resolver.getDefinitions();

// Plain Forge function handlers for jiraAutomationAction modules.
// These receive the automation rule's configured payload directly as `payload`,
// not wrapped in a @forge/bridge dispatcher envelope, so they cannot share
// `handler` (which is a @forge/resolver dispatcher).

export const automationCreateHandler = (payload: Parameters<typeof automationCreate>[0]['payload'], context: { accountId?: string }) =>
  automationCreate({ payload, context });

export const automationReleaseHandler = (payload: Parameters<typeof automationRelease>[0]['payload'], context: { accountId?: string }) =>
  automationRelease({ payload, context });

export const automationLinkHandler = (payload: Parameters<typeof automationLink>[0]['payload'], context: { accountId?: string }) =>
  automationLink({ payload, context });
