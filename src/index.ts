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
