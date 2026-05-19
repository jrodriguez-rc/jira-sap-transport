// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@forge/bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  view: {
    getContext: vi.fn(async () => ({ extension: { project: { id: '10001' } } })),
  },
  events: { on: vi.fn(), once: vi.fn(), emit: vi.fn() },
}));

// project-settings.tsx uses controlled `<Textfield value={…} onChange={…}>`
// and `<TextArea value={…} onChange={…}>`. The default string-tag rendering
// is non-interactive, so swap in real `<input>` / `<textarea>` so user-event
// fires real onChange events. RadioGroup is also mocked so we can switch the
// connection mode programmatically.
vi.mock('@forge/react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const React = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Textfield = React.forwardRef<HTMLInputElement, any>((props, ref) => (
    <input ref={ref} {...props} />
  ));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TextArea = React.forwardRef<HTMLTextAreaElement, any>((props, ref) => (
    <textarea ref={ref} {...props} />
  ));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Select = ({ value, options, onChange }: any) => (
    <select
      data-testid="forge-select"
      value={value?.value ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        const opt = options.find((o: { value: string }) => o.value === v);
        onChange(opt ?? null);
      }}
    >
      <option value="" disabled>
        select…
      </option>
      {options.map((o: { value: string; label: string }) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RadioGroup = ({ value, options, onChange, name }: any) => (
    <div data-testid={`radiogroup-${name}`}>
      {options.map((o: { value: string; label: string }) => (
        <label key={o.value}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange({ target: { value: o.value } })}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
  return {
    ...actual,
    Textfield,
    TextArea,
    RadioGroup,
    Select,
    default: { render: vi.fn(), addConfig: vi.fn() },
  };
});

import { App } from './project-settings';

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message: string, code = 'ERR') => ({
  ok: false as const,
  error: { code, message, severity: 'error' },
});

beforeEach(() => {
  invokeMock.mockReset();
});

describe('project-settings App', () => {
  it('loads existing config via project.getConfig and prefills fields', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([{ id: 'sap-dev', label: 'SAP Dev' }]);
      if (key === 'project.getConfig') {
        return ok({
          connectionId: 'sap-dev',
          projectCode: 'PROJ',
          descriptionTemplate: '{{issue.key}}',
          defaults: { type: 'K' as const, target: 'PRD' },
        });
      }
      return ok(undefined);
    });
    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('project.getConfig', { projectId: '10001' }));
    await screen.findByDisplayValue('PROJ');
    expect(screen.getByDisplayValue('{{issue.key}}')).toBeInTheDocument();
    expect(screen.getByDisplayValue('PRD')).toBeInTheDocument();
  });

  it('falls back to an empty config when project.getConfig has no data', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') return ok(undefined);
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('SAP Transport — Project Settings');
  });

  it('prefills the Description template with the engine default when no project config exists', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') return ok(undefined);
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('SAP Transport — Project Settings');
    expect(
      screen.getByDisplayValue('{{issue.key}} {{issue.fields.summary}}'),
    ).toBeInTheDocument();
  });

  it('toggling the radio to Override reveals the hostname/client/username/password form', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    const overrideRadio = screen.getByLabelText('Override') as HTMLInputElement;
    expect(overrideRadio.checked).toBe(false);
    await user.click(overrideRadio);
    await screen.findByText('Hostname (https URL)');
    expect(screen.getByText('Client (3 digits)')).toBeInTheDocument();
    expect(screen.getByText('Username')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
  });

  it('editing the description template triggers project.previewTemplate and shows the preview text', async () => {
    invokeMock.mockImplementation(async (key: string, payload?: unknown) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      if (key === 'project.previewTemplate') {
        const tpl = (payload as { template: string }).template;
        return ok({
          text: `Preview: ${tpl}`,
          length: tpl.length,
          warnings: [],
          truncated: false,
        });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    const textareas = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    expect(textareas.length).toBeGreaterThanOrEqual(1);
    await user.type(textareas[0], 'X');
    await waitFor(() => {
      const previewCall = invokeMock.mock.calls.find((c) => c[0] === 'project.previewTemplate');
      expect(previewCall).toBeDefined();
    });
    await screen.findByText(/Preview: "Preview: X"/);
  });

  it('clicking Save calls project.saveConfig with the current cfg', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      if (key === 'project.saveConfig') return ok(undefined);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    await user.click(screen.getByText('Save'));
    await waitFor(() => {
      const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'project.saveConfig');
      expect(saveCall).toBeDefined();
      expect(saveCall![1]).toMatchObject({ projectId: '10001' });
    });
    await screen.findByText('Saved');
  });

  it('shows an error when project.saveConfig returns Result.fail', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      if (key === 'project.saveConfig') return fail('save denied');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    await user.click(screen.getByText('Save'));
    await screen.findByText('save denied');
  });

  it('surfaces a connections.list error in the message banner', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return fail('no connections');
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('no connections');
  });

  it('typing into override client/username/password updates the inline form', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    await user.click(screen.getByLabelText('Override'));
    await screen.findByText('Hostname (https URL)');
    // After toggling to override, four textbox inputs appear (hostname, client,
    // username, project code/default target also exist) plus a password input.
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    // inputs (in render order): [hostname, client, username, project code, default target]
    const hostnameInput = inputs[0];
    const clientInput = inputs[1];
    const usernameInput = inputs[2];
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(hostnameInput, 'https://my.sap');
    await user.type(clientInput, '100');
    await user.type(usernameInput, 'jdoe');
    await user.type(passwordInput, 'pw');
    expect(hostnameInput.value).toBe('https://my.sap');
    expect(clientInput.value).toBe('100');
    expect(usernameInput.value).toBe('jdoe');
    expect(passwordInput.value).toBe('pw');
  });

  it('typing into the default target Textfield updates the value', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const, target: 'OLD' },
        });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    // The default target Textfield prefills with 'OLD'; query it by display value
    // so we know we're typing into the right input.
    const targetInput = (await screen.findByDisplayValue('OLD')) as HTMLInputElement;
    await user.type(targetInput, 'X');
    await waitFor(() => expect(targetInput.value).toBe('OLDX'));
  });

  it('shows preview warnings on a template that emits them', async () => {
    invokeMock.mockImplementation(async (key: string, payload?: unknown) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      if (key === 'project.previewTemplate') {
        const tpl = (payload as { template: string }).template;
        return ok({
          text: tpl,
          length: tpl.length,
          warnings: ['unknown {{token}}'],
          truncated: true,
        });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    const textareas = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    await user.type(textareas[0], '{{token}}');
    await screen.findByText(/truncated/);
    await screen.findByText(/unknown/);
  });

  it('surfaces a preview error from project.previewTemplate', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      if (key === 'project.previewTemplate') return fail('template syntax');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    const textareas = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    await user.type(textareas[0], 'X');
    await screen.findByText('template syntax');
  });

  it('surfaces a project.getConfig error in the message banner and falls back to defaults', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') return fail('config fetch failed');
      return ok(undefined);
    });
    render(<App />);
    await screen.findByText('config fetch failed');
  });

  it('falls back to the connectionId text when the connection label is missing', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]); // no connections at all
      if (key === 'project.getConfig') {
        return ok({
          // Reference an id that is not in the connections list — the Select
          // should show the id as the value's label.
          connectionId: 'orphaned-id',
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      return ok(undefined);
    });
    render(<App />);
    await screen.findByDisplayValue('PROJ');
  });

  it('toggling override back to catalog clears the connection override', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
          connectionOverride: {
            id: 'override',
            label: 'override',
            hostname: 'https://existing.sap.example',
            client: '100',
            username: 'usr-existing',
            password: 'p',
          },
        });
      }
      if (key === 'project.saveConfig') return ok(undefined);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('usr-existing');
    await user.click(screen.getByLabelText('From catalog'));
    // After toggling back the override panel should disappear.
    await waitFor(() => {
      expect(screen.queryByDisplayValue('usr-existing')).not.toBeInTheDocument();
    });
    await user.click(screen.getByText('Save'));
    await waitFor(() => {
      const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'project.saveConfig');
      const payload = saveCall![1] as { config: { connectionOverride?: unknown } };
      expect(payload.config.connectionOverride).toBeUndefined();
    });
  });

  it('changing the connection-id Select updates the connectionId in config', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list')
        return ok([
          { id: 'sap-a', label: 'A' },
          { id: 'sap-b', label: 'B' },
        ]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      if (key === 'project.saveConfig') return ok(undefined);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    // Two selects render in catalog mode: the connection-id select and the
    // default-type select. The connection-id one is first.
    const selects = screen.getAllByTestId('forge-select');
    await user.selectOptions(selects[0], 'sap-b');
    await user.click(screen.getByText('Save'));
    await waitFor(() => {
      const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'project.saveConfig');
      expect(saveCall).toBeDefined();
      const payload = saveCall![1] as { config: { connectionId?: string } };
      expect(payload.config.connectionId).toBe('sap-b');
    });
  });

  it('changing the default-type Select updates the defaults.type in config', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      if (key === 'project.saveConfig') return ok(undefined);
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    // With no connections, the connection-id Select still renders. The
    // default-type Select is the second one.
    const selects = screen.getAllByTestId('forge-select');
    await user.selectOptions(selects[selects.length - 1], 'W');
    await user.click(screen.getByText('Save'));
    await waitFor(() => {
      const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'project.saveConfig');
      expect(saveCall).toBeDefined();
      const payload = saveCall![1] as { config: { defaults: { type: string } } };
      expect(payload.config.defaults.type).toBe('W');
    });
  });

  it('shows an error when project.saveConfig throws synchronously', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      if (key === 'project.saveConfig') throw new Error('boom');
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    await user.click(screen.getByText('Save'));
    await screen.findByText('boom');
  });

  it('renders the SmartValuesPicker trigger next to the Description template field', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      return ok(undefined);
    });
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    expect(screen.getByLabelText('Insert variable')).toBeInTheDocument();
  });

  it('inserting a token from the picker appends it to the Description template', async () => {
    invokeMock.mockImplementation(async (key: string, payload?: unknown) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'PROJ',
          descriptionTemplate: 'PRE',
          defaults: { type: 'K' as const },
        });
      }
      if (key === 'project.previewTemplate') {
        const tpl = (payload as { template: string }).template;
        return ok({ text: tpl, length: tpl.length, warnings: [], truncated: false });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByDisplayValue('PROJ');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('PRE');
    await user.click(screen.getByLabelText('Insert variable'));
    await user.click(screen.getByText('{{project.key}}'));
    await waitFor(() => expect(textarea.value).toBe('PRE {{project.key}}'));
  });

  it('updating the project code reflects in the input', async () => {
    invokeMock.mockImplementation(async (key: string) => {
      if (key === 'connections.list') return ok([]);
      if (key === 'project.getConfig') {
        return ok({
          projectCode: 'AAA',
          descriptionTemplate: '',
          defaults: { type: 'K' as const },
        });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    render(<App />);
    const codeInput = (await screen.findByDisplayValue('AAA')) as HTMLInputElement;
    await user.type(codeInput, 'B');
    await waitFor(() => expect(codeInput.value).toBe('AAAB'));
  });
});
