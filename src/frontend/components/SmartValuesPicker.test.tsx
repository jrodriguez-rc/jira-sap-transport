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
    // Popup is the only @forge/react primitive whose default string-tag
    // rendering breaks the test (it never invokes the trigger/content render
    // props). Replace it with a thin component that mirrors the runtime:
    // trigger is always rendered, content only when isOpen.
    Popup: ({
      trigger,
      content,
      isOpen,
    }: {
      trigger: (props?: unknown) => React.ReactNode;
      content: () => React.ReactNode;
      isOpen: boolean;
    }) => (
      <>
        {trigger({})}
        {isOpen ? <div data-testid="popup-content">{content()}</div> : null}
      </>
    ),
    // Textfield needs DOM semantics so the search box reacts to userEvent.type.
    // Use a forwardRef so any future react-hook-form integration still works.
    Textfield: React.forwardRef<
      HTMLInputElement,
      React.InputHTMLAttributes<HTMLInputElement> & { 'aria-label'?: string }
    >((props, ref) => <input ref={ref} {...props} />),
  };
});

import { SmartValuesPicker, SMART_VALUES_CATEGORIES } from './SmartValuesPicker';

describe('SmartValuesPicker', () => {
  it('renders the trigger button', () => {
    render(<SmartValuesPicker onInsert={vi.fn()} />);
    expect(screen.getByLabelText('Insert variable')).toBeInTheDocument();
  });

  it('starts closed (popup content not rendered)', () => {
    render(<SmartValuesPicker onInsert={vi.fn()} />);
    expect(screen.queryByTestId('popup-content')).not.toBeInTheDocument();
    expect(screen.queryByText('{{issue.key}}')).not.toBeInTheDocument();
  });

  it('clicking the trigger opens the popup with categories, tokens and a search field', async () => {
    const user = userEvent.setup();
    render(<SmartValuesPicker onInsert={vi.fn()} />);
    await user.click(screen.getByLabelText('Insert variable'));
    // Popup content is mounted
    expect(screen.getByTestId('popup-content')).toBeInTheDocument();
    // Search field
    expect(screen.getByLabelText('Search variables')).toBeInTheDocument();
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
    expect(screen.queryByTestId('popup-content')).not.toBeInTheDocument();
  });

  it('typing into the search field filters tokens across categories', async () => {
    const user = userEvent.setup();
    render(<SmartValuesPicker onInsert={vi.fn()} />);
    await user.click(screen.getByLabelText('Insert variable'));
    await user.type(screen.getByLabelText('Search variables'), 'date');
    // Only Date category remains visible
    expect(screen.queryByText('Issue')).not.toBeInTheDocument();
    expect(screen.queryByText('Project')).not.toBeInTheDocument();
    expect(screen.queryByText('User')).not.toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('{{date.iso}}')).toBeInTheDocument();
  });

  it('shows a no-match message when the search has no results', async () => {
    const user = userEvent.setup();
    render(<SmartValuesPicker onInsert={vi.fn()} />);
    await user.click(screen.getByLabelText('Insert variable'));
    await user.type(screen.getByLabelText('Search variables'), 'xyzzy');
    expect(screen.getByText(/No variables match/i)).toBeInTheDocument();
  });

  it('clears the search query when the popup is closed by selection', async () => {
    const user = userEvent.setup();
    render(<SmartValuesPicker onInsert={vi.fn()} />);
    await user.click(screen.getByLabelText('Insert variable'));
    await user.type(screen.getByLabelText('Search variables'), 'issue');
    await user.click(screen.getByText('{{issue.key}}'));
    // Re-open: search field should be empty again, all categories visible.
    await user.click(screen.getByLabelText('Insert variable'));
    expect((screen.getByLabelText('Search variables') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Date')).toBeInTheDocument();
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
