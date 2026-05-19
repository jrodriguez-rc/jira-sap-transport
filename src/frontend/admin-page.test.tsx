// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// `invokeMock` is hoisted so the `vi.mock('@forge/bridge', …)` factory
// (which Vitest hoists to the top of the file) can reach it.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@forge/bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  view: { getContext: vi.fn(async () => ({})) },
  events: { on: vi.fn(), once: vi.fn(), emit: vi.fn() },
}));

vi.mock('@forge/react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const React = await import('react');
  // Replace the string-tag primitives that need real DOM behavior so
  // user-event can interact with them and screen.getByRole works. All other
  // components stay as the original string tags — they still render as
  // unknown HTML elements but their children show up in the DOM, which is
  // all the assertions need.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Textfield = React.forwardRef<HTMLInputElement, any>((props, ref) => (
    <input ref={ref} {...props} />
  ));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TextArea = React.forwardRef<HTMLTextAreaElement, any>((props, ref) => (
    <textarea ref={ref} {...props} />
  ));
  return {
    ...actual,
    Textfield,
    TextArea,
    default: { render: vi.fn(), addConfig: vi.fn() },
  };
});

import { App } from './admin-page';

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message: string, code = 'ERR') => ({
  ok: false as const,
  error: { code, message, severity: 'error' },
});

const sampleConnections = [
  { id: 'sap-dev', label: 'SAP Dev', hostname: 'https://dev.sap.example', client: '100', username: 'user1' },
];

beforeEach(() => {
  invokeMock.mockReset();
});

