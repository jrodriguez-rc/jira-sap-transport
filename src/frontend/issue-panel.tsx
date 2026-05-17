import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  ButtonGroup,
  DynamicTable,
  Heading,
  Inline,
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

const TYPE_LABELS: Record<TransportType, string> = {
  K: 'Workbench',
  W: 'Customizing',
  T: 'Copy',
};

const App: React.FC = () => {
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
      const list = await invoke<SapTransportEntry[]>('issue.list', {
        issueKey: ctx.extension.issue.key,
      });
      setEntries(list);
    })();
  }, []);

  const reload = async (): Promise<void> => {
    const list = await invoke<SapTransportEntry[]>('issue.list', { issueKey });
    setEntries(list);
  };

  const onRelease = async (requestId: string): Promise<void> => {
    try {
      await invoke('issue.release', { projectId, issueKey, requestId });
      setMessage({ kind: 'success', text: `Released ${requestId}` });
      await reload();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const onRefresh = async (requestId: string): Promise<void> => {
    try {
      await invoke('issue.refresh', { projectId, issueKey, requestId });
      await reload();
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
      { key: 'request', content: <Text>{entry.requestId}</Text> },
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

const CreateDialog: React.FC<CreateDialogProps> = ({
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
      const r = await invoke<SapTransportEntry>('issue.create', {
        projectId,
        issueKey,
        type,
        descriptionOverride: override,
        target: target.length > 0 ? target : undefined,
      });
      await onDone(`Created ${r.requestId}`);
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

const LinkDialog: React.FC<LinkDialogProps> = ({
  projectId,
  issueKey,
  onClose,
  onDone,
  onError,
}) => {
  const [requestId, setRequestId] = useState<string>('');

  const submit = async (): Promise<void> => {
    try {
      const r = await invoke<SapTransportEntry>('issue.link', {
        projectId,
        issueKey,
        requestId,
      });
      await onDone(`Linked ${r.requestId}`);
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
