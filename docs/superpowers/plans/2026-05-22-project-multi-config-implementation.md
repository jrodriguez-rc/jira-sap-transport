# Project Multi-Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single per-project transport configuration with a named-array model. The issue panel renders one `+ <label>` button per configuration; the Jira automation `create-sap-transport` action selects a configuration by its `configLabel`.

**Architecture:** Storage shape stays one KVS document per project (`project:<id>:config`) but the document now holds an array `configs: TransportConfig[]` alongside the existing project-level fields (connection + descriptionTemplate). Backend resolvers move from a single `project.saveConfig` to a CRUD set (`saveSettings` + `config.add/update/delete`). Both create paths (issue panel → `issue.create`, automation rule → `automation.create`) delegate to a shared `createTransportFromConfig` helper; the panel addresses configs by `id`, the rule by `label`. Hard cutover migration with a `normalizeProjectConfig` read shim drops legacy `projectCode` / `defaults` fields without crashing legacy projects.

**Tech Stack:** TypeScript, Forge (`@forge/api`, `@forge/kvs`, `@forge/react` UI Kit 2 for admin/project-settings, Custom UI + Atlaskit + Vite for the issue panel), Vitest + jsdom + testing-library, Forge CLI.

**Reference spec:** `docs/superpowers/specs/2026-05-22-project-multi-config-design.md`

---

## File map

| Path | Treatment |
|---|---|
| `src/lib/types.ts` | Modify — add `TransportConfig`, rewrite `ProjectConfig` |
| `src/handlers/project-config.ts` | Rewrite — 5 new resolvers + `normalizeProjectConfig` |
| `src/handlers/project-config.test.ts` | Rewrite |
| `src/handlers/issue-actions.ts` | Refactor — extract `createTransportFromConfig`; `createTransportResolver` takes `configId` |
| `src/handlers/issue-actions.test.ts` | Adapt |
| `src/handlers/automation.ts` | Modify — `automationCreate` takes `configLabel` |
| `src/handlers/automation.test.ts` | Adapt |
| `src/index.ts` | Modify — register new resolvers, drop `project.saveConfig` |
| `manifest.yml` | Modify — `create-sap-transport` action inputs |
| `src/frontend/project-settings.tsx` | Rewrite — 3 sections + table + modal |
| `src/frontend/project-settings.test.tsx` | Rewrite |
| `static/issue-panel/src/App.tsx` | Modify — dynamic buttons, modal simplified |
| `static/issue-panel/src/App.test.tsx` | Adapt |
| `src/lib/storage.ts` | Unchanged |
| `src/lib/storage.test.ts` | Unchanged |
| `src/handlers/connections.ts` | Unchanged |
| `src/handlers/connections.test.ts` | Unchanged |

---

## Task 0: Branch setup

**Files:** none.

- [ ] **Step 1: Create feature branch from `main`**

```bash
git checkout main
git pull origin main
git checkout -b feature/project-multi-config
```

- [ ] **Step 2: Verify clean baseline**

```bash
npm test
```

Expected: `Test Files  15 passed (15) | Tests 207 passed`.

```bash
npm run lint
```

Expected: exit 0, no output.

---

## Task 1: Backend refactor (types + resolvers + automation + manifest + index)

Cohesive atomic change. Touches all backend files because the type rewrite couples them. Intermediate steps may leave the build in an inconsistent state; the task ends with green tests, clean tsc, and clean forge lint.

**Files:**
- Modify: `src/lib/types.ts`
- Rewrite: `src/handlers/project-config.ts`
- Rewrite: `src/handlers/project-config.test.ts`
- Refactor: `src/handlers/issue-actions.ts`
- Adapt: `src/handlers/issue-actions.test.ts`
- Modify: `src/handlers/automation.ts`
- Adapt: `src/handlers/automation.test.ts`
- Modify: `src/index.ts`
- Modify: `manifest.yml`

### Step 1: Update `src/lib/types.ts`

- [ ] **Step 1: Replace the `ProjectConfig` block; add `TransportConfig`**

Replace the existing `ProjectConfig` interface in `src/lib/types.ts` with this block (leave every other type — `Connection`, `ConnectionPublic`, `TransportType`, `RequestType`, `SapMessage`, `SapTransportEntry`, `RenderResult`, `SapClientCallContext` — unchanged):

```ts
export interface TransportConfig {
  id: string;                  // internal uuid; never shown in UI, never exposed in automation API
  label: string;               // unique per project; shown as the button text in the issue panel
  type: TransportType;
  target: string;              // e.g. 'PRD', 'QAS'
  projectCode: string;
}

export interface ProjectConfig {
  connectionId?: string;
  connectionOverride?: Connection;
  descriptionTemplate: string;
  configs: TransportConfig[];
}
```

### Step 2: Rewrite `src/handlers/project-config.test.ts`

- [ ] **Step 2: Replace the entire file with the new test suite**

