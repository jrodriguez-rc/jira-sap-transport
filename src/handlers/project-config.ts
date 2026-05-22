// src/handlers/project-config.ts
import { saveProjectConfig, getProjectConfig } from '../lib/storage';
import { render } from '../lib/template';
import { ConfigError } from '../lib/errors';
import type { Connection, ProjectConfig, RenderResult, TransportConfig, TransportType } from '../lib/types';

interface ResolverArgs<P = unknown> { payload: P; context: unknown }

const VALID_TYPES: ReadonlyArray<TransportType> = ['K', 'W', 'T'];
const LABEL_MAX = 50;

// Coerce any stored document (possibly legacy shape) into the new shape.
// Legacy fields (top-level projectCode, defaults) are silently dropped.
function normalizeProjectConfig(doc: unknown): ProjectConfig | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const d = doc as Record<string, unknown>;
  return {
    connectionId: typeof d.connectionId === 'string' ? d.connectionId : undefined,
    connectionOverride:
      d.connectionOverride && typeof d.connectionOverride === 'object'
        ? (d.connectionOverride as Connection)
        : undefined,
    descriptionTemplate: typeof d.descriptionTemplate === 'string' ? d.descriptionTemplate : '',
    configs: Array.isArray(d.configs) ? (d.configs as TransportConfig[]) : [],
  };
}

async function loadOrEmpty(projectId: string): Promise<ProjectConfig> {
  const raw = await getProjectConfig(projectId);
  const normalised = normalizeProjectConfig(raw);
  return (
    normalised ?? {
      connectionId: undefined,
      connectionOverride: undefined,
      descriptionTemplate: '',
      configs: [],
    }
  );
}

function newConfigId(): string {
  return `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateConfigFields(
  fields: { label?: string; type?: TransportType; target?: string; projectCode?: string },
): asserts fields is { label: string; type: TransportType; target: string; projectCode: string } {
  if (!fields.label || fields.label.trim().length === 0) {
    throw new ConfigError('label is required');
  }
  if (fields.label.length > LABEL_MAX) {
    throw new ConfigError(`label must be ${LABEL_MAX} chars or less`);
  }
  if (!fields.type || !VALID_TYPES.includes(fields.type)) {
    throw new ConfigError('type must be one of K/W/T');
  }
  if (!fields.target || fields.target.trim().length === 0) {
    throw new ConfigError('target is required');
  }
  if (!fields.projectCode || fields.projectCode.trim().length === 0) {
    throw new ConfigError('projectCode is required');
  }
}

function assertLabelUnique(configs: TransportConfig[], label: string, excludeId?: string): void {
  const clash = configs.find((c) => c.id !== excludeId && c.label === label);
  if (clash) {
    throw new ConfigError(`A configuration already exists in this project with label "${label}"`);
  }
}

export async function getProjectConfigResolver(
  args: ResolverArgs<{ projectId: string }>,
): Promise<ProjectConfig | undefined> {
  const raw = await getProjectConfig(args.payload.projectId);
  return normalizeProjectConfig(raw);
}

export async function saveSettingsResolver(
  args: ResolverArgs<{
    projectId: string;
    settings: {
      connectionId?: string;
      connectionOverride?: Connection;
      descriptionTemplate: string;
    };
  }>,
): Promise<{ ok: true }> {
  const existing = await loadOrEmpty(args.payload.projectId);
  const next: ProjectConfig = {
    connectionId: args.payload.settings.connectionId,
    connectionOverride: args.payload.settings.connectionOverride,
    descriptionTemplate: args.payload.settings.descriptionTemplate,
    configs: existing.configs,
  };
  await saveProjectConfig(args.payload.projectId, next);
  return { ok: true };
}

export async function addConfigResolver(
  args: ResolverArgs<{
    projectId: string;
    config: { label: string; type: TransportType; target: string; projectCode: string };
  }>,
): Promise<{ id: string }> {
  validateConfigFields(args.payload.config);
  const existing = await loadOrEmpty(args.payload.projectId);
  assertLabelUnique(existing.configs, args.payload.config.label);
  const entry: TransportConfig = {
    id: newConfigId(),
    label: args.payload.config.label,
    type: args.payload.config.type,
    target: args.payload.config.target,
    projectCode: args.payload.config.projectCode,
  };
  const next: ProjectConfig = { ...existing, configs: [...existing.configs, entry] };
  await saveProjectConfig(args.payload.projectId, next);
  return { id: entry.id };
}

export async function updateConfigResolver(
  args: ResolverArgs<{
    projectId: string;
    configId: string;
    patch: Partial<{ label: string; type: TransportType; target: string; projectCode: string }>;
  }>,
): Promise<{ ok: true }> {
  const existing = await loadOrEmpty(args.payload.projectId);
  const idx = existing.configs.findIndex((c) => c.id === args.payload.configId);
  if (idx === -1) {
    throw new ConfigError(`Config not found: ${args.payload.configId}`);
  }
  const merged: TransportConfig = { ...existing.configs[idx], ...args.payload.patch };
  validateConfigFields(merged);
  assertLabelUnique(existing.configs, merged.label, merged.id);
  const nextConfigs = [...existing.configs];
  nextConfigs[idx] = merged;
  await saveProjectConfig(args.payload.projectId, { ...existing, configs: nextConfigs });
  return { ok: true };
}

export async function deleteConfigResolver(
  args: ResolverArgs<{ projectId: string; configId: string }>,
): Promise<{ ok: true }> {
  const raw = await getProjectConfig(args.payload.projectId);
  if (!raw) return { ok: true };
  const existing = normalizeProjectConfig(raw);
  if (!existing) return { ok: true };
  const nextConfigs = existing.configs.filter((c) => c.id !== args.payload.configId);
  await saveProjectConfig(args.payload.projectId, { ...existing, configs: nextConfigs });
  return { ok: true };
}

export function previewTemplateResolver(
  args: ResolverArgs<{ template: string; sampleContext: unknown }>,
): RenderResult {
  return render(args.payload.template, args.payload.sampleContext);
}
