// Placeholder project-settings page during the multi-config refactor.
// Backend (Task 1) has landed; the full UI rewrite arrives in Task 2.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Stack, Text } from '@forge/react';
import { invoke, view } from '@forge/bridge';
import type { ProjectConfig } from '../lib/types';

type ResolverResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; severity?: string; target?: string; httpStatus?: number } };

export const App: React.FC = () => {
  const [cfg, setCfg] = useState<ProjectConfig | null>(null);

  useEffect(() => {
    void (async () => {
      const ctx = (await view.getContext()) as unknown as { extension: { project: { id: string } } };
      const c = await invoke<ResolverResult<ProjectConfig | undefined>>('project.getConfig', {
        projectId: ctx.extension.project.id,
      });
      const cfgValue = c.ok ? c.data : undefined;
      setCfg(
        cfgValue ?? {
          connectionId: undefined,
          connectionOverride: undefined,
          descriptionTemplate: '',
          configs: [],
        },
      );
    })();
  }, []);

  if (!cfg) return <Text>Loading…</Text>;

  return (
    <Stack space="space.200">
      <Heading as="h1">SAP Transport — Project Settings</Heading>
      <Text>Multi-config UI is being rewritten — please check back after the next deploy.</Text>
      <Text>Configurations defined: {cfg.configs.length}</Text>
    </Stack>
  );
};

ForgeReconciler.render(<App />);