```ts
// src/handlers/project-config.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/storage', () => ({
  saveProjectConfig: vi.fn(),
  getProjectConfig: vi.fn(),
}));

import {
  getProjectConfigResolver,
  saveSettingsResolver,
  addConfigResolver,
  updateConfigResolver,
  deleteConfigResolver,
  previewTemplateResolver,
} from './project-config';
import { saveProjectConfig, getProjectConfig } from '../lib/storage';
import type { ProjectConfig, TransportConfig } from '../lib/types';

const ctx = { context: {} } as const;

beforeEach(() => {
  vi.mocked(saveProjectConfig).mockReset();
  vi.mocked(getProjectConfig).mockReset();
});

const sampleConfig = (overrides: Partial<TransportConfig> = {}): TransportConfig => ({
  id: 'cfg-123',
  label: 'Workbench QAS',
  type: 'K',
  target: 'QAS',
  projectCode: 'ZPROJ',
  ...overrides,
});

describe('getProjectConfigResolver', () => {
  it('returns undefined when no document exists', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(undefined);
    const r = await getProjectConfigResolver({ payload: { projectId: '10001' }, ...ctx });
    expect(r).toBeUndefined();
  });

  it('returns the document normalised to the new shape', async () => {
    const doc: ProjectConfig = {
      connectionId: 'conn-1',
      descriptionTemplate: '{{issue.key}}',
      configs: [sampleConfig()],
    };
    vi.mocked(getProjectConfig).mockResolvedValue(doc);
    const r = await getProjectConfigResolver({ payload: { projectId: '10001' }, ...ctx });
    expect(r).toEqual(doc);
  });

  it('normalises a legacy document by dropping projectCode and defaults, seeding configs=[]', async () => {
    // Legacy shape on KVS: top-level projectCode + defaults
    const legacy = {
      connectionId: 'conn-1',
      descriptionTemplate: 'legacy template',
      projectCode: 'ZOLD',
      defaults: { type: 'K' as const, target: 'PRD' },
    };
    vi.mocked(getProjectConfig).mockResolvedValue(legacy as unknown as ProjectConfig);
    const r = await getProjectConfigResolver({ payload: { projectId: '10001' }, ...ctx });
    expect(r).toEqual({
      connectionId: 'conn-1',
      connectionOverride: undefined,
      descriptionTemplate: 'legacy template',
      configs: [],
    });
    // Legacy fields gone:
    expect((r as Record<string, unknown>).projectCode).toBeUndefined();
    expect((r as Record<string, unknown>).defaults).toBeUndefined();
  });

  it('coerces a missing descriptionTemplate to empty string', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({ connectionId: 'conn-1' } as unknown as ProjectConfig);
    const r = await getProjectConfigResolver({ payload: { projectId: '10001' }, ...ctx });
    expect(r?.descriptionTemplate).toBe('');
    expect(r?.configs).toEqual([]);
  });
});

describe('saveSettingsResolver', () => {
  it('persists only the project-level fields, preserving configs[]', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'old-conn',
      descriptionTemplate: 'old',
      configs: [sampleConfig()],
    });
    await saveSettingsResolver({
      payload: {
        projectId: '10001',
        settings: { connectionId: 'new-conn', descriptionTemplate: 'new' },
      },
      ...ctx,
    });
    expect(saveProjectConfig).toHaveBeenCalledWith('10001', {
      connectionId: 'new-conn',
      connectionOverride: undefined,
      descriptionTemplate: 'new',
      configs: [sampleConfig()],
    });
  });

  it('creates a new document with configs=[] when none exists', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(undefined);
    await saveSettingsResolver({
      payload: {
        projectId: '10001',
        settings: { connectionId: 'conn-1', descriptionTemplate: 'tpl' },
      },
      ...ctx,
    });
    expect(saveProjectConfig).toHaveBeenCalledWith('10001', {
      connectionId: 'conn-1',
      connectionOverride: undefined,
      descriptionTemplate: 'tpl',
      configs: [],
    });
  });
});

describe('addConfigResolver', () => {
  it('appends a config with an auto-assigned id', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1',
      descriptionTemplate: '',
      configs: [],
    });
    const r = await addConfigResolver({
      payload: {
        projectId: '10001',
        config: { label: 'Workbench QAS', type: 'K', target: 'QAS', projectCode: 'ZPROJ' },
      },
      ...ctx,
    });
    expect(r.id).toMatch(/^cfg-/);
    const persisted = vi.mocked(saveProjectConfig).mock.calls[0][1] as ProjectConfig;
    expect(persisted.configs).toHaveLength(1);
    expect(persisted.configs[0]).toMatchObject({
      label: 'Workbench QAS',
      type: 'K',
      target: 'QAS',
      projectCode: 'ZPROJ',
    });
  });

  it('rejects an empty label', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1', descriptionTemplate: '', configs: [],
    });
    await expect(
      addConfigResolver({
        payload: { projectId: '10001', config: { label: '', type: 'K', target: 'QAS', projectCode: 'ZPROJ' } },
        ...ctx,
      }),
    ).rejects.toThrow(/label/i);
  });

  it('rejects a label that already exists in the project', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1',
      descriptionTemplate: '',
      configs: [sampleConfig({ label: 'Workbench QAS' })],
    });
    await expect(
      addConfigResolver({
        payload: { projectId: '10001', config: { label: 'Workbench QAS', type: 'W', target: 'PRD', projectCode: 'Y' } },
        ...ctx,
      }),
    ).rejects.toThrow(/already exists.*Workbench QAS/);
  });

  it('rejects a label longer than 50 chars', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1', descriptionTemplate: '', configs: [],
    });
    await expect(
      addConfigResolver({
        payload: {
          projectId: '10001',
          config: { label: 'x'.repeat(51), type: 'K', target: 'QAS', projectCode: 'Z' },
        },
        ...ctx,
      }),
    ).rejects.toThrow(/50/);
  });

  it.each(['', '  '])('rejects empty/whitespace target=%j', async (target) => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1', descriptionTemplate: '', configs: [],
    });
    await expect(
      addConfigResolver({
        payload: { projectId: '10001', config: { label: 'L', type: 'K', target, projectCode: 'Z' } },
        ...ctx,
      }),
    ).rejects.toThrow(/target/i);
  });

  it('rejects an invalid type', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1', descriptionTemplate: '', configs: [],
    });
    await expect(
      addConfigResolver({
        payload: {
          projectId: '10001',
          config: { label: 'L', type: 'X' as unknown as 'K', target: 'QAS', projectCode: 'Z' },
        },
        ...ctx,
      }),
    ).rejects.toThrow(/type/i);
  });
});

describe('updateConfigResolver', () => {
  it('applies the patch to the matching config', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1',
      descriptionTemplate: '',
      configs: [sampleConfig({ id: 'cfg-a', label: 'A', target: 'QAS' })],
    });
    await updateConfigResolver({
      payload: { projectId: '10001', configId: 'cfg-a', patch: { target: 'PRD' } },
      ...ctx,
    });
    const persisted = vi.mocked(saveProjectConfig).mock.calls[0][1] as ProjectConfig;
    expect(persisted.configs[0].target).toBe('PRD');
    expect(persisted.configs[0].label).toBe('A'); // untouched
  });

  it('throws when configId not found', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1', descriptionTemplate: '', configs: [],
    });
    await expect(
      updateConfigResolver({
        payload: { projectId: '10001', configId: 'cfg-missing', patch: { label: 'X' } },
        ...ctx,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a rename that collides with another existing label', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1',
      descriptionTemplate: '',
      configs: [
        sampleConfig({ id: 'cfg-a', label: 'A' }),
        sampleConfig({ id: 'cfg-b', label: 'B' }),
      ],
    });
    await expect(
      updateConfigResolver({
        payload: { projectId: '10001', configId: 'cfg-a', patch: { label: 'B' } },
        ...ctx,
      }),
    ).rejects.toThrow(/already exists.*B/);
  });

  it('allows renaming a config to its own existing label (no self-collision)', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1',
      descriptionTemplate: '',
      configs: [sampleConfig({ id: 'cfg-a', label: 'A' })],
    });
    await expect(
      updateConfigResolver({
        payload: { projectId: '10001', configId: 'cfg-a', patch: { label: 'A', target: 'PRD' } },
        ...ctx,
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe('deleteConfigResolver', () => {
  it('removes the matching config', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1',
      descriptionTemplate: '',
      configs: [
        sampleConfig({ id: 'cfg-a', label: 'A' }),
        sampleConfig({ id: 'cfg-b', label: 'B' }),
      ],
    });
    await deleteConfigResolver({
      payload: { projectId: '10001', configId: 'cfg-a' },
      ...ctx,
    });
    const persisted = vi.mocked(saveProjectConfig).mock.calls[0][1] as ProjectConfig;
    expect(persisted.configs.map((c) => c.id)).toEqual(['cfg-b']);
  });

  it('is idempotent — no error if configId is missing', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue({
      connectionId: 'conn-1',
      descriptionTemplate: '',
      configs: [sampleConfig({ id: 'cfg-b' })],
    });
    await expect(
      deleteConfigResolver({ payload: { projectId: '10001', configId: 'cfg-missing' }, ...ctx }),
    ).resolves.toEqual({ ok: true });
    // configs unchanged
    const persisted = vi.mocked(saveProjectConfig).mock.calls[0][1] as ProjectConfig;
    expect(persisted.configs.map((c) => c.id)).toEqual(['cfg-b']);
  });

  it('does nothing if the project document does not exist', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(undefined);
    await expect(
      deleteConfigResolver({ payload: { projectId: '10001', configId: 'cfg-a' }, ...ctx }),
    ).resolves.toEqual({ ok: true });
    expect(saveProjectConfig).not.toHaveBeenCalled();
  });
});

describe('previewTemplateResolver', () => {
  it('renders the template with the sample context (unchanged behaviour)', () => {
    const r = previewTemplateResolver({
      payload: {
        template: '{{issue.key}}',
        sampleContext: { issue: { key: 'ABC-1' } },
      },
      ...ctx,
    });
    expect(r.text).toBe('ABC-1');
  });
});
```

