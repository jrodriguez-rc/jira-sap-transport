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
    // The entry with systemId 'A4H' renders the request id as a Button. The
    // click handler calls router.open() — NOT an <a href> — because Forge's
    // iframe sandbox blocks navigation to non-http schemes and the manifest's
    // `permissions.external.fetch.client: ["adt:*"]` is the only channel that
    // lets the parent frame hand the URL off to the OS protocol handler.
    const requestButton = await screen.findByRole('button', { name: 'DEVK900100' });
    await user.click(requestButton);
    expect(routerOpenMock).toHaveBeenCalledWith(
      'adt://A4H/sap/bc/adt/cts/transportrequests/DEVK900100',
    );
  });

  it('shows an error banner when router.open rejects (e.g. user cancels prompt)', async () => {
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

  it('clicking "+ Workbench" opens the Create modal', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok([]);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('issue.list', { issueKey: 'PROJ-1' }));
    await user.click(screen.getByRole('button', { name: '+ Workbench' }));
    await screen.findByText('Create Workbench transport');
  });

  it('submitting the Create modal calls issue.create with the typed values', async () => {
    invokeMock.mockImplementation(async (key: string, payload?: unknown) => {
      if (key === 'issue.list') return ok([]);
      if (key === 'issue.create') {
        const p = payload as { type: string };
        return ok({
          requestId: 'DEVK900200',
          type: p.type as 'K',
          target: 'PRD',
          description: 'My new work',
          createdAt: '2026-01-03T00:00:00Z',
          status: 'D',
          statusText: 'Modifiable',
        });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('issue.list', { issueKey: 'PROJ-1' }));
    await user.click(screen.getByRole('button', { name: '+ Workbench' }));
    await screen.findByText('Create Workbench transport');

    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    await user.type(inputs[0], 'My new work');
    await user.type(inputs[1], 'PRD');

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      const createCall = invokeMock.mock.calls.find((c) => c[0] === 'issue.create');
      expect(createCall).toBeDefined();
      expect(createCall![1]).toMatchObject({
        projectId: '10001',
        issueKey: 'PROJ-1',
        type: 'K',
        descriptionOverride: 'My new work',
        target: 'PRD',
      });
    });
    await screen.findByText('Created DEVK900200');
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

  it('shows an error when issue.create returns Result.fail', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok([]);
      if (key === 'issue.create') return fail('cannot create');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('issue.list', { issueKey: 'PROJ-1' }));
    await user.click(screen.getByRole('button', { name: '+ Customizing' }));
    await screen.findByText('Create Customizing transport');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('cannot create');
  });

  it('Cancel on the Create modal closes it without calling issue.create', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok([]);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('issue.list', { issueKey: 'PROJ-1' }));
    await user.click(screen.getByRole('button', { name: '+ Copy' }));
    await screen.findByText('Create Copy transport');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByText('Create Copy transport')).not.toBeInTheDocument();
    });
    expect(invokeMock.mock.calls.find((c) => c[0] === 'issue.create')).toBeUndefined();
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

  it('shows the error message when issue.create throws synchronously inside the Create modal', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'issue.list') return ok([]);
      if (key === 'issue.create') throw new Error('create crash');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('issue.list', { issueKey: 'PROJ-1' }));
    await user.click(screen.getByRole('button', { name: '+ Workbench' }));
    await screen.findByText('Create Workbench transport');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('create crash');
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
