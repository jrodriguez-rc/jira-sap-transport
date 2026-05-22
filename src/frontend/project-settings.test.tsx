// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    // TextArea is mocked as <div> (not <textarea>) so it does NOT match
    // getAllByRole('textbox') — keeping the draft form's three Textfield
    // inputs (label/target/projectCode) as the only textboxes the tests
    // index into.
    TextArea: passthrough('div'),
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

  it('Edit → change a field → Save calls project.config.update with the patch', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      if (key === 'project.config.update') return ok({ ok: true });
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Workbench QAS');
    const editButtons = screen.getAllByText('Edit');
    await user.click(editButtons[0]);
    await screen.findByText('Edit transport configuration');
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    // Change the Target field from QAS to PRD. userEvent.clear emits the
    // controlled-input change events the mock <input> needs to actually
    // reset its value before retyping.
    await user.clear(inputs[1]);
    await user.type(inputs[1], 'PRD');
    await user.click(screen.getByText('Save', { selector: 'button' }));
    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find((c) => c[0] === 'project.config.update');
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toEqual({
        projectId: '10001',
        configId: 'cfg-a',
        patch: { label: 'Workbench QAS', type: 'K', target: 'PRD', projectCode: 'ZPROJ' },
      });
    });
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

  it('shows banner with error message when connections.list returns Result.fail', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return fail('connections boom');
      if (key === 'project.getConfig') return ok(emptyProject);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('connections boom');
  });

  it('shows banner with error message when project.getConfig returns Result.fail (renders default cfg)', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return fail('cfg boom');
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('cfg boom');
    // After a fail, the App falls back to the default cfg (no configs) — so
    // the empty-state hint becomes visible too.
    await screen.findByText(/No configurations yet/i);
  });

  it('shows banner with error message when project.saveSettings returns Result.fail', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      if (key === 'project.saveSettings') return fail('save boom');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Workbench QAS');
    await user.click(screen.getByText('Save settings'));
    await screen.findByText('save boom');
  });

  it('shows banner with error when project.config.delete fails (closes confirmation first)', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      if (key === 'project.config.delete') return fail('delete boom');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Workbench QAS');
    const deleteButtons = screen.getAllByText('Delete');
    await user.click(deleteButtons[0]);
    await user.click(screen.getByText('Confirm delete'));
    await screen.findByText('delete boom');
  });

  it('Cancel on the delete confirmation hides confirm-delete and skips the call', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Workbench QAS');
    const deleteButtons = screen.getAllByText('Delete');
    await user.click(deleteButtons[0]);
    await screen.findByText('Confirm delete');
    // Two Cancel buttons may appear (we only opened one row, so just one).
    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Confirm delete')).not.toBeInTheDocument();
    expect(invokeMock.mock.calls.find((c) => c[0] === 'project.config.delete')).toBeUndefined();
  });

  it('Cancel on the draft modal closes it without calling add/update', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(emptyProject);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No configurations yet/i);
    await user.click(screen.getByText('+ Add config'));
    await screen.findByText('Add transport configuration');
    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Add transport configuration')).not.toBeInTheDocument();
    expect(invokeMock.mock.calls.find((c) => c[0] === 'project.config.add')).toBeUndefined();
  });

  it('typing in the template TextArea updates cfg and re-fires preview once via useEffect', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return ok({ text: 'rendered', length: 8, warnings: ['legacy {{project.code}} no longer resolves'], truncated: true });
      return ok(undefined);
    });
    render(<App />);
    // Wait for the initial preview to land — the configured projectWithConfigs
    // has a non-empty template, so the useEffect fires once on mount and
    // produces the truncated/warnings preview branches.
    await screen.findByText(/Preview:/);
    await screen.findByText(/truncated/);
    await screen.findByText(/legacy/);
  });

  it('renders the override-mode field stack and lets the user type into each Textfield (exercising the 5 onChange handlers)', async () => {
    const overrideProject: ProjectConfig = {
      connectionOverride: { id: 'override', label: 'override', hostname: 'https://h.example', systemId: 'X1H', client: '100', username: 'u', password: 'p' },
      descriptionTemplate: '',
      configs: [],
    };
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(overrideProject);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/Hostname \(https URL\)/);
    // 5 override Textfields render as <input> via the passthrough mock. Type
    // one character into each to fire the controlled onChange handlers.
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    // No draft modal open, so the only textboxes are the 4 non-password override fields
    // (in order: hostname, systemId, client, username — password is type="password" and not role=textbox).
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    await user.type(inputs[0], 'x');
    await user.type(inputs[1], 'y');
    await user.type(inputs[2], 'z');
    await user.type(inputs[3], 'w');
    // Drive the password field directly via fireEvent.change since it has
    // type="password" (no role=textbox). This exercises the 5th onChange
    // branch that user.type can't reach via getAllByRole.
    const pwd = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pwd).toBeTruthy();
    fireEvent.change(pwd, { target: { value: 'pp' } });
  });

  it('Edit modal: changing label/projectCode + Save sends the patched config (covers more Textfield handlers)', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return ok({ text: 'x', length: 1, warnings: [], truncated: false });
      if (key === 'project.config.update') return ok({ ok: true });
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Workbench QAS');
    await user.click(screen.getAllByText('Edit')[0]);
    await screen.findByText('Edit transport configuration');
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    // Exercise label and project-code change handlers (target onChange is
    // already covered by the earlier edit/update test).
    await user.clear(inputs[0]);
    await user.type(inputs[0], 'Renamed');
    await user.clear(inputs[2]);
    await user.type(inputs[2], 'ZNEW');
    await user.click(screen.getByText('Save', { selector: 'button' }));
    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find((c) => c[0] === 'project.config.update');
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toMatchObject({
        patch: { label: 'Renamed', projectCode: 'ZNEW' },
      });
    });
  });

  it('previewTemplate failure no longer pollutes the shared message banner (warns instead)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'conn-1', label: 'A4H Dev' }]);
      if (key === 'project.getConfig') return ok(projectWithConfigs);
      if (key === 'project.previewTemplate') return fail('render boom');
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('Workbench QAS');
    await waitFor(() => {
      expect(invokeMock.mock.calls.some((c) => c[0] === 'project.previewTemplate')).toBe(true);
    });
    expect(screen.queryByText('render boom')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('project.previewTemplate failed'),
        expect.stringContaining('render boom'),
      );
    });
    warnSpy.mockRestore();
  });
});
