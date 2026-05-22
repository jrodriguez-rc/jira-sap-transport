import React, { useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import DynamicTable from '@atlaskit/dynamic-table';
import Heading from '@atlaskit/heading';
import Modal, {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
} from '@atlaskit/modal-dialog';
import SectionMessage from '@atlaskit/section-message';
import Textfield from '@atlaskit/textfield';
import { invoke, router, view } from '@forge/bridge';
// router.open() is the documented way to open external URLs from a Custom
// UI iframe — https://developer.atlassian.com/platform/forge/custom-ui-bridge/router/
// It opens a new window and surfaces Atlassian's "open external link"
// prompt to the user. Every navigation path in the Custom UI iframe
// (router.open, router.navigate, plain <a>, window.open) ultimately calls
// window.open() under the hood, so all of them require the sandbox to
// carry `allow-popups`. Forge only appends that directive when the
// manifest declares `permissions.external.fetch.client: - address: '*'`
// — see the manifest comment.
import type { ProjectConfig, SapTransportEntry, TransportConfig, TransportType } from './types';

interface IssueContext {
  extension: {
    project: { id: string };
    issue: { key: string };
  };
}

type ResolverResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        severity?: string;
        target?: string;
        httpStatus?: number;
      };
    };

const TYPE_LABELS: Record<TransportType, string> = {
  K: 'Workbench',
  W: 'Customizing',
  T: 'Copy',
};

const buildAdtUrl = (systemId: string, requestId: string): string =>
  `adt://${systemId}/sap/bc/adt/cts/transportrequests/${requestId}`;

export const App: React.FC = () => {
  const [projectId, setProjectId] = useState<string>('');
  const [issueKey, setIssueKey] = useState<string>('');
  const [entries, setEntries] = useState<SapTransportEntry[]>([]);
  const [configs, setConfigs] = useState<TransportConfig[]>([]);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [createFor, setCreateFor] = useState<TransportConfig | null>(null);
  const [linkOpen, setLinkOpen] = useState<boolean>(false);

  useEffect(() => {
    void (async () => {
      try {
        const ctx = (await view.getContext()) as unknown as IssueContext;
        setProjectId(ctx.extension.project.id);
        setIssueKey(ctx.extension.issue.key);
        const [list, project] = await Promise.all([
          invoke<ResolverResult<SapTransportEntry[]>>('issue.list', {
            issueKey: ctx.extension.issue.key,
          }),
          invoke<ResolverResult<ProjectConfig | undefined>>('project.getConfig', {
            projectId: ctx.extension.project.id,
          }),
        ]);
        setEntries(list.ok ? list.data : []);
        if (!list.ok) setMessage({ kind: 'error', text: list.error.message });
        setConfigs(project.ok && project.data ? project.data.configs : []);
      } catch (e) {
        // Without this, a synchronous reject from view.getContext() or
        // either invoke() leaves the panel empty with no visible error.
        // Same pattern used by onRelease/onRefresh below.
        setMessage({ kind: 'error', text: (e as Error).message });
      }
    })();
  }, []);

  const reload = async (): Promise<void> => {
    const r = await invoke<ResolverResult<SapTransportEntry[]>>('issue.list', { issueKey });
    setEntries(r.ok ? r.data : []);
    if (!r.ok) setMessage({ kind: 'error', text: r.error.message });
  };

  const onOpenAdt = async (entry: SapTransportEntry): Promise<void> => {
    if (!entry.systemId) return;
    const url = buildAdtUrl(entry.systemId, entry.requestId);
    try {
      await router.open(url);
    } catch (e) {
      // router.open() rejects when the user declines Atlassian's
      // external-link prompt.
      setMessage({
        kind: 'error',
        text: `Could not open ADT link: ${(e as Error).message}`,
      });
    }
  };

  const onRelease = async (requestId: string): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<unknown>>('issue.release', {
        projectId,
        issueKey,
        requestId,
      });
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
      const r = await invoke<ResolverResult<unknown>>('issue.refresh', {
        projectId,
        issueKey,
        requestId,
      });
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
          <Button
            appearance="subtle"
            spacing="compact"
            onClick={() => {
              void onOpenAdt(entry);
            }}
          >
            {entry.requestId}
          </Button>
        ) : (
          <span>{entry.requestId}</span>
        ),
      },
      { key: 'type', content: <span>{TYPE_LABELS[entry.type]}</span> },
      { key: 'description', content: <span>{entry.description}</span> },
      { key: 'status', content: <span>{entry.statusText}</span> },
      {
        key: 'actions',
        content: (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => void onRefresh(entry.requestId)}>Refresh</Button>
            {entry.status !== 'R' && (
              <Button appearance="primary" onClick={() => void onRelease(entry.requestId)}>
                Release
              </Button>
            )}
          </div>
        ),
      },
    ],
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 8 }}>
      <Heading size="medium">SAP Transport</Heading>
      {message && (
        <SectionMessage appearance={message.kind === 'success' ? 'success' : 'error'}>
          <p>{message.text}</p>
        </SectionMessage>
      )}

      <DynamicTable
        head={head}
        rows={rows}
        emptyView={<span>No transports linked to this issue.</span>}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {configs.map((c) => (
          <Button key={c.id} onClick={() => setCreateFor(c)}>{`+ ${c.label}`}</Button>
        ))}
        <Button onClick={() => setLinkOpen(true)}>Link existing</Button>
      </div>
      {configs.length === 0 && (
        <SectionMessage appearance="information">
          <p>Ask a project admin to add a transport configuration in project settings before creating new requests.</p>
        </SectionMessage>
      )}

      <small style={{ color: '#626f86' }}>
        Opening a Request ID requires SAP ADT (Eclipse) installed locally.
      </small>

      <ModalTransition>
        {createFor && (
          <CreateDialog
            config={createFor}
            projectId={projectId}
            issueKey={issueKey}
            onClose={() => setCreateFor(null)}
            onDone={async (msg) => {
              setMessage({ kind: 'success', text: msg });
              setCreateFor(null);
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
    </div>
  );
};

interface CreateDialogProps {
  config: TransportConfig;
  projectId: string;
  issueKey: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}

export const CreateDialog: React.FC<CreateDialogProps> = ({
  config,
  projectId,
  issueKey,
  onClose,
  onDone,
  onError,
}) => {
  const [override, setOverride] = useState<string>('');

  const submit = async (): Promise<void> => {
    try {
      const r = await invoke<ResolverResult<SapTransportEntry>>('issue.create', {
        projectId,
        issueKey,
        configId: config.id,
        descriptionOverride: override,
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
        <ModalTitle>Create {config.label}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>Description override (optional, falls back to project template)</label>
          <Textfield
            value={override}
            onChange={(e) => setOverride((e.target as HTMLInputElement).value)}
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="primary" onClick={() => void submit()}>
          Create
        </Button>
        <Button onClick={onClose}>Cancel</Button>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>Transport request ID</label>
          <Textfield
            value={requestId}
            placeholder="DEVK900123"
            onChange={(e) => setRequestId((e.target as HTMLInputElement).value)}
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="primary" onClick={() => void submit()}>
          Link
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </ModalFooter>
    </Modal>
  );
};