describe('admin-page App', () => {
  it('renders the SAP Connections heading on mount', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      return ok(undefined);
    });
    render(<App />);
    expect(screen.getByText('SAP Connections')).toBeInTheDocument();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
  });

  it('lists connections returned by connections.list', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok(sampleConnections);
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('SAP Dev');
    expect(screen.getByText('https://dev.sap.example')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('user1')).toBeInTheDocument();
  });

  it('surfaces a Result envelope error from connections.list', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return fail('list failed');
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('list failed');
  });

  it('opens the New connection form when "+ Add connection" is clicked', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    expect(await screen.findByTitle('New connection')).toBeInTheDocument();
    // 'Label' also appears as the table column header, so scope this check to
    // the form's own Label elements.
    expect(screen.getByText('Hostname (https URL)')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
  });

  it('submitting the form calls connections.save with the typed values', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'connections.save') return ok({ id: 'new-1' });
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));

    // useForm registers controlled-ish inputs; user.type fires onChange per char.
    // Form has 5 textboxes (label, hostname, systemId, client, username) + 1
    // password input + the Description template textarea.
    const textboxes = await screen.findAllByRole('textbox');
    expect(textboxes.length).toBeGreaterThanOrEqual(5);

    await user.type(textboxes[0], 'My SAP');
    await user.type(textboxes[1], 'https://my.sap.example');
    await user.type(textboxes[2], 'A4H');
    await user.type(textboxes[3], '100');
    await user.type(textboxes[4], 'user1');
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(passwordInput, 'pw');

    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'connections.save');
      expect(saveCall).toBeDefined();
      expect(saveCall![1]).toMatchObject({
        label: 'My SAP',
        hostname: 'https://my.sap.example',
        systemId: 'A4H',
        client: '100',
        username: 'user1',
        password: 'pw',
      });
    });
    await screen.findByText('Saved');
  });

  it('clicking Delete on a row calls connections.delete with the id', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok(sampleConnections);
      if (key === 'connections.delete') return ok(undefined);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    const labelCell = await screen.findByText('SAP Dev');
    // Find the row's Delete button via the parent row context.
    const row = labelCell.closest('tr') ?? labelCell.closest('row') ?? document.body;
    const deleteBtn = within(row as HTMLElement).getByText('Delete');
    await user.click(deleteBtn);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('connections.delete', { id: 'sap-dev' });
    });
  });

  it('clicking Test connection shows success on a passing ping', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'connections.test') return { ok: true };
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    await user.click(screen.getByText('Test connection'));
    await screen.findByText('Connection OK');
    expect(invokeMock).toHaveBeenCalledWith('connections.test', expect.any(Object));
  });

  it('clicking Test connection shows the failure message on a failing ping', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'connections.test') return { ok: false, error: { message: 'auth refused' } };
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    await user.click(screen.getByText('Test connection'));
    await screen.findByText('auth refused');
  });

  it('shows the error message when connections.save returns Result.fail', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'connections.save') return fail('save failed');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    const inputs = await screen.findAllByRole('textbox');
    await userEvent.type(inputs[0], 'X');
    await userEvent.type(inputs[1], 'https://x');
    await userEvent.type(inputs[2], 'A4H');
    await userEvent.type(inputs[3], 'X');
    await userEvent.type(inputs[4], 'X');
    const pw = document.querySelector('input[type="password"]') as HTMLInputElement;
    await userEvent.type(pw, 'X');
    await user.click(screen.getByText('Save'));
    await screen.findByText('save failed');
  });

  it('cancel button closes the form', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    await user.click(screen.getByText('Cancel'));
    await waitFor(() => {
      expect(screen.queryByTitle('New connection')).not.toBeInTheDocument();
    });
  });

  it('shows an error when connections.save throws synchronously', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'connections.save') throw new Error('save crash');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    const inputs = await screen.findAllByRole('textbox');
    await user.type(inputs[0], 'X');
    await user.type(inputs[1], 'https://x');
    await user.type(inputs[2], 'A4H');
    await user.type(inputs[3], 'X');
    await user.type(inputs[4], 'X');
    const pw = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(pw, 'X');
    await user.click(screen.getByText('Save'));
    await screen.findByText('save crash');
  });

  it('shows an error when connections.delete returns Result.fail', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok(sampleConnections);
      if (key === 'connections.delete') return fail('delete denied');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    const labelCell = await screen.findByText('SAP Dev');
    const row = labelCell.closest('tr') ?? labelCell.closest('row') ?? document.body;
    const deleteBtn = within(row as HTMLElement).getByText('Delete');
    await user.click(deleteBtn);
    await screen.findByText('delete denied');
  });

  it('shows an error when connections.delete throws synchronously', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok(sampleConnections);
      if (key === 'connections.delete') throw new Error('delete crash');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    const labelCell = await screen.findByText('SAP Dev');
    const row = labelCell.closest('tr') ?? labelCell.closest('row') ?? document.body;
    const deleteBtn = within(row as HTMLElement).getByText('Delete');
    await user.click(deleteBtn);
    await screen.findByText('delete crash');
  });

  it('shows an error when connections.test throws synchronously', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'connections.test') throw new Error('test crash');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    await user.click(screen.getByText('Test connection'));
    await screen.findByText('test crash');
  });

  it('falls back to "Failed" when connections.test returns ok=false with no error', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'connections.test') return { ok: false };
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    await user.click(screen.getByText('Test connection'));
    await screen.findByText('Failed');
  });

  it('clicking the per-row Test button calls connections.test with { id }', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok(sampleConnections);
      if (key === 'connections.test') return { ok: true };
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    const labelCell = await screen.findByText('SAP Dev');
    const row = labelCell.closest('tr') ?? labelCell.closest('row') ?? document.body;
    const testBtn = within(row as HTMLElement).getByText('Test');
    await user.click(testBtn);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('connections.test', { id: 'sap-dev' });
    });
    await screen.findByText('Connection OK');
  });

  it('per-row Test shows the failure message when the ping fails', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok(sampleConnections);
      if (key === 'connections.test') return { ok: false, error: { message: 'host unreachable' } };
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    const labelCell = await screen.findByText('SAP Dev');
    const row = labelCell.closest('tr') ?? labelCell.closest('row') ?? document.body;
    const testBtn = within(row as HTMLElement).getByText('Test');
    await user.click(testBtn);
    await screen.findByText('host unreachable');
  });

  it('clicking Edit on a row populates the form with that row', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok(sampleConnections);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    const labelCell = await screen.findByText('SAP Dev');
    const row = labelCell.closest('tr') ?? labelCell.closest('row') ?? document.body;
    const editBtn = within(row as HTMLElement).getByText('Edit');
    await user.click(editBtn);
    expect(await screen.findByTitle('Edit connection')).toBeInTheDocument();
  });

  it('prefills the Description template with the engine default when adding a new connection', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('{{issue.key}} {{issue.fields.summary}}');
  });

  it('renders the Description template preview as soon as the form opens', async () => {
    invokeMock.mockImplementation(async (key: string, payload?: unknown) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.previewTemplate') {
        const p = payload as { template: string };
        return ok({ text: 'PRJ-1 Sample summary', length: p.template.length + 5, warnings: [], truncated: false });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    // useEffect should fire previewTemplate once the form mounts with the default.
    await waitFor(() => {
      const previewCall = invokeMock.mock.calls.find((c) => c[0] === 'project.previewTemplate');
      expect(previewCall).toBeDefined();
    });
    await screen.findByText(/Preview: "PRJ-1 Sample summary"/);
  });

  it('clears the connection-form preview when the template is emptied', async () => {
    invokeMock.mockImplementation(async (key: string, payload?: unknown) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.previewTemplate') {
        const p = payload as { template: string };
        return ok({ text: p.template, length: p.template.length, warnings: [], truncated: false });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    await user.clear(textarea);
    expect(textarea.value).toBe('');
    // Empty template → preview block disappears.
    await waitFor(() => expect(screen.queryByText(/Preview:/)).not.toBeInTheDocument());
  });

  it('renders the SmartValuesPicker trigger next to the Description template field', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    expect(screen.getByLabelText('Insert variable')).toBeInTheDocument();
  });

  it('inserting a token from the picker appends it to the Description template', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections.list'));
    await user.click(screen.getByText('+ Add connection'));
    await screen.findByTitle('New connection');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('{{issue.key}} {{issue.fields.summary}}');
    await user.click(screen.getByLabelText('Insert variable'));
    await user.click(screen.getByText('{{user.email}}'));
    // The new token is appended at the end with a separating space.
    expect(textarea.value).toBe('{{issue.key}} {{issue.fields.summary}} {{user.email}}');
  });
});
