// src/frontend/components/SmartValuesPicker.tsx
//
// Floating popover, triggered by a compact "{ }" button. Opens a searchable
// list of supported template tokens grouped by category. Clicking a token
// calls `onInsert("{{path}}")` so the parent decides where/how to splice it
// into the underlying TextArea.
//
// Implementation notes:
//
// - Uses `Popup` from `@forge/react`, which renders the content as a
//   positioned overlay (not inline), so the textarea below the trigger stays
//   in place — unlike the previous inline-expand implementation.
//
// - `@forge/react`'s `TextArea` does not expose a DOM ref, so the parent
//   appends the token at the end of the current value rather than at the
//   caret position. The component itself is unaware of that limitation.

import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Heading,
  Popup,
  Stack,
  Text,
  Textfield,
} from '@forge/react';

export interface SmartValuesPickerProps {
  onInsert: (token: string) => void;
}

export interface TokenCategory {
  name: string;
  tokens: string[];
}

export const SMART_VALUES_CATEGORIES: TokenCategory[] = [
  {
    name: 'Issue',
    tokens: [
      'issue.key',
      'issue.fields.summary',
      'issue.fields.issuetype.name',
      'issue.fields.reporter.displayName',
    ],
  },
  {
    name: 'Project',
    tokens: ['project.code', 'project.key', 'project.name'],
  },
  {
    name: 'User',
    tokens: ['user.email', 'user.displayName', 'user.accountId'],
  },
  {
    name: 'Date',
    tokens: ['date.iso', 'date.year', 'date.month'],
  },
];

function filterCategories(query: string): TokenCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return SMART_VALUES_CATEGORIES;
  return SMART_VALUES_CATEGORIES.map((cat) => ({
    ...cat,
    tokens: cat.tokens.filter((tok) => tok.toLowerCase().includes(q)),
  })).filter((cat) => cat.tokens.length > 0);
}

export const SmartValuesPicker: React.FC<SmartValuesPickerProps> = ({ onInsert }) => {
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');

  const close = (): void => {
    setOpen(false);
    setQuery('');
  };

  const handleInsert = (path: string): void => {
    onInsert('{{' + path + '}}');
    close();
  };

  const filtered = useMemo(() => filterCategories(query), [query]);

  return (
    <Popup
      isOpen={open}
      onClose={close}
      placement="bottom-start"
      trigger={() => (
        <Button
          appearance="subtle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Insert variable"
        >
          {'{ }'}
        </Button>
      )}
      content={() => (
        <Box padding="space.150">
          <Stack space="space.100">
            <Textfield
              value={query}
              onChange={(e) => setQuery((e.target as { value?: string }).value ?? '')}
              placeholder="Search variables..."
              aria-label="Search variables"
            />
            {filtered.length === 0 && (
              <Text>No variables match "{query}".</Text>
            )}
            {filtered.map((cat) => (
              <Stack key={cat.name} space="space.050">
                <Heading as="h6">{cat.name}</Heading>
                <Stack space="space.025">
                  {cat.tokens.map((tok) => (
                    <Button
                      key={tok}
                      appearance="subtle"
                      shouldFitContainer
                      onClick={() => handleInsert(tok)}
                    >
                      <Text>{'{{' + tok + '}}'}</Text>
                    </Button>
                  ))}
                </Stack>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
    />
  );
};
