// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { invokeMock, routerOpenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  routerOpenMock: vi.fn(),
}));

vi.mock('@forge/bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  router: { open: (...args: unknown[]) => routerOpenMock(...args) },
  view: {
    getContext: vi.fn(async () => ({
      extension: { project: { id: '10001' }, issue: { key: 'PROJ-1' } },
    })),
  },
  events: { on: vi.fn(), once: vi.fn(), emit: vi.fn() },
}));

import { App } from './App';
import type { SapTransportEntry } from './types';

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message: string, code = 'ERR') => ({
  ok: false as const,
  error: { code, message, severity: 'error' },
});

const entries: SapTransportEntry[] = [
  {
    requestId: 'DEVK900100',
    type: 'K',
    target: 'PRD',
    description: 'Existing work',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'D',
    statusText: 'Modifiable',
    systemId: 'A4H',
  },
  {
    // Legacy entry: no systemId — must render as plain text, not a button.
    requestId: 'DEVK900099',
    type: 'W',
    target: 'PRD',
    description: 'Released cust',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'R',
    statusText: 'Released',
    releasedAt: '2026-01-02T00:00:00Z',
  },
];

beforeEach(() => {
  invokeMock.mockReset();
  routerOpenMock.mockReset();
  routerOpenMock.mockResolvedValue(undefined);
});

describe('issue-panel App (Custom UI)', () => {
  it('lists transports returned by issue.list', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok(entries);
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('DEVK900100');
    expect(screen.getByText('Existing work')).toBeInTheDocument();
    expect(screen.getByText('Modifiable')).toBeInTheDocument();
    expect(screen.getByText('DEVK900099')).toBeInTheDocument();
    expect(screen.getByText('Released')).toBeInTheDocument();
  });

  it('opens Eclipse ADT via router.open when the request button is clicked', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok(entries);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    // router.open() is the documented path for external URLs from Custom
    // UI — surfaces Atlassian's "open external link" prompt, then hands
    // the URL off to the OS. Requires `allow-popups` in the iframe
    // sandbox, which Forge appends when the manifest declares
    // `permissions.external.fetch.client: - address: '*'`.
    const requestButton = await screen.findByRole('button', { name: 'DEVK900100' });
    await user.click(requestButton);
    expect(routerOpenMock).toHaveBeenCalledWith(
      'adt://A4H/sap/bc/adt/cts/transportrequests/DEVK900100',
    );
  });

  it('shows an error banner when router.open rejects (user declines the prompt)', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok(entries);
      return ok(undefined);
    });
    routerOpenMock.mockRejectedValueOnce(new Error('user cancelled'));
    const user = userEvent.setup();
    render(<App />);
    const requestButton = await screen.findByRole('button', { name: 'DEVK900100' });
    await user.click(requestButton);
    await screen.findByText(/Could not open ADT link: user cancelled/);
  });

  it('renders the request id as plain text (no button) for legacy entries without systemId', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok(entries);
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('DEVK900099');
    expect(screen.queryByRole('button', { name: 'DEVK900099' })).toBeNull();
  });

  it('shows an error banner when issue.list fails', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return fail('list blew up');
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('list blew up');
  });

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
        void payload;
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

  it('clicking Release on a non-released row calls issue.release', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok(entries);
      if (key === 'issue.release') return ok(undefined);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('DEVK900100');
    const releaseBtn = screen.getByRole('button', { name: 'Release' });
    await user.click(releaseBtn);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('issue.release', {
        projectId: '10001',
        issueKey: 'PROJ-1',
        requestId: 'DEVK900100',
      });
    });
    await screen.findByText('Released DEVK900100');
  });

  it('does not render a Release button on a released row', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok([entries[1]]);
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('DEVK900099');
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
  });

  it('the Refresh button on a row calls issue.refresh', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok(entries);
      if (key === 'issue.refresh') return ok(undefined);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('DEVK900100');
    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' });
    await user.click(refreshButtons[0]);
    await waitFor(() => {
      const refreshCall = invokeMock.mock.calls.find((c) => c[0] === 'issue.refresh');
      expect(refreshCall).toBeDefined();
      expect(refreshCall![1]).toMatchObject({ projectId: '10001', issueKey: 'PROJ-1' });
    });
  });

  it('Link existing modal calls issue.link with the typed request id', async () => {
    invokeMock.mockImplementation(async (key: string, payload?: unknown) => {
      if (key === 'issue.list') return ok([]);
      if (key === 'issue.link') {
        return ok({
          requestId: (payload as { requestId: string }).requestId,
          type: 'K' as const,
          target: 'PRD',
          description: 'Linked',
          createdAt: '2026-01-01T00:00:00Z',
          status: 'D',
          statusText: 'Modifiable',
        });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('issue.list', { issueKey: 'PROJ-1' }));
    await user.click(screen.getByRole('button', { name: 'Link existing' }));
    await screen.findByText('Link existing transport');
    const input = (await screen.findByPlaceholderText('DEVK900123')) as HTMLInputElement;
    await user.type(input, 'DEVK900456');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('issue.link', {
        projectId: '10001',
        issueKey: 'PROJ-1',
        requestId: 'DEVK900456',
      });
    });
    await screen.findByText('Linked DEVK900456');
  });

  it('shows the error message when issue.release returns Result.fail', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok(entries);
      if (key === 'issue.release') return fail('release blocked');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('DEVK900100');
    await user.click(screen.getByRole('button', { name: 'Release' }));
    await screen.findByText('release blocked');
  });

  it('shows the error message when issue.release throws synchronously', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok(entries);
      if (key === 'issue.release') throw new Error('release crash');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('DEVK900100');
    await user.click(screen.getByRole('button', { name: 'Release' }));
    await screen.findByText('release crash');
  });

  it('shows the error message when issue.refresh returns Result.fail', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok(entries);
      if (key === 'issue.refresh') return fail('refresh denied');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('DEVK900100');
    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' });
    await user.click(refreshButtons[0]);
    await screen.findByText('refresh denied');
  });

  it('shows the error message when issue.refresh throws synchronously', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok(entries);
      if (key === 'issue.refresh') throw new Error('refresh crash');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('DEVK900100');
    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' });
    await user.click(refreshButtons[0]);
    await screen.findByText('refresh crash');
  });

  it('shows the error message when issue.link returns Result.fail', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok([]);
      if (key === 'issue.link') return fail('not found');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('issue.list', { issueKey: 'PROJ-1' }));
    await user.click(screen.getByRole('button', { name: 'Link existing' }));
    await screen.findByText('Link existing transport');
    const input = (await screen.findByPlaceholderText('DEVK900123')) as HTMLInputElement;
    await user.type(input, 'DEVK999999');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await screen.findByText('not found');
  });

  it('shows the error message when issue.link throws synchronously', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok([]);
      if (key === 'issue.link') throw new Error('link crash');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('issue.list', { issueKey: 'PROJ-1' }));
    await user.click(screen.getByRole('button', { name: 'Link existing' }));
    await screen.findByText('Link existing transport');
    const input = (await screen.findByPlaceholderText('DEVK900123')) as HTMLInputElement;
    await user.type(input, 'DEVK999999');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await screen.findByText('link crash');
  });

  it('renders no rows when issue.list returns an empty list', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok([]);
      return ok(undefined);
    });
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('issue.list', { issueKey: 'PROJ-1' }));
    expect(screen.queryByText('DEVK900100')).not.toBeInTheDocument();
    expect(screen.queryByText('DEVK900099')).not.toBeInTheDocument();
  });
});