- [ ] **Step 3: Run the new test file — expect FAIL (resolvers don't exist yet)**

```bash
npm test -- src/handlers/project-config.test.ts
```

Expected: every test fails with import errors like `addConfigResolver is not a function` (or `Cannot find module`).

### Step 4: Rewrite `src/handlers/project-config.ts`

- [ ] **Step 4: Replace the entire file**

```ts
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
    throw new ConfigError(`A configuration with label "${label}" already exists in this project`);
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
```

- [ ] **Step 5: Run the project-config tests — expect PASS**

```bash
npm test -- src/handlers/project-config.test.ts
```

Expected: every test passes. If `tsc` errors leak in (project-config.ts compiles fine alone but the wider tsc check is not part of `vitest run`), proceed to Step 6.

### Step 6: Refactor `src/handlers/issue-actions.ts`

- [ ] **Step 6: Rewrite `issue-actions.ts` — extract `createTransportFromConfig`, update `createTransportResolver`**

Replace the file with:

```ts
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

async function resolveConnection(projectId: string): Promise<{ conn: Connection; project: ProjectConfig }> {
  const project = (await getProjectConfig(projectId)) as ProjectConfig | undefined;
  if (!project) throw new ConfigError('Project not configured: no SAP connection selected');
  if (project.connectionOverride) return { conn: project.connectionOverride, project };
  if (project.connectionId) {
    const c = await getConnection(project.connectionId);
    if (!c) throw new ConfigError('Referenced SAP connection does not exist');
    return { conn: c, project };
  }
  throw new ConfigError('No SAP connection configured for project');
}

async function fetchUserEmail(): Promise<string> {
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
  config: TransportConfig;
  descriptionOverride?: string;
  emailOverride?: string;
}): Promise<SapTransportEntry> {
  const { conn, project } = await resolveConnection(args.projectId);
  const email = args.emailOverride ?? (await fetchUserEmail());
  const issue = await fetchIssue(args.issueKey);

  const renderCtx = {
    issue,
    project: { code: args.config.projectCode },
    user: { email },
    date: { iso: new Date().toISOString().slice(0, 10) },
  };
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
    const project = (await getProjectConfig(args.payload.projectId)) as ProjectConfig | undefined;
    if (!project) throw new ConfigError('Project not configured');
    const config = project.configs?.find((c) => c.id === args.payload.configId);
    if (!config) throw new ConfigError(`Transport configuration not found: ${args.payload.configId}`);
    const entry = await createTransportFromConfig({
      projectId: args.payload.projectId,
      issueKey: args.payload.issueKey,
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
    const { conn } = await resolveConnection(args.payload.projectId);
    const client = createSapClient(conn);
    const rt = await client.getTransport(args.payload.requestId);
    const entry = toEntry(rt, conn);
    const list = await getIssueTransports(args.payload.issueKey);
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
    const { conn } = await resolveConnection(args.payload.projectId);
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
    const { conn } = await resolveConnection(args.payload.projectId);
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
```

### Step 7: Adapt `src/handlers/issue-actions.test.ts`

- [ ] **Step 7: Update the test file to drive the new `createTransportResolver` signature**

Open `src/handlers/issue-actions.test.ts`. Replace any test that calls `createTransportResolver` with the old `{ type, target }` payload by one that:

1. Stubs `getProjectConfig` to return a project with a `configs[]` entry.
2. Calls `createTransportResolver({ payload: { projectId, issueKey, configId, descriptionOverride? } })`.
3. Asserts the SAP client received `type` and `target` from the matched config.

Add two new cases:

```ts
it('createTransportResolver throws when configId does not match any config', async () => {
  // mock getProjectConfig to return a project with configs: [{ id: 'cfg-x' }]
  // call createTransportResolver({ payload: { ..., configId: 'cfg-missing' } })
  // expect rejection with /not found/i
});

it('createTransportResolver feeds project.code from the matched config (not from any project-level field)', async () => {
  // mock getProjectConfig to return:
  //   { connectionId: '...', descriptionTemplate: '{{project.code}}-{{issue.key}}', configs: [{ id: 'cfg-a', projectCode: 'ZNEW', ... }] }
  // intercept the SAP client createTransport call
  // assert the `description` argument starts with 'ZNEW-'
});
```

For every existing test that did `payload: { ..., type: 'K', target: 'PRD' }`, change to `payload: { ..., configId: 'cfg-existing' }` and seed the mocked project with that config.

The four other resolvers (`linkTransportResolver`, `releaseTransportResolver`, `refreshTransportResolver`, `listTransportsResolver`) are unchanged — their tests need no changes.

- [ ] **Step 8: Run issue-actions tests — expect PASS**

```bash
npm test -- src/handlers/issue-actions.test.ts
```

Expected: all green.

### Step 9: Update `src/handlers/automation.ts`

- [ ] **Step 9: Replace `automationCreate` with the configLabel-based implementation**

In `src/handlers/automation.ts`, replace the `automationCreate` function with:

```ts
export async function automationCreate(args: {
  payload: { projectId: string; issueKey: string; configLabel: string; email: string };
  context: { accountId?: string };
}) {
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
  return createTransportFromConfig({
    projectId: args.payload.projectId,
    issueKey: args.payload.issueKey,
    config,
    emailOverride: args.payload.email,
  });
}
```

At the top of the file, ensure the imports include `getProjectConfig` from `../lib/storage`, `createTransportFromConfig` from `./issue-actions`, and `ConfigError` from `../lib/errors`. Remove any imports that are now unused.

`automationLink` and `automationRelease` stay unchanged.

### Step 10: Adapt `src/handlers/automation.test.ts`

- [ ] **Step 10: Update the automation create test suite**

For each existing test that calls `automationCreate` with `payload: { ..., type: 'K', target: 'PRD' }`, change to `payload: { ..., configLabel: 'Workbench QAS' }` and seed `getProjectConfig` to return a project with a matching config:

```ts
vi.mocked(getProjectConfig).mockResolvedValue({
  connectionId: 'conn-1',
  descriptionTemplate: '',
  configs: [
    { id: 'cfg-a', label: 'Workbench QAS', type: 'K', target: 'QAS', projectCode: 'ZPROJ' },
  ],
});
```

Add three new cases:

```ts
it('matches configLabel exactly (case-sensitive happy path)', async () => {
  // mock project with configs: [{ label: 'Workbench QAS', ... }]
  // call automationCreate({ payload: { ..., configLabel: 'Workbench QAS' } })
  // expect resolves with an entry whose type/target came from the config
});

it('throws with the list of available labels when configLabel does not match', async () => {
  // mock project with configs: [{ label: 'A' }, { label: 'B' }]
  // call automationCreate({ ..., configLabel: 'Workbench QAS' })
  // expect rejection whose message contains '"A"' and '"B"'
});

it('label matching is case-sensitive', async () => {
  // mock project with configs: [{ label: 'Workbench QAS' }]
  // call with configLabel: 'workbench qas' (lowercase)
  // expect rejection (no match)
});
```

- [ ] **Step 11: Run automation tests — expect PASS**

```bash
npm test -- src/handlers/automation.test.ts
```

Expected: all green.

### Step 12: Update `src/index.ts`

- [ ] **Step 12: Re-register resolvers**

Replace the three `project.*` registrations and the import line with:

```ts
import {
  getProjectConfigResolver,
  saveSettingsResolver,
  addConfigResolver,
  updateConfigResolver,
  deleteConfigResolver,
  previewTemplateResolver,
} from './handlers/project-config';
```

And in the `resolver.define(...)` block, replace:

```ts
resolver.define('project.getConfig', bridgeSafe(getProjectConfigResolver));
resolver.define('project.saveConfig', bridgeSafe(saveProjectConfigResolver));
resolver.define('project.previewTemplate', bridgeSafe(previewTemplateResolver));
```

with:

```ts
resolver.define('project.getConfig', bridgeSafe(getProjectConfigResolver));
resolver.define('project.saveSettings', bridgeSafe(saveSettingsResolver));
resolver.define('project.config.add', bridgeSafe(addConfigResolver));
resolver.define('project.config.update', bridgeSafe(updateConfigResolver));
resolver.define('project.config.delete', bridgeSafe(deleteConfigResolver));
resolver.define('project.previewTemplate', bridgeSafe(previewTemplateResolver));
```

### Step 13: Update `manifest.yml`

- [ ] **Step 13: Change `create-sap-transport` inputs**

Find the `create-sap-transport` block under `action:` and replace the `inputs:` map. Specifically, remove the `type` and `target` entries; add `configLabel`. The final block should look like:

```yaml
- key: create-sap-transport
  name: Create SAP Transport
  description: Create an SAP transport request and link it to the Jira issue.
  function: automation-create
  actionVerb: CREATE
  config:
    resource: automation-create-ui
    render: native
  inputs:
    projectId:
      title: Project ID
      description: Jira project ID
      type: string
    issueKey:
      title: Issue key
      description: Jira issue key (e.g. PROJ-1)
      type: string
    configLabel:
      title: Config label
      description: Exact, case-sensitive label of the project's transport configuration to use
      type: string
    email:
      title: Owner email
      description: Email of the SAP transport owner
      type: string
  outputContext:
    entityName: SapTrans
    outputType: OBJECT
    outputDomain: sap
  outputs:
    requestId:
      description: SAP transport request id
      nullable: true
      type: string
    status:
      description: SAP status code
      nullable: true
      type: string
    statusText:
      description: SAP status text
      nullable: true
      type: string
    error:
      description: Error message if failed
      nullable: true
      type: string
```

The `release-sap-transport` and `link-sap-transport` blocks remain unchanged.

### Step 14: Verify the whole backend

- [ ] **Step 14: Run lint, tests, and forge lint**

```bash
npm run lint
```

Expected: exit 0.

```bash
npm test
```

Expected: all green (15 test files, count of tests ≥ previous 207 — likely +10 to +15 from the new project-config cases).

```bash
npx @forge/cli lint
```

Expected: "No issues found." (The `address: '*'` warning from PR #11 should remain; that's not introduced by this task.)

### Step 15: Commit Task 1

- [ ] **Step 15: Stage and commit**

```bash
git add src/lib/types.ts \
        src/handlers/project-config.ts src/handlers/project-config.test.ts \
        src/handlers/issue-actions.ts src/handlers/issue-actions.test.ts \
        src/handlers/automation.ts src/handlers/automation.test.ts \
        src/index.ts manifest.yml
```

```bash
git commit -m "$(cat <<'EOF'
refactor(backend): multi-config project model — types, resolvers, automation, manifest

Replace the single per-project transport configuration with a named-array
model. Project document now holds connection + descriptionTemplate at the
top level and a configs[] array of {id, label, type, target, projectCode}.

- src/lib/types.ts: add TransportConfig; rewrite ProjectConfig (drop
  projectCode and defaults from the top level).
- src/handlers/project-config.ts: rewrite. Resolvers are now
  getProjectConfig (normalised on read so legacy docs don't crash),
  saveSettings (project-level only), config.add/update/delete (atomic
  read-modify-write on the single key, label uniqueness enforced).
- src/handlers/issue-actions.ts: extract createTransportFromConfig as
  the shared create path; createTransportResolver now takes configId
  and looks the config up before delegating. project.code in the
  template render context comes from the matched config.
- src/handlers/automation.ts: automationCreate takes configLabel, looks
  it up exactly (case-sensitive); miss returns an error message that
  lists the available labels so the rule author can fix the typo.
- src/index.ts: register the new project.* resolvers; drop
  project.saveConfig.
- manifest.yml: create-sap-transport inputs swap type+target for
  configLabel. Other actions unchanged.
EOF
)"
```

---

## Task 2: Project-settings UI rewrite

**Files:**
- Rewrite: `src/frontend/project-settings.tsx`
- Rewrite: `src/frontend/project-settings.test.tsx`

### Step 1: Write the new test file

- [ ] **Step 1: Replace `src/frontend/project-settings.test.tsx` with the new suite**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@forge/bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  view: {
    getContext: vi.fn(async () => ({
      extension: { project: { id: '10001' } },
    })),
  },
  events: { on: vi.fn(), once: vi.fn(), emit: vi.fn() },
}));

