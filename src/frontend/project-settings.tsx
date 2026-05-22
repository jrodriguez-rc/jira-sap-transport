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
    // Preview is a transient nicety — don't pollute the shared top-of-page
    // banner with a failure here (that surface is reserved for the
    // load/save errors that block the user). Worst case the preview just
    // doesn't update; the user keeps typing.
    else console.warn('project.previewTemplate failed:', r.error.message);
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
            // No eager onPreview here — the useEffect on
            // [cfg?.descriptionTemplate] picks it up. Previously this
            // double-fired previewTemplate on every keystroke.
          }}
        />
      </Inline>
      <TextArea
        value={cfg.descriptionTemplate}
        onChange={(e) => {
          const next = (e.target as { value?: string }).value ?? '';
          setCfg({ ...cfg, descriptionTemplate: next });
          // No eager onPreview here either — see SmartValuesPicker above.
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
