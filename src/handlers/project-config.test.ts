import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('@forge/api', () => ({
  storage: {
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    delete: vi.fn(),
    query: () => ({ where: () => ({ getMany: async () => ({ results: [] }) }) })
  },
  default: { asApp: () => ({ requestJira: vi.fn() }) },
  route: (s: TemplateStringsArray) => s.join('')
}));

import { getProjectConfigResolver, saveProjectConfigResolver, previewTemplateResolver } from './project-config';

beforeEach(() => { store.clear(); });

describe('project config resolvers', () => {
  it('returns undefined config for unknown projects', async () => {
    const res = await getProjectConfigResolver({ payload: { projectId: '1' }, context: {} });
    expect(res).toBeUndefined();
  });

  it('saves and reads project config', async () => {
    await saveProjectConfigResolver({
      payload: { projectId: '1', config: { projectCode: 'X', descriptionTemplate: '', defaults: { type: 'K' } } },
      context: {}
    });
    const res = await getProjectConfigResolver({ payload: { projectId: '1' }, context: {} });
    expect(res?.projectCode).toBe('X');
  });

  it('rejects invalid type defaults', async () => {
    await expect(saveProjectConfigResolver({
      payload: { projectId: '1', config: { projectCode: 'X', descriptionTemplate: '', defaults: { type: 'Z' as never } } },
      context: {}
    })).rejects.toThrow(/type/i);
  });
});

describe('previewTemplateResolver', () => {
  it('renders against a mock context using the given template', () => {
    const r = previewTemplateResolver({
      payload: {
        template: '{{issue.key}} {{issue.fields.summary}}',
        sampleContext: { issue: { key: 'PROJ-1', fields: { summary: 'Hi' } } }
      },
      context: {}
    });
    expect(r.text).toBe('PROJ-1 Hi');
    expect(r.truncated).toBe(false);
  });
});
