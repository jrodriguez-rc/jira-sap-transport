import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  ButtonGroup,
  DynamicTable,
  Heading,
  Inline,
  Link,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';
import type { SapTransportEntry, TransportType } from '../lib/types';

interface IssueContext {
  extension: {
    project: { id: string };
    issue: { key: string };
  };
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
  const [issueKey, setIssueKey] = useState<string>('');
  const [entries, setEntries] = useState<SapTransportEntry[]>([]);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState<TransportType | null>(null);
  const [linkOpen, setLinkOpen] = useState<boolean>(false);

  useEffect(() => {
    void (async () => {
      const ctx = (await view.getContext()) as unknown as IssueContext;
      setProjectId(ctx.extension.project.id);
      setIssueKey(ctx.extension.issue.key);
      const r = await invoke<ResolverResult<SapTransportEntry[]>>('issue.list', {
        issueKey: ctx.extension.issue.key,
      });
      setEntries(r.ok ? r.data : []);
      if (!r.ok) setMessage({ kind: 'error', text: r.error.message });
    })();
  }, []);

  const reload = async (): Promise<void> => {
    const r = await invoke<ResolverResult<SapTransportEntry[]>>('issue.list', { issueKey });
    setEntries(r.ok ? r.data : []);
    if (!r.ok) setMessage({ kind: 'error', text: r.error.message });
  };

  const onRelease = async (requestId: string): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<unknown>>('issue.release', { projectId, issueKey, requestId });
      if (r.ok) {
        setMessage({ kind: 'success', text: `Released ${requestId}` });
        await reload();
      } else {
        setMessage({ kind: 'error', text: r.error.message });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const onRefresh = async (requestId: string): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<unknown>>('issue.refresh', { projectId, issueKey, requestId });
      if (r.ok) {
        await reload();
      } else {
        setMessage({ kind: 'error', text: r.error.message });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const head = {
    cells: [
      { key: 'request', content: 'Request' },
      { key: 'type', content: 'Type' },
      { key: 'description', content: 'Description' },
      { key: 'status', content: 'Status' },
      { key: 'actions', content: 'Actions' },
    ],
  };

  const rows = entries.map((entry) => ({
    key: entry.requestId,
    cells: [
      {
        key: 'request',
        content: entry.systemId ? (
          <Link href={`adt://${entry.systemId}/sap/bc/adt/cts/transportrequests/${entry.requestId}`}>
            {entry.requestId}
          </Link>
        ) : (
          <Text>{entry.requestId}</Text>
        ),
      },
      { key: 'type', content: <Text>{TYPE_LABELS[entry.type]}</Text> },
      { key: 'description', content: <Text>{entry.description}</Text> },
      { key: 'status', content: <Text>{entry.statusText}</Text> },
      {
        key: 'actions',
        content: (
          <Inline space="space.100">
            <Button onClick={() => void onRefresh(entry.requestId)}>Refresh</Button>
            {entry.status !== 'R' && (
              <Button appearance="primary" onClick={() => void onRelease(entry.requestId)}>
                Release
              </Button>
            )}
          </Inline>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.200">
      <Heading as="h2">SAP Transport</Heading>
      {message && (
        <SectionMessage appearance={message.kind === 'success' ? 'success' : 'error'}>
          <Text>{message.text}</Text>
        </SectionMessage>
      )}

      <DynamicTable head={head} rows={rows} emptyView={<Text>No transports linked to this issue.</Text>} />

      <Inline space="space.100">
        <ButtonGroup>
          <Button onClick={() => setCreateOpen('K')}>+ Workbench</Button>
          <Button onClick={() => setCreateOpen('W')}>+ Customizing</Button>
          <Button onClick={() => setCreateOpen('T')}>+ Copy</Button>
        </ButtonGroup>
        <Button onClick={() => setLinkOpen(true)}>Link existing</Button>
      </Inline>

      <ModalTransition>
        {createOpen && (
          <CreateDialog
            type={createOpen}
            projectId={projectId}
            issueKey={issueKey}
            onClose={() => setCreateOpen(null)}
            onDone={async (msg) => {
              setMessage({ kind: 'success', text: msg });
              setCreateOpen(null);
              await reload();
            }}
            onError={(msg) => setMessage({ kind: 'error', text: msg })}
          />
        )}
      </ModalTransition>

      <ModalTransition>
        {linkOpen && (
          <LinkDialog
            projectId={projectId}
            issueKey={issueKey}
            onClose={() => setLinkOpen(false)}
            onDone={async (msg) => {
              setMessage({ kind: 'success', text: msg });
              setLinkOpen(false);
              await reload();
            }}
            onError={(msg) => setMessage({ kind: 'error', text: msg })}
          />
        )}
      </ModalTransition>
    </Stack>
  );
};

interface CreateDialogProps {
  type: TransportType;
  projectId: string;
  issueKey: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}

export const CreateDialog: React.FC<CreateDialogProps> = ({
  type,
  projectId,
  issueKey,
  onClose,
  onDone,
  onError,
}) => {
  const [override, setOverride] = useState<string>('');
  const [target, setTarget] = useState<string>('');

  const submit = async (): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<SapTransportEntry>>('issue.create', {
        projectId,
        issueKey,
        type,
        descriptionOverride: override,
        target: target.length > 0 ? target : undefined,
      });
      if (r.ok) {
        await onDone(`Created ${r.data.requestId}`);
      } else {
        onError(r.error.message);
      }
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>Create {TYPE_LABELS[type]} transport</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.100">
          <Text>Description override (optional, falls back to project template)</Text>
          <Textfield
            value={override}
            onChange={(e) => setOverride((e.target as { value?: string }).value ?? '')}
          />
          <Text>Target system (optional, falls back to project default)</Text>
          <Textfield
            value={target}
            onChange={(e) => setTarget((e.target as { value?: string }).value ?? '')}
          />
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Inline space="space.100">
          <Button appearance="primary" onClick={() => void submit()}>
            Create
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </Inline>
      </ModalFooter>
    </Modal>
  );
};

interface LinkDialogProps {
  projectId: string;
  issueKey: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}

export const LinkDialog: React.FC<LinkDialogProps> = ({
  projectId,
  issueKey,
  onClose,
  onDone,
  onError,
}) => {
  const [requestId, setRequestId] = useState<string>('');

  const submit = async (): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<SapTransportEntry>>('issue.link', {
        projectId,
        issueKey,
        requestId,
      });
      if (r.ok) {
        await onDone(`Linked ${r.data.requestId}`);
      } else {
        onError(r.error.message);
      }
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>Link existing transport</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.100">
          <Text>Transport request ID</Text>
          <Textfield
            value={requestId}
            placeholder="DEVK900123"
            onChange={(e) => setRequestId((e.target as { value?: string }).value ?? '')}
          />
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Inline space="space.100">
          <Button appearance="primary" onClick={() => void submit()}>
            Link
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </Inline>
      </ModalFooter>
    </Modal>
  );
};

ForgeReconciler.render(<App />);