vi.mock('@forge/react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const ReactLib = await import('react');
  const passthrough = (tag: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const C = ReactLib.forwardRef<HTMLElement, any>((props, ref) =>
      ReactLib.createElement(tag, { ref, ...props }, props.children),
    );
    C.displayName = `Mock${tag}`;
    return C;
  };
  return {
    ...actual,
    Textfield: passthrough('input'),
    TextArea: passthrough('textarea'),
    Select: passthrough('select'),
    RadioGroup: passthrough('div'),
    Popup: passthrough('div'),
    default: { render: vi.fn(), addConfig: vi.fn() },
  };
});

import { App } from './project-settings';
import type { ProjectConfig } from '../lib/types';

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message: string) => ({ ok: false as const, error: { code: 'ERR', message, severity: 'error' } });

const emptyProject: ProjectConfig = {
  connectionId: 'conn-1',
  descriptionTemplate: '{{issue.key}} {{issue.fields.summary}}',
  configs: [],
};

const projectWithConfigs: ProjectConfig = {
  connectionId: 'conn-1',
  descriptionTemplate: '{{issue.key}}',
  configs: [
    { id: 'cfg-a', label: 'Workbench QAS', type: 'K', target: 'QAS', projectCode: 'ZPROJ' },
    { id: 'cfg-b', label: 'Customizing PRD', type: 'W', target: 'PRD', projectCode: 'ZPROJ' },
  ],
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe('project-settings App', () => {
  it('shows empty-state message when the project has no configs', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(emptyProject);
      if (key === 'project.previewTemplate') return ok({ text: 'PRJ-1 Sample', length: 12, warnings: [], truncated: false });
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText(/No configurations yet/i);
  });

  it('renders one row per existing config', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return ok({ text: 'PRJ-1', length: 5, warnings: [], truncated: false });
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('Workbench QAS');
    expect(screen.getByText('Customizing PRD')).toBeInTheDocument();
    expect(screen.getAllByText('QAS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PRD').length).toBeGreaterThan(0);
  });

  it('"+ Add config" → modal → save calls project.config.add and refreshes', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(emptyProject);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      if (key === 'project.config.add') return ok({ id: 'cfg-new' });
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No configurations yet/i);
    await user.click(screen.getByText('+ Add config'));
    await screen.findByText('Add transport configuration');
    const inputs = screen.getAllByRole('textbox');
    // Label, Target, Project code — Type is a <select>, not a textbox in the mock
    await user.type(inputs[0], 'Workbench QAS');
    await user.type(inputs[1], 'QAS');
    await user.type(inputs[2], 'ZPROJ');
    await user.click(screen.getByText('Save', { selector: 'button' }));
    await waitFor(() => {
      const addCall = invokeMock.mock.calls.find((c) => c[0] === 'project.config.add');
      expect(addCall).toBeDefined();
      expect(addCall![1]).toMatchObject({
        projectId: '10001',
        config: { label: 'Workbench QAS', target: 'QAS', projectCode: 'ZPROJ' },
      });
    });
  });

  it('shows the error inline when project.config.add returns a label-duplicate error', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(emptyProject);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      if (key === 'project.config.add') return fail('A configuration with label "Workbench QAS" already exists in this project');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No configurations yet/i);
    await user.click(screen.getByText('+ Add config'));
    await screen.findByText('Add transport configuration');
    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[0], 'Workbench QAS');
    await user.type(inputs[1], 'QAS');
    await user.type(inputs[2], 'ZPROJ');
    await user.click(screen.getByText('Save', { selector: 'button' }));
    await screen.findByText(/already exists/);
  });

  it('Edit pre-fills the modal with the row values', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Workbench QAS');
    const editButtons = screen.getAllByText('Edit');
    await user.click(editButtons[0]);
    await screen.findByText('Edit transport configuration');
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs[0].value).toBe('Workbench QAS');
    expect(inputs[1].value).toBe('QAS');
    expect(inputs[2].value).toBe('ZPROJ');
  });

  it('Delete on a row calls project.config.delete', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      if (key === 'project.config.delete') return ok({ ok: true });
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Workbench QAS');
    const deleteButtons = screen.getAllByText('Delete');
    await user.click(deleteButtons[0]);
    // confirm button appears in the same row
    await user.click(screen.getByText('Confirm delete'));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project.config.delete', {
        projectId: '10001',
        configId: 'cfg-a',
      });
    });
  });

  it('"Save settings" persists only connection + template via project.saveSettings', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      if (key === 'project.saveSettings') return ok({ ok: true });
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Workbench QAS');
    await user.click(screen.getByText('Save settings'));
    await waitFor(() => {
      const call = invokeMock.mock.calls.find((c) => c[0] === 'project.saveSettings');
      expect(call).toBeDefined();
      expect(call![1]).toMatchObject({
        projectId: '10001',
        settings: { connectionId: 'conn-1' },
      });
    });
  });
});
```

- [ ] **Step 2: Run the new test — expect FAIL (App still has the old shape)**

```bash
npm test -- src/frontend/project-settings.test.tsx
```

Expected: most cases fail with `Unable to find text "No configurations yet"` or similar mismatches.

### Step 3: Rewrite `src/frontend/project-settings.tsx`

- [ ] **Step 3: Replace the file**

```tsx
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Label,
  RadioGroup,
  SectionMessage,
  Select,
  Stack,
  Text,
  TextArea,
  Textfield,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';
