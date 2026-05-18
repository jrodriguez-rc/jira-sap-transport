// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// `@forge/bridge` throws at module load outside an Atlassian iframe. None of
// these configs actually call `invoke`/`view`, but the production bundle
// transitively pulls bridge in through `@forge/react`'s hooks. Stub it.
vi.mock('@forge/bridge', () => ({
  invoke: vi.fn(),
  view: { getContext: vi.fn(async () => ({})) },
  events: { on: vi.fn(), once: vi.fn(), emit: vi.fn() },
}));

// Stub ForgeReconciler.render so the module-level `ForgeReconciler.render(<Config />)`
// call at the bottom of each tsx is a no-op. Keep all named exports intact so
// the components themselves render normally as plain string tags in the DOM.
vi.mock('@forge/react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, default: { render: vi.fn(), addConfig: vi.fn() } };
});

import { Config as CreateConfig } from './automation-create-config';
import { Config as LinkConfig } from './automation-link-config';
import { Config as ReleaseConfig } from './automation-release-config';

describe('automation-create-config', () => {
  it('renders the create rule field labels', () => {
    render(<CreateConfig />);
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Target (optional)')).toBeInTheDocument();
    expect(screen.getByText('Description override (smart value)')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });
});

describe('automation-link-config', () => {
  it('renders the link rule field labels', () => {
    render(<LinkConfig />);
    expect(screen.getByText('Request id')).toBeInTheDocument();
  });
});

describe('automation-release-config', () => {
  it('renders the release rule field labels', () => {
    render(<ReleaseConfig />);
    expect(screen.getByText('Mode')).toBeInTheDocument();
    expect(screen.getByText('Request id (only for "By id")')).toBeInTheDocument();
    expect(screen.getByText('Only type (for "All linked")')).toBeInTheDocument();
  });
});
