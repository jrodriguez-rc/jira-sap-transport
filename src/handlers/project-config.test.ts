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
    expect((r as unknown as Record<string, unknown>).projectCode).toBeUndefined();
    expect((r as unknown as Record<string, unknown>).defaults).toBeUndefined();
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
