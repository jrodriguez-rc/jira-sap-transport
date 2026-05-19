// src/frontend/components/SmartValuesPicker.tsx
//
// Compact "{ }" trigger button that opens a categorised list of supported
// template tokens. Clicking a token calls `onInsert("{{path}}")` so the
// parent decides where/how to splice it into the underlying TextArea.
//
// Implementation note: `@forge/react`'s TextArea does not expose a DOM ref,
// so the parent typically appends the token at the end of the current value
// rather than at the caret position. The component itself is unaware of
// that limitation — it just emits tokens.

import React, { useState } from 'react';
import { Box, Button, Heading, Inline, Stack, Text } from '@forge/react';

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

export const SmartValuesPicker: React.FC<SmartValuesPickerProps> = ({ onInsert }) => {
  const [open, setOpen] = useState<boolean>(false);

  const handleInsert = (path: string): void => {
    onInsert('{{' + path + '}}');
    setOpen(false);
  };

  return (
    <Stack space="space.050">
      <Inline space="space.050">
        <Button
          appearance="subtle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Insert variable"
        >
          {'{ }'}
        </Button>
      </Inline>
      {open && (
        <Box padding="space.100">
          <Stack space="space.100">
            {SMART_VALUES_CATEGORIES.map((cat) => (
              <Stack key={cat.name} space="space.050">
                <Heading as="h4">{cat.name}</Heading>
                <Stack space="space.025">
                  {cat.tokens.map((tok) => (
                    <Button
                      key={tok}
                      appearance="subtle"
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
    </Stack>
  );
};
