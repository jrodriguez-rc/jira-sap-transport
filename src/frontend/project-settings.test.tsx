// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@forge/bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  view: {
    getContext: vi.fn(async () => ({ extension: { project: { id: '10001' } } })),
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
    Heading: passthrough('h1'),
    Stack: passthrough('div'),
    Text: passthrough('span'),
    default: { render: vi.fn(), addConfig: vi.fn() },
  };
});

import { App } from './project-settings';
import type { ProjectConfig } from '../lib/types';

const ok = <T,>(data: T) => ({ ok: true as const, data });

describe('project-settings placeholder', () => {
  it('renders the multi-config placeholder when project has no document', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'project.getConfig') return ok(undefined);
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText(/Multi-config UI is being rewritten/i);
  });

  it('shows the existing config count from project.getConfig', async () => {
    const sample: ProjectConfig = {
      connectionId: 'conn-1',
      descriptionTemplate: '',
      configs: [
        { id: 'cfg-a', label: 'Workbench QAS', type: 'K', target: 'QAS', projectCode: 'ZPROJ' },
        { id: 'cfg-b', label: 'Customizing PRD', type: 'W', target: 'PRD', projectCode: 'ZPROJ' },
      ],
    };
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'project.getConfig') return ok(sample);
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText(/Configurations defined: 2/);
  });
});
