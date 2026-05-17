// src/handlers/project-config.ts
import { saveProjectConfig, getProjectConfig } from '../lib/storage';
import { render } from '../lib/template';
import type { ProjectConfig, RenderResult, TransportType } from '../lib/types';

interface ResolverArgs<P = unknown> { payload: P; context: unknown }

const VALID_TYPES: TransportType[] = ['K', 'W', 'T'];

export async function getProjectConfigResolver(args: ResolverArgs<{ projectId: string }>): Promise<ProjectConfig | undefined> {
  return getProjectConfig(args.payload.projectId);
}

export async function saveProjectConfigResolver(args: ResolverArgs<{ projectId: string; config: ProjectConfig }>): Promise<{ ok: true }> {
  const cfg = args.payload.config;
  if (!VALID_TYPES.includes(cfg.defaults.type)) {
    throw new Error('defaults.type must be one of K/W/T');
  }
  await saveProjectConfig(args.payload.projectId, cfg);
  return { ok: true };
}

export function previewTemplateResolver(args: ResolverArgs<{ template: string; sampleContext: unknown }>): RenderResult {
  return render(args.payload.template, args.payload.sampleContext);
}
