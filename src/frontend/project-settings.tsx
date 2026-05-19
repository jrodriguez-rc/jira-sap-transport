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
import type { ProjectConfig, RenderResult, TransportType } from '../lib/types';

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

export const App: React.FC = () => {
  const [projectId, setProjectId] = useState<string>('');
  const [connections, setConnections] = useState<ConnPublic[]>([]);
  const [cfg, setCfg] = useState<ProjectConfig | null>(null);
  const [preview, setPreview] = useState<RenderResult | null>(null);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    void (async () => {
      const ctx = (await view.getContext()) as unknown as {
        extension: { project: { id: string } };
      };
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
          projectCode: '',
          descriptionTemplate: '',
          defaults: { type: 'K' },
        },
      );
    })();
  }, []);

  const onPreview = async (template: string): Promise<void> => {
    const r = await invoke<ResolverResult<RenderResult>>('project.previewTemplate', {
      template,
      sampleContext: {
        issue: {
          key: `${cfg?.projectCode ?? 'PRJ'}-1`,
          fields: { summary: 'Sample summary' },
        },
      },
    });
    if (r.ok) {
      setPreview(r.data);
    } else {
      setMessage(r.error.message);
    }
  };

  const onSave = async (): Promise<void> => {
    if (!cfg) return;
    try {
      const r = await invoke<ResolverResult<unknown>>('project.saveConfig', { projectId, config: cfg });
      setMessage(r.ok ? 'Saved' : r.error.message);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  if (!cfg) return <Text>Loading…</Text>;

  const typeOptions: SelectOption[] = [
    { label: 'Workbench', value: 'K' },
    { label: 'Customizing', value: 'W' },
    { label: 'Copy', value: 'T' },
  ];

  return (
    <Stack space="space.200">
      <Heading as="h1">SAP Transport — Project Settings</Heading>
      {message && (
        <SectionMessage>
          <Text>{message}</Text>
        </SectionMessage>
      )}

      <Label labelFor="connection-mode">SAP Connection</Label>
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
                ? {
                    id: 'override',
                    label: 'override',
                    hostname: '',
                    client: '',
                    username: '',
                    password: '',
                  }
                : undefined,
          });
        }}
      />
      {!cfg.connectionOverride && (
        <Select
          options={connections.map((c) => ({ label: c.label, value: c.id }))}
          value={
            cfg.connectionId
              ? {
                  label:
                    connections.find((c) => c.id === cfg.connectionId)?.label ??
                    cfg.connectionId,
                  value: cfg.connectionId,
                }
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
              setCfg({
                ...cfg,
                connectionOverride: {
                  ...cfg.connectionOverride!,
                  hostname: (e.target as { value?: string }).value ?? '',
                },
              })
            }
          />
          <Label labelFor="ov-client">Client (3 digits)</Label>
          <Textfield
            value={cfg.connectionOverride.client}
            onChange={(e) =>
              setCfg({
                ...cfg,
                connectionOverride: {
                  ...cfg.connectionOverride!,
                  client: (e.target as { value?: string }).value ?? '',
                },
              })
            }
          />
          <Label labelFor="ov-username">Username</Label>
          <Textfield
            value={cfg.connectionOverride.username}
            onChange={(e) =>
              setCfg({
                ...cfg,
                connectionOverride: {
                  ...cfg.connectionOverride!,
                  username: (e.target as { value?: string }).value ?? '',
                },
              })
            }
          />
          <Label labelFor="ov-password">Password</Label>
          <Textfield
            type="password"
            value={cfg.connectionOverride.password}
            onChange={(e) =>
              setCfg({
                ...cfg,
                connectionOverride: {
                  ...cfg.connectionOverride!,
                  password: (e.target as { value?: string }).value ?? '',
                },
              })
            }
          />
        </Stack>
      )}

      <Label labelFor="project-code">Project code</Label>
      <Textfield
        value={cfg.projectCode}
        onChange={(e) =>
          setCfg({
            ...cfg,
            projectCode: (e.target as { value?: string }).value ?? '',
          })
        }
      />

      <Label labelFor="default-type">Default type</Label>
      <Select
        options={typeOptions}
        value={{
          label: TYPE_LABELS[cfg.defaults.type],
          value: cfg.defaults.type,
        }}
        onChange={(opt) => {
          const o = opt as SelectOption | null;
          setCfg({
            ...cfg,
            defaults: {
              ...cfg.defaults,
              type: (o?.value ?? 'K') as TransportType,
            },
          });
        }}
      />

      <Label labelFor="default-target">Default target</Label>
      <Textfield
        value={cfg.defaults.target ?? ''}
        onChange={(e) =>
          setCfg({
            ...cfg,
            defaults: {
              ...cfg.defaults,
              target: (e.target as { value?: string }).value ?? '',
            },
          })
        }
      />

      <Label labelFor="description-template">Description template</Label>
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
            Preview: "{preview.text}" ({preview.length}/60
            {preview.truncated ? ' — truncated' : ''})
          </Text>
          {preview.warnings.map((w) => (
            <Text key={w}>⚠ {w}</Text>
          ))}
        </Box>
      )}

      <Inline space="space.100">
        <Button appearance="primary" onClick={() => void onSave()}>
          Save
        </Button>
      </Inline>
    </Stack>
  );
};

ForgeReconciler.render(<App />);
