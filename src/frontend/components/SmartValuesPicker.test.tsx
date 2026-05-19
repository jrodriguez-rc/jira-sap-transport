// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@forge/react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    default: { render: vi.fn(), addConfig: vi.fn() },
  };
});

import { SmartValuesPicker, SMART_VALUES_CATEGORIES } from './SmartValuesPicker';

describe('SmartValuesPicker', () => {
  it('renders the trigger button', () => {
    render(<SmartValuesPicker onInsert={vi.fn()} />);
    expect(screen.getByLabelText('Insert variable')).toBeInTheDocument();
  });

  it('starts collapsed (no token labels visible)', () => {
    render(<SmartValuesPicker onInsert={vi.fn()} />);
    expect(screen.queryByText('{{issue.key}}')).not.toBeInTheDocument();
  });

  it('clicking the trigger opens the popup with categories and tokens', async () => {
    const user = userEvent.setup();
    render(<SmartValuesPicker onInsert={vi.fn()} />);
    await user.click(screen.getByLabelText('Insert variable'));
    // Categories
    expect(screen.getByText('Issue')).toBeInTheDocument();
    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
    // A sample token from each category
    expect(screen.getByText('{{issue.key}}')).toBeInTheDocument();
    expect(screen.getByText('{{project.code}}')).toBeInTheDocument();
    expect(screen.getByText('{{user.email}}')).toBeInTheDocument();
    expect(screen.getByText('{{date.iso}}')).toBeInTheDocument();
  });

  it('clicking a token calls onInsert with the {{path}} form and closes the popup', async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    render(<SmartValuesPicker onInsert={onInsert} />);
    await user.click(screen.getByLabelText('Insert variable'));
    await user.click(screen.getByText('{{issue.fields.summary}}'));
    expect(onInsert).toHaveBeenCalledWith('{{issue.fields.summary}}');
    // Popup is closed afterwards.
    expect(screen.queryByText('{{date.iso}}')).not.toBeInTheDocument();
  });

  it('exposes the full catalogue of categories and tokens', () => {
    const allTokens = SMART_VALUES_CATEGORIES.flatMap((c) => c.tokens);
    expect(allTokens).toContain('issue.key');
    expect(allTokens).toContain('issue.fields.summary');
    expect(allTokens).toContain('issue.fields.issuetype.name');
    expect(allTokens).toContain('issue.fields.reporter.displayName');
    expect(allTokens).toContain('project.code');
    expect(allTokens).toContain('project.key');
    expect(allTokens).toContain('project.name');
    expect(allTokens).toContain('user.email');
    expect(allTokens).toContain('user.displayName');
    expect(allTokens).toContain('user.accountId');
    expect(allTokens).toContain('date.iso');
    expect(allTokens).toContain('date.year');
    expect(allTokens).toContain('date.month');
  });
});