import { SmartValuesPicker } from './components/SmartValuesPicker';
import type { ProjectConfig, RenderResult, TransportConfig, TransportType } from '../lib/types';

const DEFAULT_DESCRIPTION_TEMPLATE = '{{issue.key}} {{issue.fields.summary}}';

interface ConnPublic {
  id: string;
  label: string;
}

interface SelectOption {
  label: string;
  value: string;
}

type ResolverResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; severity?: string; target?: string; httpStatus?: number } };

const TYPE_LABELS: Record<TransportType, string> = {
  K: 'Workbench',
  W: 'Customizing',
  T: 'Copy',
};

const TYPE_OPTIONS: SelectOption[] = [
  { label: 'Workbench', value: 'K' },
  { label: 'Customizing', value: 'W' },
  { label: 'Copy', value: 'T' },
];

interface ConfigDraft {
  id?: string; // present iff editing
  label: string;
  type: TransportType;
  target: string;
  projectCode: string;
}

export const App: React.FC = () => {
  const [projectId, setProjectId] = useState<string>('');
  const [connections, setConnections] = useState<ConnPublic[]>([]);
  const [cfg, setCfg] = useState<ProjectConfig | null>(null);
  const [preview, setPreview] = useState<RenderResult | null>(null);
  const [message, setMessage] = useState<string>('');
  const [draft, setDraft] = useState<ConfigDraft | null>(null);  // null = modal closed
  const [draftError, setDraftError] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const ctx = (await view.getContext()) as unknown as { extension: { project: { id: string } } };
      setProjectId(ctx.extension.project.id);
      const conns = await invoke<ResolverResult<ConnPublic[]>>('connections.list');
      setConnections(conns.ok ? conns.data : []);
      if (!conns.ok) setMessage(conns.error.message);
      const c = await invoke<ResolverResult<ProjectConfig | undefined>>('project.getConfig', {
        projectId: ctx.extension.project.id,
      });
      const cfgValue = c.ok ? c.data : undefined;
      if (!c.ok) setMessage(c.error.message);
      setCfg(
        cfgValue ?? {
          connectionId: undefined,
          connectionOverride: undefined,
          descriptionTemplate: DEFAULT_DESCRIPTION_TEMPLATE,
          configs: [],
        },
      );
    })();
  }, []);

  useEffect(() => {
    if (cfg?.descriptionTemplate && cfg.descriptionTemplate.length > 0) {
      void onPreview(cfg.descriptionTemplate);
    } else {
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.descriptionTemplate]);

  const onPreview = async (template: string): Promise<void> => {
    const sampleCode = cfg?.configs?.[0]?.projectCode || 'PRJ';
    const r = await invoke<ResolverResult<RenderResult>>('project.previewTemplate', {
      template,
      sampleContext: { issue: { key: `${sampleCode}-1`, fields: { summary: 'Sample summary' } } },
    });
    if (r.ok) setPreview(r.data);
    else setMessage(r.error.message);
  };

  const refreshProject = async (): Promise<void> => {
    const c = await invoke<ResolverResult<ProjectConfig | undefined>>('project.getConfig', { projectId });
    if (c.ok && c.data) setCfg(c.data);
  };

  const onSaveSettings = async (): Promise<void> => {
    if (!cfg) return;
    const r = await invoke<ResolverResult<unknown>>('project.saveSettings', {
      projectId,
      settings: {
        connectionId: cfg.connectionId,
        connectionOverride: cfg.connectionOverride,
        descriptionTemplate: cfg.descriptionTemplate,
      },
    });
    setMessage(r.ok ? 'Saved' : r.error.message);
  };

  const openAdd = (): void => {
    setDraft({ label: '', type: 'K', target: '', projectCode: '' });
    setDraftError('');
  };

  const openEdit = (c: TransportConfig): void => {
    setDraft({ id: c.id, label: c.label, type: c.type, target: c.target, projectCode: c.projectCode });
    setDraftError('');
  };

  const onSubmitDraft = async (): Promise<void> => {
    if (!draft) return;
    const payload = {
      label: draft.label.trim(),
      type: draft.type,
      target: draft.target.trim(),
      projectCode: draft.projectCode.trim(),
    };
    const r = draft.id
      ? await invoke<ResolverResult<unknown>>('project.config.update', {
          projectId,
          configId: draft.id,
          patch: payload,
        })
      : await invoke<ResolverResult<{ id: string }>>('project.config.add', { projectId, config: payload });
    if (r.ok) {
      setDraft(null);
      await refreshProject();
    } else {
      setDraftError(r.error.message);
    }
  };

  const onConfirmDelete = async (): Promise<void> => {
    if (!confirmDeleteId) return;
    const r = await invoke<ResolverResult<unknown>>('project.config.delete', {
      projectId,
      configId: confirmDeleteId,
    });
    setConfirmDeleteId(null);
    if (r.ok) await refreshProject();
    else setMessage(r.error.message);
  };

  if (!cfg) return <Text>Loading…</Text>;

  return (
    <Stack space="space.200">
      <Heading as="h1">SAP Transport — Project Settings</Heading>
      {message && (
        <SectionMessage>
          <Text>{message}</Text>
        </SectionMessage>
      )}

      <Heading as="h2">SAP Connection</Heading>
      <Label labelFor="connection-mode">Mode</Label>
      <RadioGroup
        name="connection-mode"
        value={cfg.connectionOverride ? 'override' : 'catalog'}
        options={[
          { name: 'mode', value: 'catalog', label: 'From catalog' },
          { name: 'mode', value: 'override', label: 'Override' },
        ]}
        onChange={(v) => {
          const mode = (v.target as { value?: string }).value;
          setCfg({
            ...cfg,
            connectionOverride:
              mode === 'override'
                ? { id: 'override', label: 'override', hostname: '', systemId: '', client: '', username: '', password: '' }
                : undefined,
          });
        }}
      />
      {!cfg.connectionOverride && (
        <Select
          options={connections.map((c) => ({ label: c.label, value: c.id }))}
          value={
            cfg.connectionId
              ? { label: connections.find((c) => c.id === cfg.connectionId)?.label ?? cfg.connectionId, value: cfg.connectionId }
              : undefined
          }
          onChange={(opt) => {
            const o = opt as SelectOption | null;
            setCfg({ ...cfg, connectionId: o?.value });
          }}
        />
      )}
      {cfg.connectionOverride && (
        <Stack space="space.100">
          <Label labelFor="ov-hostname">Hostname (https URL)</Label>
          <Textfield
            placeholder="https://sap.example.com"
            value={cfg.connectionOverride.hostname}
            onChange={(e) =>
              setCfg({ ...cfg, connectionOverride: { ...cfg.connectionOverride!, hostname: (e.target as { value?: string }).value ?? '' } })
            }
          />
          <Label labelFor="ov-systemId">System ID (3 chars)</Label>
          <Textfield
            placeholder="A4H"
            value={cfg.connectionOverride.systemId}
            onChange={(e) =>
              setCfg({ ...cfg, connectionOverride: { ...cfg.connectionOverride!, systemId: (e.target as { value?: string }).value ?? '' } })
            }
          />
          <Label labelFor="ov-client">Client (3 digits)</Label>
          <Textfield
            value={cfg.connectionOverride.client}
            onChange={(e) =>
              setCfg({ ...cfg, connectionOverride: { ...cfg.connectionOverride!, client: (e.target as { value?: string }).value ?? '' } })
            }
          />
          <Label labelFor="ov-username">Username</Label>
          <Textfield
            value={cfg.connectionOverride.username}
            onChange={(e) =>
              setCfg({ ...cfg, connectionOverride: { ...cfg.connectionOverride!, username: (e.target as { value?: string }).value ?? '' } })
            }
          />
          <Label labelFor="ov-password">Password</Label>
          <Textfield
            type="password"
            value={cfg.connectionOverride.password}
            onChange={(e) =>
              setCfg({ ...cfg, connectionOverride: { ...cfg.connectionOverride!, password: (e.target as { value?: string }).value ?? '' } })
            }
          />
        </Stack>
      )}

      <Heading as="h2">Description template</Heading>
      <Inline space="space.050">
        <SmartValuesPicker
          onInsert={(tok) => {
            const cur = cfg.descriptionTemplate ?? '';
            const next = cur.length > 0 && !cur.endsWith(' ') ? cur + ' ' + tok : cur + tok;
            setCfg({ ...cfg, descriptionTemplate: next });
            void onPreview(next);
          }}
        />
      </Inline>
      <TextArea
        value={cfg.descriptionTemplate}
        onChange={(e) => {
          const next = (e.target as { value?: string }).value ?? '';
          setCfg({ ...cfg, descriptionTemplate: next });
          void onPreview(next);
        }}
      />
      {preview && (
        <Box padding="space.100">
          <Text>
            Preview: "{preview.text}" ({preview.length}/60{preview.truncated ? ' — truncated' : ''})
          </Text>
          {preview.warnings.map((w) => (
            <Text key={w}>⚠ {w}</Text>
          ))}
        </Box>
      )}

      <Inline space="space.100">
        <Button appearance="primary" onClick={() => void onSaveSettings()}>
          Save settings
        </Button>
      </Inline>

      <Heading as="h2">Transport configurations</Heading>
      <Inline space="space.100">
        <Button onClick={openAdd}>+ Add config</Button>
      </Inline>
      {cfg.configs.length === 0 ? (
        <Text>No configurations yet — click + Add config to define one.</Text>
      ) : (
        <Stack space="space.100">
          {cfg.configs.map((c) => (
            <Inline key={c.id} space="space.100">
              <Text>{c.label}</Text>
              <Text>{TYPE_LABELS[c.type]}</Text>
              <Text>{c.target}</Text>
              <Text>{c.projectCode}</Text>
              <Button onClick={() => openEdit(c)}>Edit</Button>
              {confirmDeleteId === c.id ? (
                <Inline space="space.050">
                  <Button appearance="danger" onClick={() => void onConfirmDelete()}>Confirm delete</Button>
                  <Button onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                </Inline>
              ) : (
                <Button onClick={() => setConfirmDeleteId(c.id)}>Delete</Button>
              )}
            </Inline>
          ))}
        </Stack>
      )}

      {draft && (
        <Box padding="space.200">
          <Heading as="h3">{draft.id ? 'Edit' : 'Add'} transport configuration</Heading>
          {draftError && (
            <SectionMessage appearance="error">
              <Text>{draftError}</Text>
            </SectionMessage>
          )}
          <Label labelFor="draft-label">Label</Label>
          <Textfield
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: (e.target as { value?: string }).value ?? '' })}
          />
          <Label labelFor="draft-type">Type</Label>
          <Select
            options={TYPE_OPTIONS}
            value={{ label: TYPE_LABELS[draft.type], value: draft.type }}
            onChange={(opt) => {
              const o = opt as SelectOption | null;
              setDraft({ ...draft, type: (o?.value ?? 'K') as TransportType });
            }}
          />
          <Label labelFor="draft-target">Target</Label>
          <Textfield
            value={draft.target}
            onChange={(e) => setDraft({ ...draft, target: (e.target as { value?: string }).value ?? '' })}
          />
          <Label labelFor="draft-projectCode">Project code</Label>
          <Textfield
            value={draft.projectCode}
            onChange={(e) => setDraft({ ...draft, projectCode: (e.target as { value?: string }).value ?? '' })}
          />
          <Inline space="space.100">
            <Button appearance="primary" onClick={() => void onSubmitDraft()}>Save</Button>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
          </Inline>
        </Box>
      )}
    </Stack>
  );
};

