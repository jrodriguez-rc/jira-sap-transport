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
  Textfield,
  useForm,
} from '@forge/react';
import { invoke } from '@forge/bridge';

interface ConnPublic {
  id: string;
  label: string;
  hostname: string;
  client: string;
  username: string;
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
  const { handleSubmit, register, getValues } = useForm<Record<string, string>>({
    defaultValues: initial as Record<string, string>,
  });

  return (
    <Box padding="space.200">
      <Form onSubmit={handleSubmit(onSubmit)}>
        <FormHeader title={initial.id ? 'Edit connection' : 'New connection'} />
        <FormSection>
          <Label labelFor="label">Label</Label>
          <Textfield {...register('label', { required: true })} />
          <Label labelFor="hostname">Hostname (https URL)</Label>
          <Textfield {...register('hostname', { required: true })} />
          <Label labelFor="client">Client (3 digits)</Label>
          <Textfield {...register('client', { required: true })} />
          <Label labelFor="username">Username</Label>
          <Textfield {...register('username', { required: true })} />
          <Label labelFor="password">Password</Label>
          <Textfield type="password" {...register('password', { required: !initial.id })} />
        </FormSection>
        <FormFooter>
          <Inline space="space.100">
            <Button type="submit" appearance="primary">
              Save
            </Button>
            <Button onClick={() => void onTest(getValues())}>Test connection</Button>
            <Button onClick={onCancel}>Cancel</Button>
          </Inline>
        </FormFooter>
      </Form>
    </Box>
  );
};

ForgeReconciler.render(<App />);
