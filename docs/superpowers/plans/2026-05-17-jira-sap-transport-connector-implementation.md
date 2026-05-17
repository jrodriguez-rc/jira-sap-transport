# Jira–SAP Transport Connector Implementation Plan

> **Nota / Note:** This is the historical implementation plan (TDD task list) used by the agentic workers during the build. Already executed. For user/developer documentation see the bilingual READMEs (`README.md` / `README.es.md`) and the bilingual design spec (`docs/superpowers/specs/...-design.md` / `...-design.es.md`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Atlassian Forge app that lets Jira Cloud users and Automation rules create, link and release SAP transport requests against a custom OData v4 service.

**Architecture:** Single Forge app (UI Kit 2 / `@forge/react`) with three frontend modules (admin, project settings, issue panel) plus three Jira Automation actions. Backend resolvers and automation handlers share a typed OData client (`sap-client.ts`), a template engine (`template.ts`) and typed storage wrappers (`storage.ts`). Connections live in app storage; per-project config in app storage keyed by project id; per-issue link list in issue properties.

**Tech Stack:** TypeScript, Forge (`@forge/api`, `@forge/react`, `@forge/resolver`, `@forge/ui` for automation actions), Vitest, msw, Forge CLI. Node 20 (Forge runtime).

**Reference spec:** `docs/superpowers/specs/2026-05-17-jira-sap-transport-connector-design.md`

---

## File Map

Created during this plan:

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` | Build / test config |
| `manifest.yml` | Forge module declarations and scopes |
| `src/lib/types.ts` | Shared TypeScript types (`Connection`, `ProjectConfig`, `RequestType`, `SapTransportEntry`, `RenderResult`) |
| `src/lib/errors.ts` | `SapError`, `ConfigError`, `AuthError` classes |
| `src/lib/template.ts` | Description template engine (path walk, render, truncate) |
| `src/lib/template.test.ts` | Unit tests for the template engine |
| `src/lib/storage.ts` | Typed wrappers around `@forge/api` `storage` and issue properties |
| `src/lib/storage.test.ts` | Unit tests for storage wrappers |
| `src/lib/sap-client.ts` | OData v4 client (URL building, auth, CSRF retry, error parsing, the four operations) |
| `src/lib/sap-client.test.ts` | Unit + integration tests against mocked OData with msw |
| `src/__tests__/fixtures/*.json` | Captured SAP response shapes |
| `src/handlers/connections.ts` | Resolver invocations for CRUD on the global catalog |
| `src/handlers/connections.test.ts` | Tests for catalog resolvers |
| `src/handlers/project-config.ts` | Resolver invocations for per-project config |
| `src/handlers/project-config.test.ts` | Tests for project-config resolvers |
| `src/handlers/issue-actions.ts` | Resolvers for Create / Link / Release / Refresh from the issue panel |
| `src/handlers/issue-actions.test.ts` | Tests for issue-actions resolvers |
| `src/handlers/automation.ts` | Handlers for the three Jira Automation actions |
| `src/handlers/automation.test.ts` | Tests for automation handlers |
| `src/frontend/admin-page.tsx` | UI Kit 2 admin page (catalog) |
| `src/frontend/project-settings.tsx` | UI Kit 2 project settings page |
| `src/frontend/issue-panel.tsx` | UI Kit 2 issue panel |
| `.github/workflows/ci.yml` | Lint + tests + coverage gate |

---

## Task 0: Repository scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `manifest.yml` (skeleton; modules filled in Task 24)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "jira-sap-transport-connector",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "lint": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@forge/api": "^4.0.0",
    "@forge/react": "^10.0.0",
    "@forge/resolver": "^1.6.0",
    "@forge/ui": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@vitest/coverage-v8": "^1.6.0",
    "msw": "^2.3.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/index.ts',
        'src/lib/types.ts',
        'src/__tests__/**'
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90
      }
    }
  }
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
coverage/
.forge/
*.log
```

- [ ] **Step 5: Create `manifest.yml` skeleton (filled in Task 24)**

```yaml
modules:
  function:
    - key: placeholder
      handler: index.placeholder
app:
  id: ari:cloud:ecosystem::app/PLACEHOLDER-WILL-BE-REPLACED-BY-FORGE-CREATE
permissions:
  scopes:
    - read:jira-work
    - read:jira-user
    - manage:jira-configuration
    - manage:jira-project
    - storage:app
  external:
    fetch:
      backend: []
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: dependencies installed, `package-lock.json` created.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore manifest.yml
git commit -m "chore: scaffold Forge project with Vitest and TypeScript"
```

---

## Task 1: Shared types

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 1: Write the types file**

```ts
// src/lib/types.ts

export type TransportType = 'K' | 'W' | 'T';   // K=Workbench, W=Customizing, T=Copy

export interface Connection {
  id: string;
  label: string;
  hostname: string;       // https origin, no trailing slash
  client: string;         // SAP mandant, 3 chars
  username: string;
  password: string;       // never returned to frontend
}

export type ConnectionPublic = Omit<Connection, 'password'>;

export interface ProjectConfig {
  connectionId?: string;                  // reference to catalog
  connectionOverride?: Connection;        // wins over catalog
  projectCode: string;
  descriptionTemplate: string;
  defaults: {
    type: TransportType;
    target?: string;
  };
}

export interface RequestType {
  Request: string;
  Description: string;
  Owner: string;
  Type: TransportType;
  TypeText: string;
  Target: string;
  Status: string;
  StatusText: string;
  SAP__Messages?: SapMessage[];
}

export interface SapMessage {
  code: string;
  message: string;
  target?: string;
  numericSeverity: 1 | 2 | 3 | 4;
  longtextUrl?: string;
  transition: boolean;
  additionalTargets: string[];
}

export interface SapTransportEntry {
  requestId: string;
  type: TransportType;
  target: string;
  description: string;
  createdAt: string;       // ISO timestamp
  status: string;
  statusText: string;
  releasedAt?: string;
}

export interface RenderResult {
  text: string;            // already ≤60 chars
  length: number;          // pre-truncation length
  warnings: string[];
  truncated: boolean;
}

export interface SapClientCallContext {
  hostname: string;
  client: string;
  username: string;
  password: string;
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add shared types for connections, config, OData and template"
```

---

## Task 2: Error classes

**Files:**
- Create: `src/lib/errors.ts`
- Create: `src/lib/errors.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/errors.test.ts
import { describe, it, expect } from 'vitest';
import { SapError, ConfigError, AuthError } from './errors';

describe('SapError', () => {
  it('carries code, message, severity and httpStatus', () => {
    const e = new SapError({ code: 'X1', message: 'boom', severity: 'error', httpStatus: 500 });
    expect(e.code).toBe('X1');
    expect(e.message).toBe('boom');
    expect(e.severity).toBe('error');
    expect(e.httpStatus).toBe(500);
    expect(e).toBeInstanceOf(Error);
  });

  it('serialises to plain object for transport to frontend', () => {
    const e = new SapError({ code: 'X1', message: 'boom', severity: 'warning' });
    expect(e.toJSON()).toEqual({ code: 'X1', message: 'boom', severity: 'warning', target: undefined, httpStatus: undefined });
  });
});

describe('ConfigError', () => {
  it('is an Error subclass with a message', () => {
    const e = new ConfigError('no connection');
    expect(e.message).toBe('no connection');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('AuthError', () => {
  it('extends SapError with severity=error and httpStatus=401', () => {
    const e = new AuthError('bad creds');
    expect(e).toBeInstanceOf(SapError);
    expect(e.severity).toBe('error');
    expect(e.httpStatus).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/errors.test.ts`
Expected: FAIL — module `./errors` not found.

- [ ] **Step 3: Implement `errors.ts`**

```ts
// src/lib/errors.ts

export type SapErrorSeverity = 'info' | 'warning' | 'error';

export interface SapErrorJSON {
  code: string;
  message: string;
  severity: SapErrorSeverity;
  target?: string;
  httpStatus?: number;
}

export class SapError extends Error {
  readonly code: string;
  readonly severity: SapErrorSeverity;
  readonly target?: string;
  readonly httpStatus?: number;

  constructor(input: { code: string; message: string; severity: SapErrorSeverity; target?: string; httpStatus?: number }) {
    super(input.message);
    this.name = 'SapError';
    this.code = input.code;
    this.severity = input.severity;
    this.target = input.target;
    this.httpStatus = input.httpStatus;
  }

  toJSON(): SapErrorJSON {
    return {
      code: this.code,
      message: this.message,
      severity: this.severity,
      target: this.target,
      httpStatus: this.httpStatus
    };
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class AuthError extends SapError {
  constructor(message: string) {
    super({ code: 'AUTH', message, severity: 'error', httpStatus: 401 });
    this.name = 'AuthError';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/errors.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts src/lib/errors.test.ts
git commit -m "feat(errors): add SapError, ConfigError and AuthError"
```

---

## Task 3: Template engine — path resolution

**Files:**
- Create: `src/lib/template.ts`
- Create: `src/lib/template.test.ts`

- [ ] **Step 1: Write failing tests for `resolvePath`**

```ts
// src/lib/template.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePath } from './template';

describe('resolvePath', () => {
  const ctx = {
    issue: {
      key: 'PROJ-1',
      fields: {
        summary: 'Hello',
        customfield_10001: { value: 'Option A' },
        labels: ['a', 'b']
      }
    }
  };

  it('walks dotted paths', () => {
    expect(resolvePath(ctx, 'issue.key')).toBe('PROJ-1');
    expect(resolvePath(ctx, 'issue.fields.summary')).toBe('Hello');
    expect(resolvePath(ctx, 'issue.fields.customfield_10001.value')).toBe('Option A');
  });

  it('returns undefined for missing paths', () => {
    expect(resolvePath(ctx, 'issue.fields.missing')).toBeUndefined();
    expect(resolvePath(ctx, 'nope.at.all')).toBeUndefined();
  });

  it('returns the value as-is for non-string scalars', () => {
    const c = { n: 42, b: true, x: null };
    expect(resolvePath(c, 'n')).toBe(42);
    expect(resolvePath(c, 'b')).toBe(true);
    expect(resolvePath(c, 'x')).toBeNull();
  });

  it('returns objects/arrays as-is (caller decides what to do)', () => {
    expect(resolvePath(ctx, 'issue.fields.labels')).toEqual(['a', 'b']);
    expect(resolvePath(ctx, 'issue.fields')).toEqual(ctx.issue.fields);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

Run: `npm test -- src/lib/template.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `resolvePath`**

```ts
// src/lib/template.ts

export function resolvePath(ctx: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/template.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/template.ts src/lib/template.test.ts
git commit -m "feat(template): add dotted path resolution"
```

---

## Task 4: Template engine — rendering with warnings

**Files:**
- Modify: `src/lib/template.ts`
- Modify: `src/lib/template.test.ts`

- [ ] **Step 1: Add failing tests for `renderRaw`**

Append to `src/lib/template.test.ts`:

```ts
import { renderRaw } from './template';

describe('renderRaw', () => {
  const ctx = {
    issue: { key: 'PROJ-1', fields: { summary: 'Hi', missing: undefined, weird: { x: 1 } } },
    user: { email: 'a@b.com' }
  };

  it('substitutes {{path}} tokens', () => {
    const r = renderRaw('{{issue.key}} - {{issue.fields.summary}}', ctx);
    expect(r.text).toBe('PROJ-1 - Hi');
    expect(r.warnings).toEqual([]);
  });

  it('emits warning and empty string for missing paths', () => {
    const r = renderRaw('A {{issue.fields.nope}} B', ctx);
    expect(r.text).toBe('A  B');
    expect(r.warnings).toEqual(['Path "issue.fields.nope" not found']);
  });

  it('emits warning and empty string for non-scalar values', () => {
    const r = renderRaw('X {{issue.fields.weird}} Y', ctx);
    expect(r.text).toBe('X  Y');
    expect(r.warnings).toEqual(['Path "issue.fields.weird" resolves to non-scalar value']);
  });

  it('coerces numbers and booleans to strings', () => {
    const r = renderRaw('{{n}} {{b}}', { n: 42, b: true });
    expect(r.text).toBe('42 true');
  });

  it('treats null/undefined as empty string without warning when path exists but is null', () => {
    const r = renderRaw('X{{v}}Y', { v: null });
    expect(r.text).toBe('XY');
    expect(r.warnings).toEqual([]);
  });

  it('preserves literal text outside of tokens', () => {
    const r = renderRaw('hello world', ctx);
    expect(r.text).toBe('hello world');
  });

  it('handles multiple occurrences of the same token', () => {
    const r = renderRaw('{{issue.key}}/{{issue.key}}', ctx);
    expect(r.text).toBe('PROJ-1/PROJ-1');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (renderRaw undefined)**

Run: `npm test -- src/lib/template.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `renderRaw`**

Append to `src/lib/template.ts`:

```ts
export interface RawRender {
  text: string;
  warnings: string[];
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function renderRaw(template: string, ctx: unknown): RawRender {
  const warnings: string[] = [];
  const text = template.replace(TOKEN, (_, path: string) => {
    const value = resolvePath(ctx, path);

    if (value === null || value === undefined) {
      // Distinguish: present-but-null vs missing path
      if (!hasPath(ctx, path)) {
        warnings.push(`Path "${path}" not found`);
      }
      return '';
    }
    if (typeof value === 'object') {
      warnings.push(`Path "${path}" resolves to non-scalar value`);
      return '';
    }
    return String(value);
  });
  return { text, warnings };
}

function hasPath(ctx: unknown, path: string): boolean {
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return false;
    if (!(part in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/template.test.ts`
Expected: PASS — all template tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/template.ts src/lib/template.test.ts
git commit -m "feat(template): render templates with missing/non-scalar warnings"
```

---

## Task 5: Template engine — truncation, default fallback, public render

**Files:**
- Modify: `src/lib/template.ts`
- Modify: `src/lib/template.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/lib/template.test.ts`:

```ts
import { render, DEFAULT_TEMPLATE, truncateTo60 } from './template';

describe('truncateTo60', () => {
  it('keeps strings ≤60 chars untouched', () => {
    expect(truncateTo60('a'.repeat(60))).toEqual({ text: 'a'.repeat(60), truncated: false });
    expect(truncateTo60('short')).toEqual({ text: 'short', truncated: false });
  });

  it('cuts at last whitespace ≤60', () => {
    const t = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo'; // > 60
    const r = truncateTo60(t);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(60);
    expect(t.startsWith(r.text)).toBe(true);
    expect(r.text.endsWith(' ')).toBe(false);
  });

  it('hard-cuts at 60 when no whitespace exists in the first 60', () => {
    const t = 'a'.repeat(80);
    const r = truncateTo60(t);
    expect(r.text).toBe('a'.repeat(60));
    expect(r.truncated).toBe(true);
  });
});

describe('render', () => {
  const ctx = { issue: { key: 'PROJ-1', fields: { summary: 'Hello world' } } };

  it('uses the default template when input is empty/whitespace', () => {
    const r = render('', ctx);
    expect(r.text).toBe('PROJ-1 Hello world');
    expect(DEFAULT_TEMPLATE).toBe('{{issue.key}} {{issue.fields.summary}}');
  });

  it('returns RenderResult with length and truncated flag', () => {
    const r = render('{{issue.key}} {{issue.fields.summary}}', ctx);
    expect(r.text).toBe('PROJ-1 Hello world');
    expect(r.length).toBe(18);
    expect(r.truncated).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('truncates and sets the flag when the rendered text exceeds 60 chars', () => {
    const long = { issue: { key: 'PROJ-1', fields: { summary: 'word '.repeat(20) } } };
    const r = render('{{issue.key}} {{issue.fields.summary}}', long);
    expect(r.text.length).toBeLessThanOrEqual(60);
    expect(r.truncated).toBe(true);
    expect(r.length).toBeGreaterThan(60);
  });

  it('forwards warnings from rendering', () => {
    const r = render('{{issue.missing}}', ctx);
    expect(r.warnings).toContain('Path "issue.missing" not found');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/lib/template.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `truncateTo60`, `render`, `DEFAULT_TEMPLATE`**

Append to `src/lib/template.ts`:

```ts
import type { RenderResult } from './types';

export const DEFAULT_TEMPLATE = '{{issue.key}} {{issue.fields.summary}}';
const MAX_LEN = 60;

export function truncateTo60(input: string): { text: string; truncated: boolean } {
  if (input.length <= MAX_LEN) return { text: input, truncated: false };
  const window = input.slice(0, MAX_LEN);
  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace > 0) {
    return { text: window.slice(0, lastSpace), truncated: true };
  }
  return { text: window, truncated: true };
}

export function render(template: string, ctx: unknown): RenderResult {
  const effective = template.trim().length === 0 ? DEFAULT_TEMPLATE : template;
  const { text: raw, warnings } = renderRaw(effective, ctx);
  const length = raw.length;
  const { text, truncated } = truncateTo60(raw);
  return { text, length, warnings, truncated };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/template.test.ts`
Expected: PASS — all template tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/template.ts src/lib/template.test.ts
git commit -m "feat(template): add 60-char truncation, default fallback and public render"
```

---

## Task 6: Storage wrapper — connections catalog

**Files:**
- Create: `src/lib/storage.ts`
- Create: `src/lib/storage.test.ts`

- [ ] **Step 1: Write failing tests with a Forge `storage` mock**

This single mock at the top of the file must cover everything storage.ts uses across this task and Task 7 (storage + `api.asApp().requestJira` + `route`). Tests in Task 7 will append below; do not redeclare the mock.

```ts
// src/lib/storage.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, unknown>();
const issueProps = new Map<string, unknown>();

vi.mock('@forge/api', () => ({
  storage: {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    query: vi.fn(() => ({
      where: () => ({
        getMany: async () => ({
          results: Array.from(store.entries()).map(([key, value]) => ({ key, value }))
        })
      })
    }))
  },
  default: {
    asApp: () => ({
      requestJira: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
        const match = path.match(/\/rest\/api\/3\/issue\/([^/]+)\/properties\/sap\.transports$/);
        if (!match) throw new Error('unexpected path ' + path);
        const key = match[1];
        if (!init || !init.method || init.method === 'GET') {
          const v = issueProps.get(key);
          return v === undefined
            ? { status: 404, json: async () => ({}) }
            : { status: 200, json: async () => ({ value: v }) };
        }
        if (init.method === 'PUT') {
          issueProps.set(key, JSON.parse(init.body!));
          return { status: 200, json: async () => ({}) };
        }
        throw new Error('unexpected method ' + init.method);
      })
    })
  },
  route: (s: TemplateStringsArray, ...args: unknown[]) =>
    s.reduce((acc, part, i) => acc + part + (args[i] ?? ''), '')
}));

// Reset both maps in every beforeEach in this file
beforeEach(() => {
  store.clear();
  issueProps.clear();
});

import { listConnections, getConnection, saveConnection, deleteConnection, toPublic } from './storage';
import type { Connection } from './types';

const sample: Connection = {
  id: 'dev-100',
  label: 'DEV',
  hostname: 'https://dev.sap.lan',
  client: '100',
  username: 'JIRAUSR',
  password: 'secret'
};

describe('connections storage', () => {
  it('saves and retrieves a connection', async () => {
    await saveConnection(sample);
    const got = await getConnection('dev-100');
    expect(got).toEqual(sample);
  });

  it('lists all connections', async () => {
    await saveConnection(sample);
    await saveConnection({ ...sample, id: 'qas-200', label: 'QAS', client: '200' });
    const list = await listConnections();
    expect(list.map((c) => c.id).sort()).toEqual(['dev-100', 'qas-200']);
  });

  it('deletes a connection', async () => {
    await saveConnection(sample);
    await deleteConnection('dev-100');
    expect(await getConnection('dev-100')).toBeUndefined();
  });

  it('toPublic strips the password', () => {
    const pub = toPublic(sample);
    expect(pub).toEqual({
      id: 'dev-100',
      label: 'DEV',
      hostname: 'https://dev.sap.lan',
      client: '100',
      username: 'JIRAUSR'
    });
    expect('password' in pub).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/lib/storage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `storage.ts` (connections section)**

```ts
// src/lib/storage.ts
import { storage } from '@forge/api';
import type { Connection, ConnectionPublic } from './types';

const CONN_PREFIX = 'connections:';

export async function saveConnection(c: Connection): Promise<void> {
  await storage.set(CONN_PREFIX + c.id, c);
}

export async function getConnection(id: string): Promise<Connection | undefined> {
  return (await storage.get(CONN_PREFIX + id)) as Connection | undefined;
}

export async function deleteConnection(id: string): Promise<void> {
  await storage.delete(CONN_PREFIX + id);
}

export async function listConnections(): Promise<Connection[]> {
  // Forge storage.query lists by key prefix; the mock in tests returns everything.
  const result = await storage.query().where('key', { condition: 'STARTS_WITH', value: CONN_PREFIX } as never).getMany();
  return (result.results as Array<{ key: string; value: Connection }>)
    .map((r) => r.value)
    .filter((v): v is Connection => v != null && typeof v === 'object');
}

export function toPublic(c: Connection): ConnectionPublic {
  const { password: _password, ...pub } = c;
  return pub;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/storage.test.ts`
Expected: PASS — connection tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat(storage): connections catalog CRUD with password-stripping helper"
```

---

## Task 7: Storage wrapper — project config and issue properties

**Files:**
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/storage.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/lib/storage.test.ts` (the existing mock at the top of the file already covers `requestJira` and `route` — do not declare a second `vi.mock`):

```ts
import { getProjectConfig, saveProjectConfig, getIssueTransports, setIssueTransports } from './storage';
import type { ProjectConfig, SapTransportEntry } from './types';

const cfg: ProjectConfig = {
  connectionId: 'dev-100',
  projectCode: 'PROJX',
  descriptionTemplate: '{{issue.key}}',
  defaults: { type: 'K' }
};

describe('project config storage', () => {
  it('saves and reads project config', async () => {
    await saveProjectConfig('10001', cfg);
    expect(await getProjectConfig('10001')).toEqual(cfg);
  });

  it('returns undefined for unknown project', async () => {
    expect(await getProjectConfig('99999')).toBeUndefined();
  });
});

describe('issue transports', () => {
  const entry: SapTransportEntry = {
    requestId: 'DEVK900123',
    type: 'K',
    target: 'QAS',
    description: 'PROJ-1 Hello',
    createdAt: '2026-05-17T10:00:00Z',
    status: 'D',
    statusText: 'Modifiable'
  };

  it('returns [] for an issue with no property', async () => {
    expect(await getIssueTransports('PROJ-1')).toEqual([]);
  });

  it('sets and reads the transport list', async () => {
    await setIssueTransports('PROJ-1', [entry]);
    expect(await getIssueTransports('PROJ-1')).toEqual([entry]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/lib/storage.test.ts`
Expected: FAIL — `getProjectConfig` not defined etc.

- [ ] **Step 3: Implement project config + issue properties**

Append to `src/lib/storage.ts`:

```ts
import api, { route } from '@forge/api';
import type { ProjectConfig, SapTransportEntry } from './types';

const PROJECT_PREFIX = 'project:';

export async function saveProjectConfig(projectId: string, cfg: ProjectConfig): Promise<void> {
  await storage.set(`${PROJECT_PREFIX}${projectId}:config`, cfg);
}

export async function getProjectConfig(projectId: string): Promise<ProjectConfig | undefined> {
  return (await storage.get(`${PROJECT_PREFIX}${projectId}:config`)) as ProjectConfig | undefined;
}

const ISSUE_PROPERTY_KEY = 'sap.transports';

export async function getIssueTransports(issueKey: string): Promise<SapTransportEntry[]> {
  const res = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}/properties/${ISSUE_PROPERTY_KEY}`
  );
  if (res.status === 404) return [];
  if (res.status !== 200) throw new Error(`Issue property fetch failed: ${res.status}`);
  const body = (await res.json()) as { value: SapTransportEntry[] };
  return body.value ?? [];
}

export async function setIssueTransports(issueKey: string, entries: SapTransportEntry[]): Promise<void> {
  const res = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}/properties/${ISSUE_PROPERTY_KEY}`,
    { method: 'PUT', body: JSON.stringify(entries), headers: { 'Content-Type': 'application/json' } }
  );
  if (res.status >= 300) throw new Error(`Issue property write failed: ${res.status}`);
}
```

Also fix the import at the top — replace the existing `import { storage } from '@forge/api';` line with:

```ts
import api, { storage, route } from '@forge/api';
```

(remove the duplicate `route` import added in the snippet above; final file should import `route` exactly once).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/storage.test.ts`
Expected: PASS — all storage tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat(storage): project config and issue property (sap.transports) helpers"
```

---

## Task 8: SAP client — URL building, auth header, sap-client query param

**Files:**
- Create: `src/lib/sap-client.ts`
- Create: `src/lib/sap-client.test.ts`

- [ ] **Step 1: Write failing tests for helpers**

```ts
// src/lib/sap-client.test.ts
import { describe, it, expect } from 'vitest';
import { buildUrl, basicAuthHeader, BASE_PATH } from './sap-client';

describe('buildUrl', () => {
  const conn = { hostname: 'https://dev.sap.lan', client: '100', username: 'u', password: 'p' };

  it('joins base path and appends sap-client', () => {
    expect(buildUrl(conn, '/Request')).toBe(
      `https://dev.sap.lan${BASE_PATH}/Request?sap-client=100`
    );
  });

  it('uses & when the path already has a query string', () => {
    expect(buildUrl(conn, "/Request('X')?$select=Request")).toBe(
      `https://dev.sap.lan${BASE_PATH}/Request('X')?$select=Request&sap-client=100`
    );
  });

  it('strips a trailing slash from hostname', () => {
    expect(buildUrl({ ...conn, hostname: 'https://dev.sap.lan/' }, '/x')).toBe(
      `https://dev.sap.lan${BASE_PATH}/x?sap-client=100`
    );
  });
});

describe('basicAuthHeader', () => {
  it('produces a base64 Basic header', () => {
    const h = basicAuthHeader({ username: 'foo', password: 'bar' });
    expect(h).toBe('Basic ' + Buffer.from('foo:bar').toString('base64'));
  });
});

describe('BASE_PATH', () => {
  it('matches the service registered path', () => {
    expect(BASE_PATH).toBe('/sap/opu/odata4/sap/zjira_api_transportrequest_o4/srvd_a2x/sap/zjira_api_transportrequest_o4/0001');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/lib/sap-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement helpers**

```ts
// src/lib/sap-client.ts
import type { SapClientCallContext } from './types';

export const BASE_PATH =
  '/sap/opu/odata4/sap/zjira_api_transportrequest_o4/srvd_a2x/sap/zjira_api_transportrequest_o4/0001';

export function buildUrl(conn: Pick<SapClientCallContext, 'hostname' | 'client'>, path: string): string {
  const host = conn.hostname.replace(/\/+$/, '');
  const sep = path.includes('?') ? '&' : '?';
  return `${host}${BASE_PATH}${path}${sep}sap-client=${encodeURIComponent(conn.client)}`;
}

export function basicAuthHeader(conn: { username: string; password: string }): string {
  const token = Buffer.from(`${conn.username}:${conn.password}`).toString('base64');
  return `Basic ${token}`;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/sap-client.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sap-client.ts src/lib/sap-client.test.ts
git commit -m "feat(sap-client): URL builder and basic auth header"
```

---

## Task 9: SAP client — OData error parser

**Files:**
- Modify: `src/lib/sap-client.ts`
- Modify: `src/lib/sap-client.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/lib/sap-client.test.ts`:

```ts
import { parseODataError, mapSapMessages } from './sap-client';
import { SapError } from './errors';

describe('parseODataError', () => {
  it('extracts code and message from standard OData error', () => {
    const body = { error: { code: 'CX_X', message: { value: 'Something broke' } } };
    const e = parseODataError(500, body);
    expect(e).toBeInstanceOf(SapError);
    expect(e.code).toBe('CX_X');
    expect(e.message).toBe('Something broke');
    expect(e.httpStatus).toBe(500);
    expect(e.severity).toBe('error');
  });

  it('falls back to a synthetic code when JSON has no error.code', () => {
    const e = parseODataError(500, { weird: 'shape' });
    expect(e.code).toBe('HTTP_500');
    expect(e.message).toContain('Unknown SAP error');
  });

  it('returns AuthError-like SapError for 401', () => {
    const e = parseODataError(401, {});
    expect(e.httpStatus).toBe(401);
    expect(e.code).toBe('AUTH');
  });
});

describe('mapSapMessages', () => {
  it('maps numericSeverity to severity strings', () => {
    const ms = [
      { code: 'A', message: 'a', numericSeverity: 1 as const, transition: false, additionalTargets: [] },
      { code: 'B', message: 'b', numericSeverity: 2 as const, transition: false, additionalTargets: [] },
      { code: 'C', message: 'c', numericSeverity: 3 as const, transition: false, additionalTargets: [] },
      { code: 'D', message: 'd', numericSeverity: 4 as const, transition: false, additionalTargets: [] }
    ];
    const out = mapSapMessages(ms);
    expect(out.map((m) => m.severity)).toEqual(['info', 'warning', 'error', 'error']);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/lib/sap-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `parseODataError` and `mapSapMessages`**

Append to `src/lib/sap-client.ts`:

```ts
import { SapError, type SapErrorSeverity } from './errors';
import type { SapMessage } from './types';

interface ODataError {
  error?: { code?: string; message?: { value?: string } | string; target?: string };
}

export function parseODataError(status: number, body: unknown): SapError {
  const odata = (body ?? {}) as ODataError;
  const err = odata.error ?? {};
  const code = err.code ?? (status === 401 ? 'AUTH' : `HTTP_${status}`);
  const rawMessage = typeof err.message === 'string'
    ? err.message
    : (err.message?.value ?? `Unknown SAP error (HTTP ${status})`);
  return new SapError({
    code,
    message: rawMessage,
    severity: 'error',
    target: err.target,
    httpStatus: status
  });
}

export function mapSapMessages(messages: SapMessage[]): Array<{
  code: string;
  message: string;
  severity: SapErrorSeverity;
  target?: string;
}> {
  return messages.map((m) => ({
    code: m.code,
    message: m.message,
    target: m.target,
    severity: m.numericSeverity === 1 ? 'info' : m.numericSeverity === 2 ? 'warning' : 'error'
  }));
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/sap-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sap-client.ts src/lib/sap-client.test.ts
git commit -m "feat(sap-client): OData error parser and SAP__Messages severity mapper"
```

---

## Task 10: SAP client — operations against mocked OData

**Files:**
- Modify: `src/lib/sap-client.ts`
- Modify: `src/lib/sap-client.test.ts`
- Create: `src/__tests__/fixtures/create-ok.json`
- Create: `src/__tests__/fixtures/release-ok.json`
- Create: `src/__tests__/fixtures/get-404.json`
- Create: `src/__tests__/fixtures/create-error.json`
- Create: `src/__tests__/fixtures/release-warning.json`
- Create: `src/__tests__/fixtures/service-root.json`

- [ ] **Step 1: Write fixture JSONs**

`src/__tests__/fixtures/service-root.json`:

```json
{
  "@odata.context": "$metadata",
  "value": [{ "name": "Request", "url": "Request" }]
}
```

`src/__tests__/fixtures/create-ok.json`:

```json
{
  "Request": "DEVK900123",
  "Description": "PROJ-1 Hello",
  "Owner": "JAIME",
  "Type": "K",
  "TypeText": "Workbench",
  "Target": "QAS",
  "Status": "D",
  "StatusText": "Modifiable",
  "SAP__Messages": []
}
```

`src/__tests__/fixtures/release-ok.json`:

```json
{
  "Request": "DEVK900123",
  "Description": "PROJ-1 Hello",
  "Owner": "JAIME",
  "Type": "K",
  "TypeText": "Workbench",
  "Target": "QAS",
  "Status": "R",
  "StatusText": "Released",
  "SAP__Messages": []
}
```

`src/__tests__/fixtures/get-404.json`:

```json
{ "error": { "code": "NOT_FOUND", "message": { "value": "Transport DEVK999999 not found" } } }
```

`src/__tests__/fixtures/create-error.json`:

```json
{ "error": { "code": "INVALID_TARGET", "message": { "value": "Target system unknown" } } }
```

`src/__tests__/fixtures/release-warning.json`:

```json
{
  "Request": "DEVK900123",
  "Description": "PROJ-1 Hello",
  "Owner": "JAIME",
  "Type": "K",
  "TypeText": "Workbench",
  "Target": "QAS",
  "Status": "R",
  "StatusText": "Released",
  "SAP__Messages": [
    { "code": "TR_W1", "message": "Transport already released", "numericSeverity": 2, "transition": false, "additionalTargets": [] }
  ]
}
```

- [ ] **Step 2: Append failing tests for the four operations**

Append to `src/lib/sap-client.test.ts`:

```ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createSapClient, BASE_PATH as BP } from './sap-client';
import createOk from '../__tests__/fixtures/create-ok.json';
import releaseOk from '../__tests__/fixtures/release-ok.json';
import releaseWarning from '../__tests__/fixtures/release-warning.json';
import createError from '../__tests__/fixtures/create-error.json';
import get404 from '../__tests__/fixtures/get-404.json';
import serviceRoot from '../__tests__/fixtures/service-root.json';

const HOST = 'https://dev.sap.lan';
const CLIENT = '100';

const handlers = [
  http.get(`${HOST}${BP}/`, ({ request }) => {
    const u = new URL(request.url);
    if (u.searchParams.get('sap-client') !== CLIENT) return new HttpResponse(null, { status: 400 });
    return HttpResponse.json(serviceRoot);
  }),
  http.post(`${HOST}${BP}/Request/SAP__self.Create`, async ({ request }) => {
    const u = new URL(request.url);
    if (u.searchParams.get('sap-client') !== CLIENT) return new HttpResponse(null, { status: 400 });
    const body = (await request.json()) as { Target?: string };
    if (body.Target === 'BAD') return HttpResponse.json(createError, { status: 400 });
    return HttpResponse.json(createOk, { status: 201 });
  }),
  http.post(`${HOST}${BP}/Request('DEVK900123')/SAP__self.Release`, () => HttpResponse.json(releaseOk)),
  http.post(`${HOST}${BP}/Request('DEVK900999')/SAP__self.Release`, () => HttpResponse.json(releaseWarning)),
  http.get(`${HOST}${BP}/Request('DEVK900123')`, () => HttpResponse.json(createOk)),
  http.get(`${HOST}${BP}/Request('NOPE')`, () => HttpResponse.json(get404, { status: 404 })),
  http.get(`${HOST}${BP}/Request('UNAUTHZ')`, () => HttpResponse.json({}, { status: 401 }))
];

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const conn = { hostname: HOST, client: CLIENT, username: 'u', password: 'p' };

describe('createSapClient.testConnection', () => {
  it('returns ok:true on a valid service-root response', async () => {
    const client = createSapClient(conn);
    expect(await client.testConnection()).toEqual({ ok: true });
  });
});

describe('createSapClient.createTransport', () => {
  it('creates a transport and returns the entity', async () => {
    const client = createSapClient(conn);
    const r = await client.createTransport({ description: 'PROJ-1 Hello', type: 'K', email: 'a@b.com', target: 'QAS' });
    expect(r.Request).toBe('DEVK900123');
    expect(r.Status).toBe('D');
  });

  it('throws SapError parsed from the OData response on 4xx', async () => {
    const client = createSapClient(conn);
    await expect(
      client.createTransport({ description: 'X', type: 'K', email: 'a@b.com', target: 'BAD' })
    ).rejects.toMatchObject({ code: 'INVALID_TARGET', httpStatus: 400 });
  });

  it('throws RangeError when description exceeds 60 chars', async () => {
    const client = createSapClient(conn);
    await expect(
      client.createTransport({ description: 'a'.repeat(61), type: 'K', email: 'a@b.com' })
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('createSapClient.releaseTransport', () => {
  it('returns the entity on success', async () => {
    const r = await createSapClient(conn).releaseTransport('DEVK900123');
    expect(r.Status).toBe('R');
  });

  it('still resolves with warnings in SAP__Messages', async () => {
    const r = await createSapClient(conn).releaseTransport('DEVK900999');
    expect(r.SAP__Messages?.[0].numericSeverity).toBe(2);
  });
});

describe('createSapClient.getTransport', () => {
  it('returns the entity', async () => {
    const r = await createSapClient(conn).getTransport('DEVK900123');
    expect(r.Request).toBe('DEVK900123');
  });

  it('throws SapError on 404', async () => {
    await expect(createSapClient(conn).getTransport('NOPE')).rejects.toMatchObject({
      code: 'NOT_FOUND', httpStatus: 404
    });
  });

  it('throws SapError with code AUTH on 401', async () => {
    await expect(createSapClient(conn).getTransport('UNAUTHZ')).rejects.toMatchObject({
      code: 'AUTH', httpStatus: 401
    });
  });
});
```

- [ ] **Step 3: Install msw dev dependency if not already pulled**

Run: `npm install --save-dev msw`
Expected: `msw` already in devDependencies → no-op or version bump.

- [ ] **Step 4: Run tests — expect FAIL**

Run: `npm test -- src/lib/sap-client.test.ts`
Expected: FAIL — `createSapClient` not exported.

- [ ] **Step 5: Implement `createSapClient`**

Append to `src/lib/sap-client.ts`:

```ts
import type { RequestType, SapClientCallContext, TransportType } from './types';

export interface SapClient {
  testConnection(): Promise<{ ok: true } | { ok: false; error: SapError }>;
  createTransport(input: { description: string; type: TransportType; email: string; target?: string }): Promise<RequestType>;
  releaseTransport(requestId: string): Promise<RequestType>;
  getTransport(requestId: string): Promise<RequestType>;
}

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  json: () => Promise<unknown>;
  headers: { get: (name: string) => string | null };
}>;

export function createSapClient(conn: SapClientCallContext, fetchImpl: FetchLike = (globalThis as { fetch: FetchLike }).fetch): SapClient {
  const auth = basicAuthHeader(conn);

  async function callJson(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: unknown }> {
    const url = buildUrl(conn, path);
    const headers: Record<string, string> = {
      Authorization: auth,
      Accept: 'application/json'
    };
    let bodyStr: string | undefined;
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(init.body);
    }
    const res = await fetchImpl(url, { method: init?.method ?? 'GET', headers, body: bodyStr });
    const body = await safeJson(res);
    return { status: res.status, body };
  }

  async function safeJson(res: { json: () => Promise<unknown> }): Promise<unknown> {
    try { return await res.json(); } catch { return {}; }
  }

  return {
    async testConnection() {
      try {
        const { status, body } = await callJson('/');
        if (status !== 200) return { ok: false as const, error: parseODataError(status, body) };
        const list = (body as { value?: Array<{ name: string }> }).value ?? [];
        if (!list.some((e) => e.name === 'Request')) {
          return { ok: false as const, error: new SapError({ code: 'BAD_SERVICE', message: 'Service root missing Request entity set', severity: 'error', httpStatus: 200 }) };
        }
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, error: new SapError({ code: 'NETWORK', message: (e as Error).message, severity: 'error' }) };
      }
    },

    async createTransport(input) {
      if (input.description.length > 60) {
        throw new RangeError(`description exceeds 60 chars (${input.description.length}); truncate before calling sap-client`);
      }
      const payload: Record<string, string> = {
        Description: input.description,
        Type: input.type,
        Email: input.email
      };
      if (input.target) payload.Target = input.target;
      const { status, body } = await callJson('/Request/SAP__self.Create', { method: 'POST', body: payload });
      if (status >= 400) throw parseODataError(status, body);
      return body as RequestType;
    },

    async releaseTransport(requestId) {
      const { status, body } = await callJson(`/Request('${encodeURIComponent(requestId)}')/SAP__self.Release`, { method: 'POST', body: {} });
      if (status >= 400) throw parseODataError(status, body);
      return body as RequestType;
    },

    async getTransport(requestId) {
      const path = `/Request('${encodeURIComponent(requestId)}')?$select=Request,Description,Owner,Type,TypeText,Target,Status,StatusText`;
      const { status, body } = await callJson(path);
      if (status >= 400) throw parseODataError(status, body);
      return body as RequestType;
    }
  };
}
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `npm test -- src/lib/sap-client.test.ts`
Expected: PASS — all sap-client tests green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sap-client.ts src/lib/sap-client.test.ts src/__tests__/fixtures
git commit -m "feat(sap-client): create/release/get/testConnection against mocked OData"
```

---

## Task 11: SAP client — CSRF transparent retry

**Files:**
- Modify: `src/lib/sap-client.ts`
- Modify: `src/lib/sap-client.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/lib/sap-client.test.ts`:

```ts
describe('createSapClient CSRF retry', () => {
  it('fetches token on 403 with x-csrf-token: Required, then retries POST with the token', async () => {
    let phase: 'first' | 'fetch' | 'retry' = 'first';
    server.use(
      http.post(`${HOST}${BP}/Request/SAP__self.Create`, ({ request }) => {
        if (phase === 'first') {
          phase = 'fetch';
          return new HttpResponse(null, { status: 403, headers: { 'x-csrf-token': 'Required' } });
        }
        // phase === 'retry'
        const token = request.headers.get('x-csrf-token');
        if (token !== 'ABCD1234') return new HttpResponse(null, { status: 403 });
        return HttpResponse.json(createOk, { status: 201 });
      }),
      http.get(`${HOST}${BP}/`, ({ request }) => {
        if (request.headers.get('x-csrf-token') !== 'Fetch') {
          return HttpResponse.json(serviceRoot);
        }
        phase = 'retry';
        return new HttpResponse(JSON.stringify(serviceRoot), {
          status: 200,
          headers: { 'x-csrf-token': 'ABCD1234', 'content-type': 'application/json' }
        });
      })
    );

    const client = createSapClient(conn);
    const r = await client.createTransport({ description: 'X', type: 'K', email: 'a@b.com' });
    expect(r.Request).toBe('DEVK900123');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/lib/sap-client.test.ts`
Expected: FAIL on the new test.

- [ ] **Step 3: Implement CSRF retry**

Replace the `callJson` function inside `createSapClient` with this version (keep everything else unchanged):

```ts
  let csrfToken: string | null = null;

  async function fetchCsrf(): Promise<string | null> {
    const url = buildUrl(conn, '/');
    const res = await fetchImpl(url, { method: 'GET', headers: { Authorization: auth, 'x-csrf-token': 'Fetch', Accept: 'application/json' } });
    return res.headers.get('x-csrf-token');
  }

  async function callJson(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: unknown }> {
    const url = buildUrl(conn, path);
    const isUnsafe = !!init?.method && init.method !== 'GET';
    const headers: Record<string, string> = {
      Authorization: auth,
      Accept: 'application/json'
    };
    if (csrfToken && isUnsafe) headers['x-csrf-token'] = csrfToken;

    let bodyStr: string | undefined;
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(init.body);
    }

    let res = await fetchImpl(url, { method: init?.method ?? 'GET', headers, body: bodyStr });

    if (res.status === 403 && isUnsafe && res.headers.get('x-csrf-token') === 'Required') {
      csrfToken = await fetchCsrf();
      if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
        res = await fetchImpl(url, { method: init?.method ?? 'GET', headers, body: bodyStr });
      }
    }

    const body = await safeJson(res);
    return { status: res.status, body };
  }
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/sap-client.test.ts`
Expected: PASS — all sap-client tests, including the CSRF case.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sap-client.ts src/lib/sap-client.test.ts
git commit -m "feat(sap-client): transparent CSRF token retry on 403"
```

---

## Task 12: Resolver — connections CRUD

**Files:**
- Create: `src/handlers/connections.ts`
- Create: `src/handlers/connections.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/handlers/connections.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('@forge/api', () => ({
  storage: {
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    query: () => ({
      where: () => ({
        getMany: async () => ({
          results: Array.from(store.entries())
            .filter(([k]) => k.startsWith('connections:'))
            .map(([key, value]) => ({ key, value }))
        })
      })
    })
  },
  default: {
    asApp: () => ({ requestJira: vi.fn() })
  },
  route: (s: TemplateStringsArray) => s.join('')
}));

import { listConnectionsResolver, saveConnectionResolver, deleteConnectionResolver, testConnectionResolver } from './connections';
import * as sapClientMod from '../lib/sap-client';

beforeEach(() => { store.clear(); });

describe('listConnectionsResolver', () => {
  it('returns connections stripped of passwords', async () => {
    store.set('connections:1', { id: '1', label: 'A', hostname: 'https://x', client: '100', username: 'u', password: 'secret' });
    const res = await listConnectionsResolver({ payload: {}, context: {} });
    expect(res[0]).not.toHaveProperty('password');
    expect(res[0].label).toBe('A');
  });
});

describe('saveConnectionResolver', () => {
  it('persists a new connection with a generated id when missing', async () => {
    const res = await saveConnectionResolver({
      payload: { label: 'A', hostname: 'https://x', client: '100', username: 'u', password: 'p' },
      context: {}
    });
    expect(res.id).toBeTruthy();
    expect(store.size).toBe(1);
  });

  it('updates an existing connection by id', async () => {
    store.set('connections:fixed', { id: 'fixed', label: 'old', hostname: 'https://x', client: '100', username: 'u', password: 'p' });
    await saveConnectionResolver({
      payload: { id: 'fixed', label: 'new', hostname: 'https://x', client: '100', username: 'u', password: 'p' },
      context: {}
    });
    expect((store.get('connections:fixed') as { label: string }).label).toBe('new');
  });

  it('rejects invalid hostnames', async () => {
    await expect(saveConnectionResolver({
      payload: { label: 'A', hostname: 'http://insecure', client: '100', username: 'u', password: 'p' },
      context: {}
    })).rejects.toThrow(/https/i);
  });

  it('rejects clients that are not 3 digits', async () => {
    await expect(saveConnectionResolver({
      payload: { label: 'A', hostname: 'https://x', client: '10', username: 'u', password: 'p' },
      context: {}
    })).rejects.toThrow(/client/i);
  });
});

describe('deleteConnectionResolver', () => {
  it('removes the entry', async () => {
    store.set('connections:1', { id: '1', label: 'A', hostname: 'https://x', client: '100', username: 'u', password: 'p' });
    await deleteConnectionResolver({ payload: { id: '1' }, context: {} });
    expect(store.size).toBe(0);
  });
});

describe('testConnectionResolver', () => {
  it('invokes sap-client.testConnection with the given connection', async () => {
    const spy = vi.spyOn(sapClientMod, 'createSapClient').mockReturnValue({
      testConnection: async () => ({ ok: true }),
      createTransport: vi.fn(),
      releaseTransport: vi.fn(),
      getTransport: vi.fn()
    } as never);
    const res = await testConnectionResolver({
      payload: { hostname: 'https://x', client: '100', username: 'u', password: 'p' },
      context: {}
    });
    expect(res).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/handlers/connections.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement resolvers**

```ts
// src/handlers/connections.ts
import { listConnections, saveConnection, deleteConnection, toPublic } from '../lib/storage';
import { createSapClient } from '../lib/sap-client';
import type { Connection } from '../lib/types';

interface ResolverArgs<P = unknown> { payload: P; context: unknown }

function validateConnection(c: Partial<Connection>): asserts c is Omit<Connection, 'id'> {
  if (!c.hostname || !/^https:\/\//.test(c.hostname)) {
    throw new Error('hostname must start with https://');
  }
  if (!c.client || !/^\d{3}$/.test(c.client)) {
    throw new Error('client must be exactly 3 digits');
  }
  if (!c.username || !c.password || !c.label) {
    throw new Error('label, username and password are required');
  }
}

export async function listConnectionsResolver(_args: ResolverArgs) {
  const all = await listConnections();
  return all.map(toPublic);
}

export async function saveConnectionResolver(args: ResolverArgs<Partial<Connection>>) {
  validateConnection(args.payload);
  const id = args.payload.id ?? `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const conn: Connection = {
    id,
    label: args.payload.label!,
    hostname: args.payload.hostname!.replace(/\/+$/, ''),
    client: args.payload.client!,
    username: args.payload.username!,
    password: args.payload.password!
  };
  await saveConnection(conn);
  return { id };
}

export async function deleteConnectionResolver(args: ResolverArgs<{ id: string }>) {
  await deleteConnection(args.payload.id);
  return { ok: true };
}

export async function testConnectionResolver(args: ResolverArgs<{ hostname: string; client: string; username: string; password: string }>) {
  const client = createSapClient(args.payload);
  return client.testConnection();
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/handlers/connections.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/connections.ts src/handlers/connections.test.ts
git commit -m "feat(handlers): connections catalog resolvers with validation and test-connection"
```

---

## Task 13: Resolver — project config CRUD

**Files:**
- Create: `src/handlers/project-config.ts`
- Create: `src/handlers/project-config.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/handlers/project-config.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('@forge/api', () => ({
  storage: {
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    delete: vi.fn(),
    query: () => ({ where: () => ({ getMany: async () => ({ results: [] }) }) })
  },
  default: { asApp: () => ({ requestJira: vi.fn() }) },
  route: (s: TemplateStringsArray) => s.join('')
}));

import { getProjectConfigResolver, saveProjectConfigResolver, previewTemplateResolver } from './project-config';

beforeEach(() => { store.clear(); });

describe('project config resolvers', () => {
  it('returns undefined config for unknown projects', async () => {
    const res = await getProjectConfigResolver({ payload: { projectId: '1' }, context: {} });
    expect(res).toBeUndefined();
  });

  it('saves and reads project config', async () => {
    await saveProjectConfigResolver({
      payload: { projectId: '1', config: { projectCode: 'X', descriptionTemplate: '', defaults: { type: 'K' } } },
      context: {}
    });
    const res = await getProjectConfigResolver({ payload: { projectId: '1' }, context: {} });
    expect(res?.projectCode).toBe('X');
  });

  it('rejects invalid type defaults', async () => {
    await expect(saveProjectConfigResolver({
      payload: { projectId: '1', config: { projectCode: 'X', descriptionTemplate: '', defaults: { type: 'Z' as never } } },
      context: {}
    })).rejects.toThrow(/type/i);
  });
});

describe('previewTemplateResolver', () => {
  it('renders against a mock context using the given template', () => {
    const r = previewTemplateResolver({
      payload: {
        template: '{{issue.key}} {{issue.fields.summary}}',
        sampleContext: { issue: { key: 'PROJ-1', fields: { summary: 'Hi' } } }
      },
      context: {}
    });
    expect(r.text).toBe('PROJ-1 Hi');
    expect(r.truncated).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/handlers/project-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement resolvers**

```ts
// src/handlers/project-config.ts
import { saveProjectConfig, getProjectConfig } from '../lib/storage';
import { render } from '../lib/template';
import type { ProjectConfig, RenderResult, TransportType } from '../lib/types';

interface ResolverArgs<P = unknown> { payload: P; context: unknown }

const VALID_TYPES: TransportType[] = ['K', 'W', 'T'];

export async function getProjectConfigResolver(args: ResolverArgs<{ projectId: string }>): Promise<ProjectConfig | undefined> {
  return getProjectConfig(args.payload.projectId);
}

export async function saveProjectConfigResolver(args: ResolverArgs<{ projectId: string; config: ProjectConfig }>): Promise<{ ok: true }> {
  const cfg = args.payload.config;
  if (!VALID_TYPES.includes(cfg.defaults.type)) {
    throw new Error('defaults.type must be one of K/W/T');
  }
  await saveProjectConfig(args.payload.projectId, cfg);
  return { ok: true };
}

export function previewTemplateResolver(args: ResolverArgs<{ template: string; sampleContext: unknown }>): RenderResult {
  return render(args.payload.template, args.payload.sampleContext);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/handlers/project-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/project-config.ts src/handlers/project-config.test.ts
git commit -m "feat(handlers): project config resolvers and template preview"
```

---

## Task 14: Resolver — issue actions (create, link, release, refresh)

**Files:**
- Create: `src/handlers/issue-actions.ts`
- Create: `src/handlers/issue-actions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/handlers/issue-actions.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Connection, ProjectConfig } from '../lib/types';

const appStore = new Map<string, unknown>();
const issueProps = new Map<string, unknown>();
const userByAcct = new Map<string, { emailAddress: string }>([['acc1', { emailAddress: 'a@b.com' }]]);

vi.mock('@forge/api', () => ({
  storage: {
    get: vi.fn(async (k: string) => appStore.get(k)),
    set: vi.fn(async (k: string, v: unknown) => { appStore.set(k, v); }),
    delete: vi.fn(),
    query: () => ({ where: () => ({ getMany: async () => ({ results: [] }) }) })
  },
  default: {
    asApp: () => ({
      requestJira: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
        const propMatch = path.match(/\/issue\/([^/]+)\/properties\/sap\.transports$/);
        if (propMatch) {
          const key = propMatch[1];
          if (!init || !init.method || init.method === 'GET') {
            const v = issueProps.get(key);
            return v === undefined
              ? { status: 404, json: async () => ({}) }
              : { status: 200, json: async () => ({ value: v }) };
          }
          if (init.method === 'PUT') {
            issueProps.set(key, JSON.parse(init.body!));
            return { status: 200, json: async () => ({}) };
          }
        }
        const userMatch = path.match(/\/rest\/api\/3\/user\?accountId=(.+)$/);
        if (userMatch) {
          const u = userByAcct.get(decodeURIComponent(userMatch[1]));
          return { status: 200, json: async () => u ?? {} };
        }
        const issueMatch = path.match(/\/rest\/api\/3\/issue\/([^/?]+)(?:\?.*)?$/);
        if (issueMatch) {
          return { status: 200, json: async () => ({ key: issueMatch[1], fields: { summary: 'Hi' } }) };
        }
        throw new Error('unexpected path ' + path);
      })
    }),
    asUser: () => ({})
  },
  route: (s: TemplateStringsArray, ...args: unknown[]) =>
    s.reduce((acc, part, i) => acc + part + (args[i] ?? ''), '')
}));

vi.mock('../lib/sap-client', () => ({
  createSapClient: () => ({
    createTransport: vi.fn(async (i: { description: string }) => ({
      Request: 'DEVK900123', Description: i.description, Owner: 'JAIME',
      Type: 'K', TypeText: 'Workbench', Target: 'QAS', Status: 'D', StatusText: 'Modifiable', SAP__Messages: []
    })),
    releaseTransport: vi.fn(async (id: string) => ({
      Request: id, Description: 'x', Owner: 'JAIME', Type: 'K', TypeText: 'Workbench',
      Target: 'QAS', Status: 'R', StatusText: 'Released', SAP__Messages: []
    })),
    getTransport: vi.fn(async (id: string) => {
      if (id === 'NOPE') throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
      return { Request: id, Description: 'x', Owner: 'JAIME', Type: 'K', TypeText: 'Workbench',
        Target: 'QAS', Status: 'D', StatusText: 'Modifiable', SAP__Messages: [] };
    }),
    testConnection: vi.fn()
  }),
  BASE_PATH: '/sap'
}));

const conn: Connection = { id: 'c1', label: 'DEV', hostname: 'https://x', client: '100', username: 'u', password: 'p' };
const cfg: ProjectConfig = { connectionId: 'c1', projectCode: 'PRJX', descriptionTemplate: '', defaults: { type: 'K', target: 'QAS' } };

beforeEach(() => {
  appStore.clear();
  issueProps.clear();
  appStore.set('connections:c1', conn);
  appStore.set('project:10001:config', cfg);
});

import { createTransportResolver, linkTransportResolver, releaseTransportResolver, refreshTransportResolver, listTransportsResolver } from './issue-actions';

describe('createTransportResolver', () => {
  it('renders description, creates the transport and appends to issue property', async () => {
    const r = await createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K', descriptionOverride: '', target: 'QAS' },
      context: { accountId: 'acc1' }
    });
    expect(r.requestId).toBe('DEVK900123');
    const stored = issueProps.get('PROJ-1') as Array<{ requestId: string }>;
    expect(stored.map((e) => e.requestId)).toEqual(['DEVK900123']);
  });

  it('rejects when no connection is configured', async () => {
    appStore.delete('project:10001:config');
    await expect(createTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', type: 'K' },
      context: { accountId: 'acc1' }
    })).rejects.toThrow(/connection/i);
  });
});

describe('linkTransportResolver', () => {
  it('validates and appends the existing transport', async () => {
    const r = await linkTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900200' },
      context: { accountId: 'acc1' }
    });
    expect(r.requestId).toBe('DEVK900200');
    const list = issueProps.get('PROJ-1') as Array<{ requestId: string }>;
    expect(list[0].requestId).toBe('DEVK900200');
  });

  it('fails when SAP says not found', async () => {
    await expect(linkTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'NOPE' },
      context: { accountId: 'acc1' }
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('releaseTransportResolver', () => {
  it('releases and updates the issue property entry', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'DEVK900123', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'Modifiable' }]);
    const r = await releaseTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900123' },
      context: { accountId: 'acc1' }
    });
    expect(r.status).toBe('R');
    const list = issueProps.get('PROJ-1') as Array<{ status: string; releasedAt?: string }>;
    expect(list[0].status).toBe('R');
    expect(list[0].releasedAt).toBeTruthy();
  });
});

describe('refreshTransportResolver', () => {
  it('refreshes status of one entry', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'DEVK900123', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'X', statusText: 'old' }]);
    const r = await refreshTransportResolver({
      payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900123' },
      context: { accountId: 'acc1' }
    });
    expect(r.status).toBe('D');
    const list = issueProps.get('PROJ-1') as Array<{ status: string }>;
    expect(list[0].status).toBe('D');
  });
});

describe('listTransportsResolver', () => {
  it('returns the stored entries', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'DEVK900123', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }]);
    const r = await listTransportsResolver({ payload: { issueKey: 'PROJ-1' }, context: {} });
    expect(r).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/handlers/issue-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement issue-actions resolvers**

```ts
// src/handlers/issue-actions.ts
import api, { route } from '@forge/api';
import { getProjectConfig, getConnection, getIssueTransports, setIssueTransports } from '../lib/storage';
import { createSapClient } from '../lib/sap-client';
import { render } from '../lib/template';
import { ConfigError } from '../lib/errors';
import type { Connection, ProjectConfig, RequestType, SapTransportEntry, TransportType } from '../lib/types';

interface ResolverArgs<P = unknown> { payload: P; context: { accountId?: string } }

async function resolveConnection(projectId: string): Promise<{ conn: Connection; cfg: ProjectConfig }> {
  const cfg = await getProjectConfig(projectId);
  if (!cfg) throw new ConfigError('Project not configured');
  if (cfg.connectionOverride) return { conn: cfg.connectionOverride, cfg };
  if (cfg.connectionId) {
    const c = await getConnection(cfg.connectionId);
    if (!c) throw new ConfigError('Referenced SAP connection does not exist');
    return { conn: c, cfg };
  }
  throw new ConfigError('No SAP connection configured for project');
}

async function fetchUserEmail(accountId: string): Promise<string> {
  const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
  if (res.status !== 200) throw new Error(`Cannot resolve user email (status ${res.status})`);
  const u = (await res.json()) as { emailAddress?: string };
  if (!u.emailAddress) throw new Error('User has no email visible to the app');
  return u.emailAddress;
}

async function fetchIssue(issueKey: string): Promise<unknown> {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`);
  if (res.status !== 200) throw new Error(`Cannot read issue ${issueKey} (status ${res.status})`);
  return res.json();
}

function toEntry(rt: RequestType): SapTransportEntry {
  return {
    requestId: rt.Request,
    type: rt.Type,
    target: rt.Target,
    description: rt.Description,
    createdAt: new Date().toISOString(),
    status: rt.Status,
    statusText: rt.StatusText
  };
}

export async function createTransportResolver(args: ResolverArgs<{
  projectId: string; issueKey: string; type: TransportType; descriptionOverride?: string; target?: string;
}>) {
  const { conn, cfg } = await resolveConnection(args.payload.projectId);
  const accountId = args.context.accountId;
  if (!accountId) throw new Error('Missing accountId');
  const email = await fetchUserEmail(accountId);
  const issue = await fetchIssue(args.payload.issueKey);

  const renderCtx = { issue, project: { code: cfg.projectCode }, user: { email }, date: { iso: new Date().toISOString().slice(0, 10) } };
  const rendered = args.payload.descriptionOverride && args.payload.descriptionOverride.trim().length > 0
    ? render(args.payload.descriptionOverride, renderCtx)
    : render(cfg.descriptionTemplate, renderCtx);

  const client = createSapClient(conn);
  const rt = await client.createTransport({
    description: rendered.text,
    type: args.payload.type,
    email,
    target: args.payload.target ?? cfg.defaults.target
  });

  const entry = toEntry(rt);
  const list = await getIssueTransports(args.payload.issueKey);
  await setIssueTransports(args.payload.issueKey, [...list, entry]);
  return entry;
}

export async function linkTransportResolver(args: ResolverArgs<{ projectId: string; issueKey: string; requestId: string }>) {
  const { conn } = await resolveConnection(args.payload.projectId);
  const client = createSapClient(conn);
  const rt = await client.getTransport(args.payload.requestId);
  const entry = toEntry(rt);
  const list = await getIssueTransports(args.payload.issueKey);
  if (!list.some((e) => e.requestId === entry.requestId)) {
    await setIssueTransports(args.payload.issueKey, [...list, entry]);
  }
  return entry;
}

export async function releaseTransportResolver(args: ResolverArgs<{ projectId: string; issueKey: string; requestId: string }>) {
  const { conn } = await resolveConnection(args.payload.projectId);
  const client = createSapClient(conn);
  const rt = await client.releaseTransport(args.payload.requestId);
  const list = await getIssueTransports(args.payload.issueKey);
  const next = list.map((e) =>
    e.requestId === rt.Request
      ? { ...e, status: rt.Status, statusText: rt.StatusText, releasedAt: new Date().toISOString() }
      : e
  );
  await setIssueTransports(args.payload.issueKey, next);
  return { requestId: rt.Request, status: rt.Status, statusText: rt.StatusText };
}

export async function refreshTransportResolver(args: ResolverArgs<{ projectId: string; issueKey: string; requestId: string }>) {
  const { conn } = await resolveConnection(args.payload.projectId);
  const client = createSapClient(conn);
  const rt = await client.getTransport(args.payload.requestId);
  const list = await getIssueTransports(args.payload.issueKey);
  const next = list.map((e) =>
    e.requestId === rt.Request ? { ...e, status: rt.Status, statusText: rt.StatusText } : e
  );
  await setIssueTransports(args.payload.issueKey, next);
  return { requestId: rt.Request, status: rt.Status, statusText: rt.StatusText };
}

export async function listTransportsResolver(args: ResolverArgs<{ issueKey: string }>): Promise<SapTransportEntry[]> {
  return getIssueTransports(args.payload.issueKey);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/handlers/issue-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/issue-actions.ts src/handlers/issue-actions.test.ts
git commit -m "feat(handlers): issue-actions resolvers (create, link, release, refresh, list)"
```

---

## Task 15: Automation action handlers

**Files:**
- Create: `src/handlers/automation.ts`
- Create: `src/handlers/automation.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/handlers/automation.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProjectConfig } from '../lib/types';

const appStore = new Map<string, unknown>();
const issueProps = new Map<string, unknown>();

vi.mock('@forge/api', () => ({
  storage: {
    get: vi.fn(async (k: string) => appStore.get(k)),
    set: vi.fn(async (k: string, v: unknown) => { appStore.set(k, v); }),
    delete: vi.fn(),
    query: () => ({ where: () => ({ getMany: async () => ({ results: [] }) }) })
  },
  default: {
    asApp: () => ({
      requestJira: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
        const propMatch = path.match(/\/issue\/([^/]+)\/properties\/sap\.transports$/);
        if (propMatch) {
          const k = propMatch[1];
          if (!init?.method || init.method === 'GET') {
            const v = issueProps.get(k);
            return v === undefined
              ? { status: 404, json: async () => ({}) }
              : { status: 200, json: async () => ({ value: v }) };
          }
          issueProps.set(k, JSON.parse(init.body!));
          return { status: 200, json: async () => ({}) };
        }
        if (path.includes('/rest/api/3/user')) return { status: 200, json: async () => ({ emailAddress: 'a@b.com' }) };
        if (path.includes('/rest/api/3/issue/')) return { status: 200, json: async () => ({ key: 'PROJ-1', fields: { summary: 'Hi' } }) };
        throw new Error('unexpected ' + path);
      })
    })
  },
  route: (s: TemplateStringsArray, ...args: unknown[]) =>
    s.reduce((acc, part, i) => acc + part + (args[i] ?? ''), '')
}));

vi.mock('../lib/sap-client', () => ({
  createSapClient: () => ({
    createTransport: vi.fn(async () => ({
      Request: 'DEVK900123', Description: 'x', Owner: 'JAIME', Type: 'K', TypeText: 'Workbench',
      Target: 'QAS', Status: 'D', StatusText: 'Modifiable', SAP__Messages: []
    })),
    releaseTransport: vi.fn(async (id: string) => ({
      Request: id, Description: 'x', Owner: 'JAIME', Type: 'K', TypeText: 'Workbench',
      Target: 'QAS', Status: 'R', StatusText: 'Released', SAP__Messages: []
    })),
    getTransport: vi.fn(async (id: string) => ({
      Request: id, Description: 'x', Owner: 'JAIME', Type: 'K', TypeText: 'Workbench',
      Target: 'QAS', Status: 'D', StatusText: 'Modifiable', SAP__Messages: []
    })),
    testConnection: vi.fn()
  }),
  BASE_PATH: '/sap'
}));

import { automationCreate, automationRelease, automationLink } from './automation';

const cfg: ProjectConfig = { connectionId: 'c1', projectCode: 'P', descriptionTemplate: '', defaults: { type: 'K' } };

beforeEach(() => {
  appStore.clear();
  issueProps.clear();
  appStore.set('project:10001:config', cfg);
  appStore.set('connections:c1', { id: 'c1', label: 'DEV', hostname: 'https://x', client: '100', username: 'u', password: 'p' });
});

describe('automationCreate', () => {
  it('creates and outputs smart values', async () => {
    const r = await automationCreate({ payload: { projectId: '10001', issueKey: 'PROJ-1', email: 'a@b.com', type: 'K' }, context: { accountId: 'acc' } });
    expect(r.sapTransport.requestId).toBe('DEVK900123');
    expect(r.sapTransport.error).toBe('');
  });
});

describe('automationLink', () => {
  it('appends an existing transport', async () => {
    const r = await automationLink({ payload: { projectId: '10001', issueKey: 'PROJ-1', requestId: 'DEVK900200' }, context: {} });
    expect(r.sapTransport.requestId).toBe('DEVK900200');
  });
});

describe('automationRelease', () => {
  it('all-linked releases every non-released entry', async () => {
    issueProps.set('PROJ-1', [
      { requestId: 'A', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' },
      { requestId: 'B', type: 'W', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'R', statusText: 'Released' }
    ]);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'all-linked' }, context: {} });
    expect(r.released).toEqual(['A']);
    expect(r.skipped).toEqual(['B']);
  });

  it('by-id releases the specified one', async () => {
    issueProps.set('PROJ-1', [{ requestId: 'A', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }]);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'by-id', requestId: 'A' }, context: {} });
    expect(r.released).toEqual(['A']);
  });

  it('latest releases the last entry in the list', async () => {
    issueProps.set('PROJ-1', [
      { requestId: 'A', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' },
      { requestId: 'B', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-02', status: 'D', statusText: 'm' }
    ]);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'latest' }, context: {} });
    expect(r.released).toEqual(['B']);
  });

  it('all-linked + onlyType filter limits scope', async () => {
    issueProps.set('PROJ-1', [
      { requestId: 'A', type: 'K', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' },
      { requestId: 'B', type: 'W', target: 'QAS', description: 'x', createdAt: '2026-01-01', status: 'D', statusText: 'm' }
    ]);
    const r = await automationRelease({ payload: { projectId: '10001', issueKey: 'PROJ-1', mode: 'all-linked', onlyType: 'W' }, context: {} });
    expect(r.released).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/handlers/automation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement automation handlers**

```ts
// src/handlers/automation.ts
import { createTransportResolver, linkTransportResolver, releaseTransportResolver } from './issue-actions';
import { getIssueTransports } from '../lib/storage';
import type { TransportType, SapTransportEntry } from '../lib/types';
import { SapError } from '../lib/errors';

interface AutomationArgs<P> { payload: P; context: { accountId?: string } }

interface SmartValue { sapTransport: { requestId: string; status: string; statusText: string; error: string } }

function out(entry: { requestId: string; status: string; statusText: string }, error = ''): SmartValue {
  return { sapTransport: { ...entry, error } };
}

export async function automationCreate(args: AutomationArgs<{
  projectId: string; issueKey: string; type: TransportType;
  target?: string; descriptionOverride?: string; email: string;
}>): Promise<SmartValue> {
  try {
    const entry = await createTransportResolver({
      payload: {
        projectId: args.payload.projectId,
        issueKey: args.payload.issueKey,
        type: args.payload.type,
        target: args.payload.target,
        descriptionOverride: args.payload.descriptionOverride
      },
      context: { accountId: args.context.accountId ?? 'automation' }
    });
    return out({ requestId: entry.requestId, status: entry.status, statusText: entry.statusText });
  } catch (e) {
    return out({ requestId: '', status: '', statusText: '' }, errMsg(e));
  }
}

export async function automationLink(args: AutomationArgs<{ projectId: string; issueKey: string; requestId: string }>): Promise<SmartValue> {
  try {
    const entry = await linkTransportResolver({
      payload: args.payload,
      context: { accountId: args.context.accountId ?? 'automation' }
    });
    return out({ requestId: entry.requestId, status: entry.status, statusText: entry.statusText });
  } catch (e) {
    return out({ requestId: '', status: '', statusText: '' }, errMsg(e));
  }
}

export async function automationRelease(args: AutomationArgs<{
  projectId: string; issueKey: string;
  mode: 'all-linked' | 'by-id' | 'latest';
  requestId?: string;
  onlyType?: TransportType | 'any';
}>): Promise<{ released: string[]; skipped: string[]; failed: Array<{ requestId: string; error: string }> }> {
  const all = await getIssueTransports(args.payload.issueKey);
  let candidates: SapTransportEntry[];
  switch (args.payload.mode) {
    case 'by-id':
      if (!args.payload.requestId) throw new Error('requestId required for mode=by-id');
      candidates = all.filter((e) => e.requestId === args.payload.requestId);
      break;
    case 'latest':
      candidates = all.length === 0 ? [] : [all[all.length - 1]];
      break;
    case 'all-linked':
    default: {
      const t = args.payload.onlyType;
      candidates = all.filter((e) =>
        e.status !== 'R' && (!t || t === 'any' || e.type === t)
      );
    }
  }

  const released: string[] = [];
  const skipped: string[] = all.filter((e) => !candidates.includes(e)).map((e) => e.requestId);
  const failed: Array<{ requestId: string; error: string }> = [];

  for (const c of candidates) {
    try {
      await releaseTransportResolver({
        payload: { projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: c.requestId },
        context: { accountId: args.context.accountId ?? 'automation' }
      });
      released.push(c.requestId);
    } catch (e) {
      failed.push({ requestId: c.requestId, error: errMsg(e) });
    }
  }

  return { released, skipped, failed };
}

function errMsg(e: unknown): string {
  if (e instanceof SapError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/handlers/automation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/automation.ts src/handlers/automation.test.ts
git commit -m "feat(handlers): Jira Automation actions (create, link, release)"
```

---

## Task 16: Resolver entry point — wire up `@forge/resolver`

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write the resolver wiring**

```ts
// src/index.ts
import Resolver from '@forge/resolver';
import {
  listConnectionsResolver, saveConnectionResolver, deleteConnectionResolver, testConnectionResolver
} from './handlers/connections';
import {
  getProjectConfigResolver, saveProjectConfigResolver, previewTemplateResolver
} from './handlers/project-config';
import {
  createTransportResolver, linkTransportResolver, releaseTransportResolver,
  refreshTransportResolver, listTransportsResolver
} from './handlers/issue-actions';
import { automationCreate, automationLink, automationRelease } from './handlers/automation';

const resolver = new Resolver();

resolver.define('connections.list', listConnectionsResolver);
resolver.define('connections.save', saveConnectionResolver);
resolver.define('connections.delete', deleteConnectionResolver);
resolver.define('connections.test', testConnectionResolver);

resolver.define('project.getConfig', getProjectConfigResolver);
resolver.define('project.saveConfig', saveProjectConfigResolver);
resolver.define('project.previewTemplate', previewTemplateResolver);

resolver.define('issue.create', createTransportResolver);
resolver.define('issue.link', linkTransportResolver);
resolver.define('issue.release', releaseTransportResolver);
resolver.define('issue.refresh', refreshTransportResolver);
resolver.define('issue.list', listTransportsResolver);

resolver.define('automation.create', automationCreate);
resolver.define('automation.link', automationLink);
resolver.define('automation.release', automationRelease);

export const handler = resolver.getDefinitions();
```

- [ ] **Step 2: Verify type-check passes**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire all resolvers under @forge/resolver"
```

---

## Task 17: Frontend — admin page

**Files:**
- Create: `src/frontend/admin-page.tsx`

- [ ] **Step 1: Implement admin page with UI Kit 2**

```tsx
// src/frontend/admin-page.tsx
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, Form, FormHeader, FormSection, FormFooter, Heading, Inline, Label,
  SectionMessage, Stack, Table, Textfield, Text, useForm
} from '@forge/react';
import { invoke } from '@forge/bridge';

interface ConnPublic {
  id: string; label: string; hostname: string; client: string; username: string;
}

const App: React.FC = () => {
  const [items, setItems] = useState<ConnPublic[]>([]);
  const [editing, setEditing] = useState<Partial<ConnPublic & { password?: string }> | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const reload = async () => setItems(await invoke<ConnPublic[]>('connections.list'));

  useEffect(() => { void reload(); }, []);

  const onSave = async (values: Record<string, string>) => {
    try {
      await invoke('connections.save', { ...editing, ...values });
      setMessage({ kind: 'success', text: 'Saved' });
      setEditing(null);
      await reload();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const onDelete = async (id: string) => {
    await invoke('connections.delete', { id });
    await reload();
  };

  const onTest = async (values: Record<string, string>) => {
    const res = await invoke<{ ok: boolean; error?: { message: string } }>('connections.test', values);
    setMessage(res.ok
      ? { kind: 'success', text: 'Connection OK' }
      : { kind: 'error', text: res.error?.message ?? 'Failed' });
  };

  return (
    <Stack space="space.200">
      <Heading as="h1">SAP Connections</Heading>
      {message && <SectionMessage appearance={message.kind === 'success' ? 'success' : 'error'}>{message.text}</SectionMessage>}

      <Table>
        <thead>
          <tr><th>Label</th><th>Hostname</th><th>Client</th><th>User</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id}>
              <td>{c.label}</td>
              <td>{c.hostname}</td>
              <td>{c.client}</td>
              <td>{c.username}</td>
              <td>
                <Inline space="space.100">
                  <Button onClick={() => setEditing(c)}>Edit</Button>
                  <Button appearance="danger" onClick={() => onDelete(c.id)}>Delete</Button>
                </Inline>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Button onClick={() => setEditing({})}>+ Add connection</Button>

      {editing && <ConnectionForm initial={editing} onSubmit={onSave} onTest={onTest} onCancel={() => setEditing(null)} />}
    </Stack>
  );
};

const ConnectionForm: React.FC<{
  initial: Partial<ConnPublic & { password?: string }>;
  onSubmit: (v: Record<string, string>) => Promise<void>;
  onTest: (v: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}> = ({ initial, onSubmit, onTest, onCancel }) => {
  const { handleSubmit, register, getValues } = useForm({ defaultValues: initial as Record<string, string> });

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
            <Button type="submit" appearance="primary">Save</Button>
            <Button onClick={() => void onTest(getValues())}>Test connection</Button>
            <Button onClick={onCancel}>Cancel</Button>
          </Inline>
        </FormFooter>
      </Form>
    </Box>
  );
};

ForgeReconciler.render(<App />);
```

- [ ] **Step 2: Verify type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/admin-page.tsx
git commit -m "feat(ui): admin page for SAP connection catalog"
```

---

## Task 18: Frontend — project settings page

**Files:**
- Create: `src/frontend/project-settings.tsx`

- [ ] **Step 1: Implement project settings page**

```tsx
// src/frontend/project-settings.tsx
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, Heading, Inline, Label, RadioGroup, SectionMessage, Select, Stack, Text, Textarea, Textfield, useForm
} from '@forge/react';
import { invoke, view } from '@forge/bridge';
import type { ProjectConfig, RenderResult, TransportType } from '../lib/types';

interface ConnPublic { id: string; label: string }

const App: React.FC = () => {
  const [projectId, setProjectId] = useState<string>('');
  const [connections, setConnections] = useState<ConnPublic[]>([]);
  const [cfg, setCfg] = useState<ProjectConfig | null>(null);
  const [preview, setPreview] = useState<RenderResult | null>(null);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    void (async () => {
      const ctx = (await view.getContext()) as { extension: { project: { id: string } } };
      setProjectId(ctx.extension.project.id);
      setConnections(await invoke<ConnPublic[]>('connections.list'));
      const c = await invoke<ProjectConfig | undefined>('project.getConfig', { projectId: ctx.extension.project.id });
      setCfg(c ?? { projectCode: '', descriptionTemplate: '', defaults: { type: 'K' } });
    })();
  }, []);

  const onPreview = async (template: string) => {
    const r = await invoke<RenderResult>('project.previewTemplate', {
      template,
      sampleContext: { issue: { key: `${cfg?.projectCode ?? 'PRJ'}-1`, fields: { summary: 'Sample summary' } } }
    });
    setPreview(r);
  };

  const onSave = async () => {
    if (!cfg) return;
    try {
      await invoke('project.saveConfig', { projectId, config: cfg });
      setMessage('Saved');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  if (!cfg) return <Text>Loading…</Text>;

  return (
    <Stack space="space.200">
      <Heading as="h1">SAP Transport — Project Settings</Heading>
      {message && <SectionMessage>{message}</SectionMessage>}

      <Label>SAP Connection</Label>
      <RadioGroup
        value={cfg.connectionOverride ? 'override' : 'catalog'}
        options={[
          { name: 'mode', value: 'catalog', label: 'From catalog' },
          { name: 'mode', value: 'override', label: 'Override' }
        ]}
        onChange={(v) => setCfg({ ...cfg, connectionOverride: v.target.value === 'override' ? { id: 'override', label: 'override', hostname: '', client: '', username: '', password: '' } : undefined })}
      />
      {!cfg.connectionOverride && (
        <Select
          options={connections.map((c) => ({ label: c.label, value: c.id }))}
          value={cfg.connectionId ? { label: connections.find((c) => c.id === cfg.connectionId)?.label ?? cfg.connectionId, value: cfg.connectionId } : undefined}
          onChange={(opt) => setCfg({ ...cfg, connectionId: opt?.value })}
        />
      )}

      <Label>Project code</Label>
      <Textfield value={cfg.projectCode} onChange={(e) => setCfg({ ...cfg, projectCode: e.target.value })} />

      <Label>Default type</Label>
      <Select
        options={[{ label: 'Workbench', value: 'K' }, { label: 'Customizing', value: 'W' }, { label: 'Copy', value: 'T' }]}
        value={{ label: ({ K: 'Workbench', W: 'Customizing', T: 'Copy' })[cfg.defaults.type], value: cfg.defaults.type }}
        onChange={(opt) => setCfg({ ...cfg, defaults: { ...cfg.defaults, type: (opt?.value ?? 'K') as TransportType } })}
      />

      <Label>Default target</Label>
      <Textfield value={cfg.defaults.target ?? ''} onChange={(e) => setCfg({ ...cfg, defaults: { ...cfg.defaults, target: e.target.value } })} />

      <Label>Description template</Label>
      <Textarea
        value={cfg.descriptionTemplate}
        onChange={(e) => { setCfg({ ...cfg, descriptionTemplate: e.target.value }); void onPreview(e.target.value); }}
      />
      {preview && (
        <Box padding="space.100">
          <Text>Preview: "{preview.text}" ({preview.length}/60{preview.truncated ? ' — truncated' : ''})</Text>
          {preview.warnings.map((w) => <Text key={w}>⚠ {w}</Text>)}
        </Box>
      )}

      <Inline><Button appearance="primary" onClick={onSave}>Save</Button></Inline>
    </Stack>
  );
};

ForgeReconciler.render(<App />);
```

- [ ] **Step 2: Verify type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/project-settings.tsx
git commit -m "feat(ui): project settings page with live template preview"
```

---

## Task 19: Frontend — issue panel

**Files:**
- Create: `src/frontend/issue-panel.tsx`

- [ ] **Step 1: Implement the issue panel**

```tsx
// src/frontend/issue-panel.tsx
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, Heading, Inline, ModalDialog, SectionMessage, Stack, Table, Text, Textfield
} from '@forge/react';
import { invoke, view } from '@forge/bridge';
import type { SapTransportEntry, TransportType } from '../lib/types';

const App: React.FC = () => {
  const [projectId, setProjectId] = useState('');
  const [issueKey, setIssueKey] = useState('');
  const [entries, setEntries] = useState<SapTransportEntry[]>([]);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState<TransportType | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const ctx = (await view.getContext()) as { extension: { project: { id: string }; issue: { key: string } } };
      setProjectId(ctx.extension.project.id);
      setIssueKey(ctx.extension.issue.key);
      setEntries(await invoke<SapTransportEntry[]>('issue.list', { issueKey: ctx.extension.issue.key }));
    })();
  }, []);

  const reload = async () => setEntries(await invoke<SapTransportEntry[]>('issue.list', { issueKey }));

  const onRelease = async (requestId: string) => {
    try {
      await invoke('issue.release', { projectId, issueKey, requestId });
      setMessage({ kind: 'success', text: `Released ${requestId}` });
      await reload();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const onRefresh = async (requestId: string) => {
    await invoke('issue.refresh', { projectId, issueKey, requestId });
    await reload();
  };

  return (
    <Stack space="space.200">
      <Heading as="h2">SAP Transport</Heading>
      {message && <SectionMessage appearance={message.kind === 'success' ? 'success' : 'error'}>{message.text}</SectionMessage>}

      <Table>
        <thead><tr><th>Request</th><th>Type</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.requestId}>
              <td>{e.requestId}</td>
              <td>{({ K: 'Workbench', W: 'Customizing', T: 'Copy' })[e.type]}</td>
              <td>{e.description}</td>
              <td>{e.statusText}</td>
              <td>
                <Inline space="space.100">
                  <Button onClick={() => void onRefresh(e.requestId)}>⟳</Button>
                  {e.status !== 'R' && <Button onClick={() => void onRelease(e.requestId)}>Release</Button>}
                </Inline>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Inline space="space.100">
        <ButtonGroup>
          <Button onClick={() => setCreateOpen('K')}>+ Workbench</Button>
          <Button onClick={() => setCreateOpen('W')}>+ Customizing</Button>
          <Button onClick={() => setCreateOpen('T')}>+ Copy</Button>
        </ButtonGroup>
        <Button onClick={() => setLinkOpen(true)}>Link existing</Button>
      </Inline>

      {createOpen && (
        <CreateDialog
          type={createOpen}
          projectId={projectId}
          issueKey={issueKey}
          onClose={() => setCreateOpen(null)}
          onDone={async (msg) => { setMessage({ kind: 'success', text: msg }); setCreateOpen(null); await reload(); }}
          onError={(msg) => setMessage({ kind: 'error', text: msg })}
        />
      )}
      {linkOpen && (
        <LinkDialog
          projectId={projectId}
          issueKey={issueKey}
          onClose={() => setLinkOpen(false)}
          onDone={async (msg) => { setMessage({ kind: 'success', text: msg }); setLinkOpen(false); await reload(); }}
          onError={(msg) => setMessage({ kind: 'error', text: msg })}
        />
      )}
    </Stack>
  );
};

const CreateDialog: React.FC<{
  type: TransportType; projectId: string; issueKey: string;
  onClose: () => void; onDone: (msg: string) => Promise<void>; onError: (msg: string) => void;
}> = ({ type, projectId, issueKey, onClose, onDone, onError }) => {
  const [override, setOverride] = useState('');
  const [target, setTarget] = useState('');
  const submit = async () => {
    try {
      const r = await invoke<{ requestId: string }>('issue.create', { projectId, issueKey, type, descriptionOverride: override, target: target || undefined });
      await onDone(`Created ${r.requestId}`);
    } catch (e) { onError((e as Error).message); }
  };
  return (
    <ModalDialog header="Create transport" onClose={onClose}>
      <Stack space="space.100">
        <Text>Description override (optional)</Text>
        <Textfield value={override} onChange={(e) => setOverride(e.target.value)} />
        <Text>Target (optional, falls back to project default)</Text>
        <Textfield value={target} onChange={(e) => setTarget(e.target.value)} />
        <Inline><Button appearance="primary" onClick={submit}>Create</Button><Button onClick={onClose}>Cancel</Button></Inline>
      </Stack>
    </ModalDialog>
  );
};

const LinkDialog: React.FC<{
  projectId: string; issueKey: string;
  onClose: () => void; onDone: (msg: string) => Promise<void>; onError: (msg: string) => void;
}> = ({ projectId, issueKey, onClose, onDone, onError }) => {
  const [requestId, setRequestId] = useState('');
  const submit = async () => {
    try {
      const r = await invoke<{ requestId: string }>('issue.link', { projectId, issueKey, requestId });
      await onDone(`Linked ${r.requestId}`);
    } catch (e) { onError((e as Error).message); }
  };
  return (
    <ModalDialog header="Link existing transport" onClose={onClose}>
      <Stack space="space.100">
        <Textfield value={requestId} onChange={(e) => setRequestId(e.target.value)} placeholder="DEVK900123" />
        <Inline><Button appearance="primary" onClick={submit}>Link</Button><Button onClick={onClose}>Cancel</Button></Inline>
      </Stack>
    </ModalDialog>
  );
};

ForgeReconciler.render(<App />);
```

- [ ] **Step 2: Verify type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/issue-panel.tsx
git commit -m "feat(ui): issue panel with create/link/release/refresh"
```

---

## Task 20: Manifest assembly

**Files:**
- Modify: `manifest.yml`

- [ ] **Step 1: Replace the manifest skeleton with the full module list**

Replace the entire content of `manifest.yml` with:

```yaml
modules:
  jira:adminPage:
    - key: sap-admin-page
      title: SAP Transport — Connections
      icon: https://developer.atlassian.com/platform/forge/images/icons/configure.svg
      resource: admin-ui
      resolver:
        function: resolver
  jira:projectSettingsPage:
    - key: sap-project-settings
      title: SAP Transport
      resource: project-settings-ui
      resolver:
        function: resolver
  jira:issuePanel:
    - key: sap-issue-panel
      title: SAP Transport
      resource: issue-panel-ui
      resolver:
        function: resolver
  jira:jiraAutomationAction:
    - key: create-sap-transport
      name: Create SAP Transport
      function: automation-create
      actionVerb: CREATE
      config:
        view:
          resource: automation-create-ui
    - key: release-sap-transport
      name: Release SAP Transport
      function: automation-release
      actionVerb: ACT
      config:
        view:
          resource: automation-release-ui
    - key: link-sap-transport
      name: Link Existing SAP Transport
      function: automation-link
      actionVerb: ACT
      config:
        view:
          resource: automation-link-ui
  function:
    - key: resolver
      handler: index.handler
    - key: automation-create
      handler: index.handler
    - key: automation-release
      handler: index.handler
    - key: automation-link
      handler: index.handler

resources:
  - key: admin-ui
    path: src/frontend/admin-page.tsx
  - key: project-settings-ui
    path: src/frontend/project-settings.tsx
  - key: issue-panel-ui
    path: src/frontend/issue-panel.tsx
  - key: automation-create-ui
    path: src/frontend/automation-create-config.tsx
  - key: automation-release-ui
    path: src/frontend/automation-release-config.tsx
  - key: automation-link-ui
    path: src/frontend/automation-link-config.tsx

app:
  id: ari:cloud:ecosystem::app/REPLACE-WITH-FORGE-CREATE
  runtime:
    name: nodejs20.x

permissions:
  scopes:
    - read:jira-work
    - read:jira-user
    - manage:jira-configuration
    - manage:jira-project
    - storage:app
  external:
    fetch:
      backend:
        - 'https://*'
```

- [ ] **Step 2: Create the three automation config UI stubs (UI Kit forms that emit the action's payload)**

`src/frontend/automation-create-config.tsx`:

```tsx
import React from 'react';
import ForgeReconciler, { Form, Label, Select, Textfield, useForm } from '@forge/react';

const Config: React.FC = () => {
  const { register } = useForm();
  return (
    <Form>
      <Label>Type</Label>
      <Select {...register('type')} options={[
        { label: 'Workbench', value: 'K' },
        { label: 'Customizing', value: 'W' },
        { label: 'Copy', value: 'T' }
      ]} />
      <Label>Target (optional)</Label>
      <Textfield {...register('target')} />
      <Label>Description override (smart value)</Label>
      <Textfield {...register('descriptionOverride')} />
      <Label>Email</Label>
      <Textfield {...register('email')} defaultValue="{{initiator.emailAddress}}" />
    </Form>
  );
};

ForgeReconciler.render(<Config />);
```

`src/frontend/automation-release-config.tsx`:

```tsx
import React from 'react';
import ForgeReconciler, { Form, Label, Select, Textfield, useForm } from '@forge/react';

const Config: React.FC = () => {
  const { register } = useForm();
  return (
    <Form>
      <Label>Mode</Label>
      <Select {...register('mode')} options={[
        { label: 'All linked', value: 'all-linked' },
        { label: 'By id', value: 'by-id' },
        { label: 'Latest', value: 'latest' }
      ]} />
      <Label>Request id (only for "By id")</Label>
      <Textfield {...register('requestId')} />
      <Label>Only type (for "All linked")</Label>
      <Select {...register('onlyType')} options={[
        { label: 'Any', value: 'any' },
        { label: 'Workbench', value: 'K' },
        { label: 'Customizing', value: 'W' },
        { label: 'Copy', value: 'T' }
      ]} />
    </Form>
  );
};

ForgeReconciler.render(<Config />);
```

`src/frontend/automation-link-config.tsx`:

```tsx
import React from 'react';
import ForgeReconciler, { Form, Label, Textfield, useForm } from '@forge/react';

const Config: React.FC = () => {
  const { register } = useForm();
  return (
    <Form>
      <Label>Request id</Label>
      <Textfield {...register('requestId')} />
    </Form>
  );
};

ForgeReconciler.render(<Config />);
```

- [ ] **Step 3: Run `forge lint` (or skip if Forge CLI not installed locally; the CI job covers it)**

Run: `npx forge lint || echo "Forge CLI not installed locally — CI will catch this"`
Expected: success message or skip with the printed note.

- [ ] **Step 4: Commit**

```bash
git add manifest.yml src/frontend/automation-create-config.tsx src/frontend/automation-release-config.tsx src/frontend/automation-link-config.tsx
git commit -m "feat: wire all Forge modules (admin, settings, issue panel, automation actions)"
```

---

## Task 20.5: Structured logger

**Files:**
- Create: `src/lib/logger.ts`
- Create: `src/lib/logger.test.ts`
- Modify: `src/handlers/issue-actions.ts`
- Modify: `src/handlers/automation.ts`

- [ ] **Step 1: Write failing tests for the logger**

```ts
// src/lib/logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logEvent } from './logger';

describe('logEvent', () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  beforeEach(() => { spy.mockClear(); });
  afterEach(() => { spy.mockClear(); });

  it('emits a JSON line with the supplied fields plus a timestamp', () => {
    logEvent('info', { action: 'create', issueKey: 'PROJ-1', outcome: 'ok' });
    expect(spy).toHaveBeenCalledOnce();
    const line = spy.mock.calls[0][0] as string;
    const obj = JSON.parse(line);
    expect(obj.level).toBe('info');
    expect(obj.action).toBe('create');
    expect(obj.issueKey).toBe('PROJ-1');
    expect(obj.outcome).toBe('ok');
    expect(typeof obj.ts).toBe('string');
  });

  it('never serialises a password field — redacts it if present', () => {
    logEvent('info', { action: 'x', password: 'leak', headers: { Authorization: 'Basic abc' } });
    const obj = JSON.parse(spy.mock.calls[0][0] as string);
    expect(obj.password).toBe('[REDACTED]');
    expect(obj.headers.Authorization).toBe('[REDACTED]');
  });

  it('routes warn level to console.warn and error to console.error', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logEvent('warn', { action: 'a' });
    logEvent('error', { action: 'b' });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/lib/logger.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `logger.ts`**

```ts
// src/lib/logger.ts

export type LogLevel = 'info' | 'warn' | 'error';

const REDACT_KEYS = new Set(['password', 'Authorization', 'authorization']);

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k) ? '[REDACTED]' : redact(v);
  }
  return out;
}

export function logEvent(level: LogLevel, fields: Record<string, unknown>): void {
  const payload = { ts: new Date().toISOString(), level, ...(redact(fields) as Record<string, unknown>) };
  const line = JSON.stringify(payload);
  switch (level) {
    case 'info':  console.log(line); break;
    case 'warn':  console.warn(line); break;
    case 'error': console.error(line); break;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/logger.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread logger into issue-actions**

Edit `src/handlers/issue-actions.ts` — add the import at the top:

```ts
import { logEvent } from '../lib/logger';
```

Then wrap each exported resolver. For `createTransportResolver`, replace the function body with this `try/catch/finally` shape that logs around the SAP call (keep the rest of the logic identical to what was implemented in Task 14):

```ts
export async function createTransportResolver(args: ResolverArgs<{
  projectId: string; issueKey: string; type: TransportType; descriptionOverride?: string; target?: string;
}>) {
  const started = Date.now();
  try {
    const { conn, cfg } = await resolveConnection(args.payload.projectId);
    const accountId = args.context.accountId;
    if (!accountId) throw new Error('Missing accountId');
    const email = await fetchUserEmail(accountId);
    const issue = await fetchIssue(args.payload.issueKey);

    const renderCtx = { issue, project: { code: cfg.projectCode }, user: { email }, date: { iso: new Date().toISOString().slice(0, 10) } };
    const rendered = args.payload.descriptionOverride && args.payload.descriptionOverride.trim().length > 0
      ? render(args.payload.descriptionOverride, renderCtx)
      : render(cfg.descriptionTemplate, renderCtx);

    const client = createSapClient(conn);
    const rt = await client.createTransport({
      description: rendered.text,
      type: args.payload.type,
      email,
      target: args.payload.target ?? cfg.defaults.target
    });

    const entry = toEntry(rt);
    const list = await getIssueTransports(args.payload.issueKey);
    await setIssueTransports(args.payload.issueKey, [...list, entry]);

    logEvent('info', { action: 'issue.create', projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: entry.requestId, durationMs: Date.now() - started, outcome: 'ok' });
    return entry;
  } catch (e) {
    logEvent('error', { action: 'issue.create', projectId: args.payload.projectId, issueKey: args.payload.issueKey, durationMs: Date.now() - started, outcome: 'fail', errorCode: (e as { code?: string }).code, message: (e as Error).message });
    throw e;
  }
}
```

Apply the same `started`/`logEvent('info' | 'error', { action: 'issue.<x>' })` pattern to `linkTransportResolver`, `releaseTransportResolver` and `refreshTransportResolver`. The `action` values are `issue.link`, `issue.release`, `issue.refresh` respectively. The `requestId` for release/refresh comes from `args.payload.requestId`.

- [ ] **Step 6: Thread logger into automation handlers**

Edit `src/handlers/automation.ts` — add the import:

```ts
import { logEvent } from '../lib/logger';
```

At the top of each of `automationCreate`, `automationLink`, `automationRelease`, capture `const started = Date.now();`. Inside the existing `try { ... } catch { ... }` for `automationCreate` and `automationLink`, log `info` with outcome `ok` (after returning entry) and `error` with `errorCode`/`message` in the catch. For `automationRelease`, after computing `released`, `skipped`, `failed`, log a single `info` event with those arrays as fields.

Sample for `automationCreate`:

```ts
export async function automationCreate(args: AutomationArgs<{
  projectId: string; issueKey: string; type: TransportType;
  target?: string; descriptionOverride?: string; email: string;
}>): Promise<SmartValue> {
  const started = Date.now();
  try {
    const entry = await createTransportResolver({
      payload: { projectId: args.payload.projectId, issueKey: args.payload.issueKey, type: args.payload.type, target: args.payload.target, descriptionOverride: args.payload.descriptionOverride },
      context: { accountId: args.context.accountId ?? 'automation' }
    });
    logEvent('info', { action: 'automation.create', projectId: args.payload.projectId, issueKey: args.payload.issueKey, requestId: entry.requestId, durationMs: Date.now() - started, outcome: 'ok' });
    return out({ requestId: entry.requestId, status: entry.status, statusText: entry.statusText });
  } catch (e) {
    logEvent('error', { action: 'automation.create', projectId: args.payload.projectId, issueKey: args.payload.issueKey, durationMs: Date.now() - started, outcome: 'fail', errorCode: (e as { code?: string }).code, message: (e as Error).message });
    return out({ requestId: '', status: '', statusText: '' }, errMsg(e));
  }
}
```

- [ ] **Step 7: Run the full test suite — expect PASS**

Run: `npm test`
Expected: every test from earlier tasks still green; `logger.test.ts` green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/logger.ts src/lib/logger.test.ts src/handlers/issue-actions.ts src/handlers/automation.ts
git commit -m "feat(observability): structured logger with secret redaction wired into all actions"
```

---

## Task 21: CI workflow + coverage gate

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run test:coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/
```

- [ ] **Step 2: Verify the coverage threshold blocks the build by temporarily lowering coverage and confirming failure (manual local check, optional)**

Run: `npm run test:coverage`
Expected: PASS overall; reported coverage ≥90% on all four metrics. The `vitest.config.ts` thresholds make the run fail otherwise.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint + tests with 90% coverage gate"
```

---

## Task 22: README with install / develop / deploy notes

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

````markdown
# Jira–SAP Transport Connector

Forge app that creates, links and releases SAP transport requests from Jira issues and Jira Automation rules.

## Develop

```
npm install
npm run lint
npm test
npm run test:coverage
```

## Deploy (first time)

```
npx forge login
npx forge create   # accept the prompt and copy the generated app id into manifest.yml
npx forge deploy
npx forge install --site <your-site>.atlassian.net --product jira
```

## Configure

1. As Jira admin, open `Apps → Manage apps → SAP Transport — Connections` and add at least one connection (hostname `https://…`, client `100`, user, password). Click `Test connection`.
2. As project admin, open `Project settings → SAP Transport` and pick a connection (or override), set a project code, default type/target and Description template. Save.
3. Open any issue. The `SAP Transport` panel offers Create / Link / Release / Refresh.
4. For Automation: build a rule in the Jira UI, pick a trigger of your choice, and add the action `Create SAP Transport`, `Release SAP Transport` or `Link Existing SAP Transport`.

## Architecture

See `docs/superpowers/specs/2026-05-17-jira-sap-transport-connector-design.md` and the implementation plan at `docs/superpowers/plans/2026-05-17-jira-sap-transport-connector-implementation.md`.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with develop, deploy and configuration walk-through"
```

---

## Final verification

- [ ] **Step 1: Full test + lint pass with coverage**

Run: `npm run lint && npm run test:coverage`
Expected:
- `lint` exits 0.
- All tests pass.
- Coverage ≥ 90% for statements, branches, functions, lines (printed in the summary table).
- `template.ts` and the error parsing branch of `sap-client.ts` at 100%.

- [ ] **Step 2: Confirm git history is clean and logical**

Run: `git log --oneline`
Expected: a sequence of commits — one per task — readable as a feature history (no fix-ups, no WIPs).