ForgeReconciler.render(<App />);
```

- [ ] **Step 4: Run the project-settings tests — expect PASS**

```bash
npm test -- src/frontend/project-settings.test.tsx
```

Expected: all green.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/frontend/project-settings.tsx src/frontend/project-settings.test.tsx
```

```bash
git commit -m "$(cat <<'EOF'
feat(project-settings): rewrite UI for multi-config model

Replace the single-form project-settings page with three sections:
SAP Connection (catalog or override) and Description template still
have a single "Save settings" button that persists via the new
project.saveSettings resolver. The new "Transport configurations"
section renders an inline list of configs (label, type, target,
project code) with per-row Edit and Delete actions and a "+ Add
config" button. Add/Edit opens an inline draft block with the four
fields. Save calls project.config.add or project.config.update;
label-uniqueness errors are surfaced inline in the draft. Delete
asks for inline confirmation before calling project.config.delete.
EOF
)"
```

---

## Task 3: Issue panel UI update

**Files:**
- Modify: `static/issue-panel/src/App.tsx`
- Adapt: `static/issue-panel/src/App.test.tsx`

### Step 1: Adapt the test file

- [ ] **Step 1: Update `static/issue-panel/src/App.test.tsx`**

Replace the six tests that depend on the three hardcoded buttons (the `+ Workbench`, `+ Customizing`, `+ Copy` modal flow and the modal `target` field) with the following new cases. Other tests (list rendering, ADT link, refresh, release, link-existing, error banners) stay as-is — they don't depend on the create-button names.

At the top of the file, extend the `@forge/bridge` mock with a `project.getConfig` invocation handled inside `invokeMock` (since `invokeMock` is already the universal dispatcher).

Add the following test cases inside `describe('issue-panel App (Custom UI)', () => { ... })`:

```tsx
it('renders one "+ <label>" button per configured transport config', async () => {
  invokeMock.mockImplementation(async (key: string) => {
    if (key === 'issue.list') return ok([]);
    if (key === 'project.getConfig')
      return ok({
        connectionId: 'conn-1',
        descriptionTemplate: '',
        configs: [
          { id: 'cfg-a', label: 'Workbench QAS', type: 'K', target: 'QAS', projectCode: 'ZPROJ' },
          { id: 'cfg-b', label: 'Customizing PRD', type: 'W', target: 'PRD', projectCode: 'ZPROJ' },
        ],
      });
    return ok(undefined);
  });
  render(<App />);
  await screen.findByRole('button', { name: '+ Workbench QAS' });
  expect(screen.getByRole('button', { name: '+ Customizing PRD' })).toBeInTheDocument();
  // Old hardcoded labels no longer exist:
  expect(screen.queryByRole('button', { name: '+ Workbench' })).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Customizing' })).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Copy' })).toBeNull();
});

it('shows the empty-state message when project has no configs', async () => {
  invokeMock.mockImplementation(async (key: string) => {
    if (key === 'issue.list') return ok([]);
    if (key === 'project.getConfig')
      return ok({ connectionId: 'conn-1', descriptionTemplate: '', configs: [] });
    return ok(undefined);
  });
  render(<App />);
  await screen.findByText(/Ask a project admin to add a transport configuration/i);
  // Link existing is always available:
  expect(screen.getByRole('button', { name: 'Link existing' })).toBeInTheDocument();
});

it('clicking a config button opens a modal titled with that label and only one input', async () => {
  invokeMock.mockImplementation(async (key: string) => {
    if (key === 'issue.list') return ok([]);
    if (key === 'project.getConfig')
      return ok({
        connectionId: 'conn-1',
        descriptionTemplate: '',
        configs: [{ id: 'cfg-a', label: 'Workbench QAS', type: 'K', target: 'QAS', projectCode: 'ZPROJ' }],
      });
    return ok(undefined);
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: '+ Workbench QAS' }));
  await screen.findByText('Create Workbench QAS');
  const inputs = screen.getAllByRole('textbox');
  expect(inputs).toHaveLength(1); // only description override
});

it('Create submit passes configId (not type/target) to issue.create', async () => {
  invokeMock.mockImplementation(async (key: string, payload?: unknown) => {
    if (key === 'issue.list') return ok([]);
    if (key === 'project.getConfig')
      return ok({
        connectionId: 'conn-1',
        descriptionTemplate: '',
        configs: [{ id: 'cfg-a', label: 'Workbench QAS', type: 'K', target: 'QAS', projectCode: 'ZPROJ' }],
      });
    if (key === 'issue.create') {
      const p = payload as { configId: string };
      return ok({
        requestId: 'DEVK900200',
        type: 'K' as const,
        target: 'QAS',
        description: 'X',
        createdAt: '2026-01-01T00:00:00Z',
        status: 'D',
        statusText: 'Modifiable',
      });
    }
    return ok(undefined);
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: '+ Workbench QAS' }));
  await screen.findByText('Create Workbench QAS');
  await user.type(screen.getByRole('textbox'), 'My change');
  await user.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => {
    const call = invokeMock.mock.calls.find((c) => c[0] === 'issue.create');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({
      projectId: '10001',
      issueKey: 'PROJ-1',
      configId: 'cfg-a',
      descriptionOverride: 'My change',
    });
    expect((call![1] as Record<string, unknown>).type).toBeUndefined();
    expect((call![1] as Record<string, unknown>).target).toBeUndefined();
  });
});
```

