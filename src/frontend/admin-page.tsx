import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  Form,
  FormFooter,
  FormHeader,
  FormSection,
  Heading,
  Inline,
  Label,
  SectionMessage,
  Stack,
  Text,
  TextArea,
  Textfield,
  useForm,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { SmartValuesPicker } from './components/SmartValuesPicker';

const DEFAULT_DESCRIPTION_TEMPLATE = '{{issue.key}} {{issue.fields.summary}}';

interface ConnPublic {
  id: string;
  label: string;
  hostname: string;
  client: string;
  username: string;
  descriptionTemplate?: string;
}

type EditingConn = Partial<ConnPublic & { password?: string }>;

type ResolverResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; severity?: string; target?: string; httpStatus?: number } };

export const App: React.FC = () => {
  const [items, setItems] = useState<ConnPublic[]>([]);
  const [editing, setEditing] = useState<EditingConn | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const reload = async (): Promise<void> => {
    const r = await invoke<ResolverResult<ConnPublic[]>>('connections.list');
    if (r.ok) {
      setItems(r.data);
    } else {
      setItems([]);
      setMessage({ kind: 'error', text: r.error.message });
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const onSave = async (values: Record<string, string>): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<unknown>>('connections.save', { ...editing, ...values });
      if (r.ok) {
        setMessage({ kind: 'success', text: 'Saved' });
        setEditing(null);
        await reload();
      } else {
        setMessage({ kind: 'error', text: r.error.message });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const onDelete = async (id: string): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<unknown>>('connections.delete', { id });
      if (r.ok) {
        await reload();
      } else {
        setMessage({ kind: 'error', text: r.error.message });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  // connections.test is intentionally NOT wrapped in bridgeSafe — it already
  // returns its own { ok, error? } Result-like shape from testConnection().
  const onTest = async (values: Record<string, string>): Promise<void> => {
    try {
      const res = await invoke<{ ok: boolean; error?: { message: string } }>(
        'connections.test',
        values,
      );
      setMessage(
        res.ok
          ? { kind: 'success', text: 'Connection OK' }
          : { kind: 'error', text: res.error?.message ?? 'Failed' },
      );
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  // Test a stored connection by id — server-side loads the password,
  // so the secret never round-trips through the frontend.
  const onTestById = async (id: string): Promise<void> => {
    try {
      const res = await invoke<{ ok: boolean; error?: { message: string } }>(
        'connections.test',
        { id },
      );
      setMessage(
        res.ok
          ? { kind: 'success', text: 'Connection OK' }
          : { kind: 'error', text: res.error?.message ?? 'Failed' },
      );
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const head = {
    cells: [
      { key: 'label', content: 'Label' },
      { key: 'hostname', content: 'Hostname' },
      { key: 'client', content: 'Client' },
      { key: 'username', content: 'User' },
      { key: 'actions', content: 'Actions' },
    ],
  };

  const rows = items.map((c) => ({
    key: c.id,
    cells: [
      { key: 'label', content: <Text>{c.label}</Text> },
      { key: 'hostname', content: <Text>{c.hostname}</Text> },
      { key: 'client', content: <Text>{c.client}</Text> },
      { key: 'username', content: <Text>{c.username}</Text> },
      {
        key: 'actions',
        content: (
          <Inline space="space.100">
            <Button onClick={() => setEditing(c)}>Edit</Button>
            <Button onClick={() => void onTestById(c.id)}>Test</Button>
            <Button appearance="danger" onClick={() => void onDelete(c.id)}>
              Delete
            </Button>
          </Inline>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.200">
      <Heading as="h1">SAP Connections</Heading>
      {message && (
        <SectionMessage appearance={message.kind === 'success' ? 'success' : 'error'}>
          <Text>{message.text}</Text>
        </SectionMessage>
      )}

      <DynamicTable head={head} rows={rows} />

      <Inline space="space.100">
        <Button onClick={() => setEditing({})}>+ Add connection</Button>
      </Inline>

      {editing && (
        <ConnectionForm
          initial={editing}
          onSubmit={onSave}
          onTest={onTest}
          onCancel={() => setEditing(null)}
        />
      )}
    </Stack>
  );
};

interface ConnectionFormProps {
  initial: EditingConn;
  onSubmit: (v: Record<string, string>) => Promise<void>;
  onTest: (v: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}

export const ConnectionForm: React.FC<ConnectionFormProps> = ({ initial, onSubmit, onTest, onCancel }) => {
  // Use defaultValues to seed the form. For new connections we prefill the
  // Description template with the engine default so admins can edit-from-default
  // rather than start with an empty field.
  const seededTemplate =
    (initial as { descriptionTemplate?: string }).descriptionTemplate ??
    (initial.id ? '' : DEFAULT_DESCRIPTION_TEMPLATE);
  const seeded: Record<string, string> = {
    ...(initial as Record<string, string>),
    descriptionTemplate: seededTemplate,
  };
  const { handleSubmit, register, getValues } = useForm<Record<string, string>>({
    defaultValues: seeded,
  });

  // Description template is held in component state as the single source of
  // truth so the SmartValuesPicker can append tokens. We do NOT register the
  // textarea with react-hook-form: doing so makes @forge/react's TextArea
  // ignore the controlled `value` on first render (the user sees an empty
  // field until they type and delete a character, at which point React
  // re-applies the controlled value). Instead we inject `template` into the
  // submitted values via a wrapper on handleSubmit.
  //
  // @forge/react's TextArea does not expose a DOM ref, so SmartValuesPicker
  // tokens are appended at the end of the current value rather than at the
  // caret position.
  const [template, setTemplate] = useState<string>(seededTemplate);

  const onPickToken = (tok: string): void => {
    setTemplate((prev) =>
      prev.length > 0 && !prev.endsWith(' ') ? prev + ' ' + tok : prev + tok,
    );
  };

  const submitWithTemplate = (values: Record<string, string>): Promise<void> =>
    onSubmit({ ...values, descriptionTemplate: template });

  const testWithTemplate = (): Promise<void> =>
    onTest({ ...getValues(), descriptionTemplate: template });

  return (
    <Box padding="space.200">
      <Form onSubmit={handleSubmit(submitWithTemplate)}>
        <FormHeader title={initial.id ? 'Edit connection' : 'New connection'} />
        <FormSection>
          <Label labelFor="label">Label</Label>
          <Textfield {...register('label', { required: true })} />
          <Label labelFor="hostname">Hostname (https URL)</Label>
          <Textfield
            placeholder="https://sap.example.com"
            {...register('hostname', { required: true })}
          />
          <Label labelFor="client">Client (3 digits)</Label>
          <Textfield {...register('client', { required: true })} />
          <Label labelFor="username">Username</Label>
          <Textfield {...register('username', { required: true })} />
          <Label labelFor="password">Password</Label>
          <Textfield type="password" {...register('password', { required: !initial.id })} />
          <Label labelFor="descriptionTemplate">Description template</Label>
          <Inline space="space.050">
            <SmartValuesPicker onInsert={onPickToken} />
          </Inline>
          <TextArea
            name="descriptionTemplate"
            value={template}
            onChange={(e) => setTemplate((e.target as { value?: string }).value ?? '')}
          />
        </FormSection>
        <FormFooter>
          <Inline space="space.100">
            <Button type="submit" appearance="primary">
              Save
            </Button>
            <Button onClick={() => void testWithTemplate()}>Test connection</Button>
            <Button onClick={onCancel}>Cancel</Button>
          </Inline>
        </FormFooter>
      </Form>
    </Box>
  );
};

ForgeReconciler.render(<App />);