Delete the previous tests for `+ Workbench`, `+ Customizing`, `+ Copy`, the test that asserted a `target` field exists in the modal, and the `Cancel on the Create modal` test (rewrite it for the new config-based modal):

```tsx
it('Cancel on the Create modal closes it without calling issue.create', async () => {
  invokeMock.mockImplementation(async (key: string) => {
    if (key === 'issue.list') return ok([]);
    if (key === 'project.getConfig')
      return ok({
        connectionId: 'conn-1',
        descriptionTemplate: '',
        configs: [{ id: 'cfg-a', label: 'Workbench QAS', type: 'K', target: 'QAS', projectCode: 'ZPROJ' }],
      });
    return ok(undefined);
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: '+ Workbench QAS' }));
  await screen.findByText('Create Workbench QAS');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => {
    expect(screen.queryByText('Create Workbench QAS')).not.toBeInTheDocument();
  });
  expect(invokeMock.mock.calls.find((c) => c[0] === 'issue.create')).toBeUndefined();
});
```

- [ ] **Step 2: Run the test file — expect FAIL**

```bash
npm test -- static/issue-panel/src/App.test.tsx
```

Expected: the new cases fail because the App still has hardcoded buttons.

### Step 3: Update `static/issue-panel/src/App.tsx`

- [ ] **Step 3: Replace `App.tsx` with the dynamic version**

The full file (replacing the existing one):

```tsx
import React, { useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import DynamicTable from '@atlaskit/dynamic-table';
import Heading from '@atlaskit/heading';
import Modal, {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
} from '@atlaskit/modal-dialog';
import SectionMessage from '@atlaskit/section-message';
import Textfield from '@atlaskit/textfield';
import { invoke, router, view } from '@forge/bridge';
import type { ProjectConfig, SapTransportEntry, TransportConfig, TransportType } from './types';

interface IssueContext {
  extension: {
    project: { id: string };
    issue: { key: string };
  };
}

type ResolverResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: string; message: string; severity?: string; target?: string; httpStatus?: number };
    };

const TYPE_LABELS: Record<TransportType, string> = {
  K: 'Workbench',
  W: 'Customizing',
  T: 'Copy',
};

const buildAdtUrl = (systemId: string, requestId: string): string =>
  `adt://${systemId}/sap/bc/adt/cts/transportrequests/${requestId}`;

export const App: React.FC = () => {
  const [projectId, setProjectId] = useState<string>('');
  const [issueKey, setIssueKey] = useState<string>('');
  const [entries, setEntries] = useState<SapTransportEntry[]>([]);
  const [configs, setConfigs] = useState<TransportConfig[]>([]);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [createFor, setCreateFor] = useState<TransportConfig | null>(null);
  const [linkOpen, setLinkOpen] = useState<boolean>(false);

  useEffect(() => {
    void (async () => {
      const ctx = (await view.getContext()) as unknown as IssueContext;
      setProjectId(ctx.extension.project.id);
      setIssueKey(ctx.extension.issue.key);
      const [list, project] = await Promise.all([
        invoke<ResolverResult<SapTransportEntry[]>>('issue.list', { issueKey: ctx.extension.issue.key }),
        invoke<ResolverResult<ProjectConfig | undefined>>('project.getConfig', { projectId: ctx.extension.project.id }),
      ]);
      setEntries(list.ok ? list.data : []);
      if (!list.ok) setMessage({ kind: 'error', text: list.error.message });
      setConfigs(project.ok && project.data ? project.data.configs : []);
    })();
  }, []);

  const reload = async (): Promise<void> => {
    const r = await invoke<ResolverResult<SapTransportEntry[]>>('issue.list', { issueKey });
    setEntries(r.ok ? r.data : []);
    if (!r.ok) setMessage({ kind: 'error', text: r.error.message });
  };

  const onOpenAdt = async (entry: SapTransportEntry): Promise<void> => {
    if (!entry.systemId) return;
    const url = buildAdtUrl(entry.systemId, entry.requestId);
    try {
      await router.open(url);
    } catch (e) {
      setMessage({ kind: 'error', text: `Could not open ADT link: ${(e as Error).message}` });
    }
  };

  const onRelease = async (requestId: string): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<unknown>>('issue.release', { projectId, issueKey, requestId });
      if (r.ok) {
        setMessage({ kind: 'success', text: `Released ${requestId}` });
        await reload();
      } else {
        setMessage({ kind: 'error', text: r.error.message });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const onRefresh = async (requestId: string): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<unknown>>('issue.refresh', { projectId, issueKey, requestId });
      if (r.ok) await reload();
      else setMessage({ kind: 'error', text: r.error.message });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const head = {
    cells: [
      { key: 'request', content: 'Request' },
      { key: 'type', content: 'Type' },
      { key: 'description', content: 'Description' },
      { key: 'status', content: 'Status' },
      { key: 'actions', content: 'Actions' },
    ],
  };

  const rows = entries.map((entry) => ({
    key: entry.requestId,
    cells: [
      {
        key: 'request',
        content: entry.systemId ? (
          <Button appearance="subtle" spacing="compact" onClick={() => { void onOpenAdt(entry); }}>
            {entry.requestId}
          </Button>
        ) : (
          <span>{entry.requestId}</span>
        ),
      },
      { key: 'type', content: <span>{TYPE_LABELS[entry.type]}</span> },
      { key: 'description', content: <span>{entry.description}</span> },
      { key: 'status', content: <span>{entry.statusText}</span> },
      {
        key: 'actions',
        content: (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => void onRefresh(entry.requestId)}>Refresh</Button>
            {entry.status !== 'R' && (
              <Button appearance="primary" onClick={() => void onRelease(entry.requestId)}>
                Release
              </Button>
            )}
          </div>
        ),
      },
    ],
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 8 }}>
      <Heading size="medium">SAP Transport</Heading>
      {message && (
        <SectionMessage appearance={message.kind === 'success' ? 'success' : 'error'}>
          <p>{message.text}</p>
        </SectionMessage>
      )}

      <DynamicTable head={head} rows={rows} emptyView={<span>No transports linked to this issue.</span>} />

      {configs.length === 0 ? (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={() => setLinkOpen(true)}>Link existing</Button>
          </div>
          <p style={{ color: '#626f86', marginTop: 8 }}>
            ⚠ Ask a project admin to add a transport configuration in project settings before creating new requests.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {configs.map((c) => (
            <Button key={c.id} onClick={() => setCreateFor(c)}>{`+ ${c.label}`}</Button>
          ))}
          <Button onClick={() => setLinkOpen(true)}>Link existing</Button>
        </div>
      )}

      <small style={{ color: '#626f86' }}>
        Opening a Request ID requires SAP ADT (Eclipse) installed locally.
      </small>

      <ModalTransition>
        {createFor && (
          <CreateDialog
            config={createFor}
            projectId={projectId}
            issueKey={issueKey}
            onClose={() => setCreateFor(null)}
            onDone={async (msg) => {
              setMessage({ kind: 'success', text: msg });
              setCreateFor(null);
              await reload();
            }}
            onError={(msg) => setMessage({ kind: 'error', text: msg })}
          />
        )}
      </ModalTransition>

      <ModalTransition>
        {linkOpen && (
          <LinkDialog
            projectId={projectId}
            issueKey={issueKey}
            onClose={() => setLinkOpen(false)}
            onDone={async (msg) => {
              setMessage({ kind: 'success', text: msg });
              setLinkOpen(false);
              await reload();
            }}
            onError={(msg) => setMessage({ kind: 'error', text: msg })}
          />
        )}
      </ModalTransition>
    </div>
  );
};

interface CreateDialogProps {
  config: TransportConfig;
  projectId: string;
  issueKey: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}

export const CreateDialog: React.FC<CreateDialogProps> = ({ config, projectId, issueKey, onClose, onDone, onError }) => {
  const [override, setOverride] = useState<string>('');

  const submit = async (): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<SapTransportEntry>>('issue.create', {
        projectId,
        issueKey,
        configId: config.id,
        descriptionOverride: override,
      });
      if (r.ok) await onDone(`Created ${r.data.requestId}`);
      else onError(r.error.message);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>Create {config.label}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>Description override (optional, falls back to project template)</label>
          <Textfield value={override} onChange={(e) => setOverride((e.target as HTMLInputElement).value)} />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="primary" onClick={() => void submit()}>Create</Button>
        <Button onClick={onClose}>Cancel</Button>
      </ModalFooter>
    </Modal>
  );
};

interface LinkDialogProps {
  projectId: string;
  issueKey: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}

export const LinkDialog: React.FC<LinkDialogProps> = ({ projectId, issueKey, onClose, onDone, onError }) => {
  const [requestId, setRequestId] = useState<string>('');

  const submit = async (): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<SapTransportEntry>>('issue.link', {
        projectId, issueKey, requestId,
      });
      if (r.ok) await onDone(`Linked ${r.data.requestId}`);
      else onError(r.error.message);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>Link existing transport</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>Transport request ID</label>
          <Textfield
            value={requestId}
            placeholder="DEVK900123"
            onChange={(e) => setRequestId((e.target as HTMLInputElement).value)}
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="primary" onClick={() => void submit()}>Link</Button>
        <Button onClick={onClose}>Cancel</Button>
      </ModalFooter>
    </Modal>
  );
};
```

### Step 4: Add `ProjectConfig` and `TransportConfig` to `static/issue-panel/src/types.ts`

- [ ] **Step 4: Update the type re-export**

```ts
// static/issue-panel/src/types.ts
export type {
  ProjectConfig,
  SapTransportEntry,
  TransportConfig,
  TransportType,
} from '../../../src/lib/types';
```

- [ ] **Step 5: Run the issue-panel tests — expect PASS**

```bash
npm test -- static/issue-panel/src/App.test.tsx
```

Expected: all green. Total panel test count should be roughly 18 (4 new ADT/listing/empty/configs + 16 unchanged from PR #11, minus the 3 hardcoded-button tests removed).

### Step 6: Commit Task 3

- [ ] **Step 6: Stage and commit**

```bash
git add static/issue-panel/src/App.tsx static/issue-panel/src/App.test.tsx static/issue-panel/src/types.ts
```

```bash
git commit -m "$(cat <<'EOF'
feat(issue-panel): render one + <label> button per project config

The three hardcoded + Workbench / + Customizing / + Copy buttons are
gone. The panel now loads project.getConfig on mount and renders one
Atlaskit Button per entry in configs[], children = '+ ' + label.
Clicking opens a modal titled 'Create <label>' with a single
Description override input; submit sends { configId, descriptionOverride }
to the new issue.create resolver signature. The Target field is no
longer in the modal — a different target now means defining a
different config.

When configs[] is empty, the panel shows Link existing alone plus an
inline message asking the user to talk to a project admin. ADT link,
list, refresh, release, and link-existing behaviour are unchanged.

Re-exports ProjectConfig and TransportConfig in
static/issue-panel/src/types.ts so the bundle keeps the shared
backend types as the single source of truth.
EOF
)"
```

---

## Task 4: Final verification

**Files:** none (only verification + optional test additions).

- [ ] **Step 1: Full lint + tests + build + forge lint + coverage**

Run each in order. All must pass. If coverage drops below 90% on any of the four metrics, do Step 2.

```bash
npm run lint
```

Expected: exit 0.

```bash
npm test
```

Expected: all green (~14 test files; test count increased by the new project-config + frontend cases minus the removed ones).

```bash
npm run build:issue-panel
```

Expected: `✓ built in <time>` and the chunk size warning we already accept from PR #11. No errors.

```bash
npx @forge/cli lint
```

Expected: the same `*` egress warning we already documented (gotcha #12). No errors.

```bash
npm run test:coverage
```

Expected: all four metrics ≥ 90%. Read the table; if any file dropped below the gate, note the uncovered lines.

- [ ] **Step 2 (only if coverage gap): add focused branch tests**

For each file under 90% branches, open the file at the uncovered line numbers, identify the branch (an `if`, a ternary, an `??`, a switch arm), and add the smallest possible test that exercises both sides of that branch in the matching `*.test.ts` / `*.test.tsx`. Re-run `npm run test:coverage`. Iterate until ≥ 90% on all four.

If you needed to add tests, commit them as a separate small commit on this branch:

```bash
git add <files-you-touched>
git commit -m "test(coverage): add focused branch tests to keep ≥90% after multi-config rewrite"
```

- [ ] **Step 3: Lockfile sanity check (no new deps were added, but confirm)**

```bash
git diff main -- package.json package-lock.json
```

Expected: empty (this task should NOT have added or removed any npm packages). If non-empty unexpectedly, investigate before opening the PR.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin feature/project-multi-config
```

```bash
gh pr create --title "Multi-config project model + automation configLabel" --body "$(cat <<'EOF'
## Summary
- Replace the single per-project transport configuration with a named array (`configs: TransportConfig[]`) holding `{id, label, type, target, projectCode}` per entry; connection and description template stay project-level.
- Backend resolver surface moves from `project.saveConfig` to `project.saveSettings` + `project.config.add/update/delete`; `getConfig` normalises legacy documents on read (hard cutover — no automatic migration).
- `issue.create` now takes `configId`; `automation.create` (Jira automation action) takes `configLabel`. Both share a `createTransportFromConfig` helper. The automation action's manifest input changes from `type+target` to `configLabel`.
- Issue panel renders one `+ <label>` button per config; modal simplifies to a single Description override input (no per-call target override).
- Project-settings page reorganised into Connection / Template / Configs sections with inline CRUD for configs.

Spec: `docs/superpowers/specs/2026-05-22-project-multi-config-design.md`
Plan: `docs/superpowers/plans/2026-05-22-project-multi-config-implementation.md`

## Test plan
- [ ] `npm run lint` — exit 0
- [ ] `npm test` — all green
- [ ] `npm run test:coverage` — ≥90% on all four metrics
- [ ] `npm run build:issue-panel` — builds, only the accepted chunk-size warning
- [ ] `npx @forge/cli lint` — only the accepted `*` egress warning
- [ ] After merge + `forge deploy`: run `npx @forge/cli install --upgrade --product Jira --site standardised.atlassian.net --environment development` because this PR changes the automation action's manifest inputs, which bumps the major version. Without the upgrade, the installation stays on the old version and the new configLabel input won't be wired (see SESSION_HANDOFF gotcha #11).
- [ ] Smoke test on `standardised.atlassian.net`: open a Jira issue, see one button per config, create a transport, verify Eclipse ADT opens via the Request ID button, and verify a Jira Automation rule with `configLabel: "<label>"` succeeds.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Remind the user about the post-merge install upgrade**

After merging the PR, the next `forge deploy` will bump the major version (because the manifest's automation inputs changed). The installed app stays on the previous major until explicitly upgraded:

```bash
npx @forge/cli install --upgrade --product Jira --site standardised.atlassian.net --environment development
```

This is the same flow documented in `docs/superpowers/SESSION_HANDOFF.md` gotcha #11 and in the `feedback-forge-install-upgrade` memory entry.

---

## Self-review (already done before saving this plan)

- **Spec coverage:** every requirement from the spec's §3 (types), §5 (resolvers), §6 (manifest), §7 (migration), §8 (UI), §9 (tests), §12 (acceptance) maps to at least one step in Tasks 1–4.
- **Placeholders:** none. Every step has either a command or a complete code block.
- **Type consistency:** `TransportConfig` shape is identical across types.ts, project-config.ts, issue-actions.ts, project-settings.tsx, App.tsx, and all tests.
- **Naming:** resolver names (`project.saveSettings`, `project.config.add/update/delete`) used consistently in index.ts, frontends, and tests.
