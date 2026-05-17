# Jira ↔ SAP Transport Connector — Design

*[Español](./2026-05-17-jira-sap-transport-connector-design.es.md) · **English***

**Date:** 2026-05-17
**Status:** Draft for review
**Platform:** Atlassian Forge (Jira Cloud)

## 1. Purpose

A Forge app that lets Jira users **create, link and release SAP transport requests** directly from a Jira issue, and lets Jira Automation rules drive the same operations programmatically (e.g. release transports when an issue transitions to "Done").

The app talks to a custom SAP OData v4 service:

```
{hostname}/sap/opu/odata4/sap/zjira_api_transportrequest_o4/srvd_a2x/sap/zjira_api_transportrequest_o4/0001/?sap-client={client}
```

Service surface used (see attached `$metadata`):

- `EntitySet Request` of `RequestType` (read-only via standard CRUD)
- Action `Create(Description, Type, Email, Target) → RequestType` (bound to the collection). `Email` is a customisation of the standard `Owner` field: SAP maps the Jira user email to its internal SAP user.
- Action `Release()` bound to a `RequestType` instance
- `SAP__Messages` (collection of `SAP__Message`) returned with each entity

## 2. Goals / Non-goals

**Goals**

- Per-project configuration of SAP connection, project code, defaults and Description template.
- Issue panel with: list of linked transports, create (workbench/customizing/copy), link existing, release, refresh status.
- Jira Automation actions: Create, Release, Link.
- Multiple transports per issue.
- Free-form template syntax with full access to Jira fields (incl. customfields).

**Non-goals**

- Bidirectional sync of arbitrary SAP objects (only transport requests).
- Replacing SAP transport tooling (SE09/SE10) — we are a thin orchestration layer.
- Per-Jira-user → SAP-user mapping tables (the OData service handles the mapping internally from the Jira email).
- Surfacing transport contents (objects inside the order).

## 3. Architecture

### 3.1 Module layout

```
forge-app/
├── manifest.yml
└── src/
    ├── frontend/
    │   ├── admin-page.tsx          # Global SAP connection catalog
    │   ├── project-settings.tsx    # Per-project config
    │   └── issue-panel.tsx         # Per-issue actions
    ├── handlers/
    │   ├── connections.ts          # Catalog CRUD resolvers
    │   ├── project-config.ts       # Project config CRUD resolvers
    │   ├── issue-actions.ts        # Create / Link / Release / Refresh resolvers
    │   └── automation.ts           # Jira Automation action handlers
    ├── lib/
    │   ├── sap-client.ts           # OData v4 client (fetch + auth + CSRF)
    │   ├── template.ts             # Description template engine
    │   ├── storage.ts              # Typed wrappers over Forge storage
    │   └── types.ts
    └── __tests__/
        └── fixtures/               # Captured SAP responses
```

### 3.2 Forge modules (`manifest.yml`)

| Module | Purpose |
|---|---|
| `jira:adminPage` | Global catalog of SAP connections |
| `jira:projectSettingsPage` | Per-project configuration |
| `jira:issuePanel` | Issue panel with actions |
| `jira:jiraAutomationAction` × 3 | `create-sap-transport`, `release-sap-transport`, `link-sap-transport` |
| `function` (multiple) | Resolvers for the frontends and automation handlers |

### 3.3 Permissions / scopes

- `read:jira-work`, `read:jira-user` — read issues and users (for template resolution and user email).
- `manage:jira-configuration` — gate the admin page.
- `manage:jira-project` — gate the project settings page.
- `storage:app` — persist catalog and project config.
- `external.fetch.backend: ["https://*"]` (narrowed in production to the registered SAP hostnames).

### 3.4 Storage layout

Forge storage is encrypted at rest. Three logical buckets:

| Key / scope | Shape | Notes |
|---|---|---|
| `connections:<id>` (app) | `{ id, label, hostname, client, username, password }` | `client` is the SAP mandant (3-char string). `password` never round-trips to the frontend. |
| `project:<projectId>:config` (app) | `{ connectionId?, connectionOverride?, projectCode, descriptionTemplate, defaults: { type, target? } }` | Override beats catalog. |
| Issue property `sap.transports` (issue) | `Array<{ requestId, type, target, description, createdAt, status, statusText, releasedAt? }>` | One issue → many transports. |

## 4. SAP OData client (`sap-client.ts`)

### 4.1 Connection resolution

```
resolveConnection(projectId):
  cfg = storage.get(`project:${projectId}:config`)
  if cfg.connectionOverride: return cfg.connectionOverride
  if cfg.connectionId:       return catalog.get(cfg.connectionId)
  throw ConfigError("No SAP connection configured for project")
```

### 4.2 Public surface

```ts
type SapClient = {
  createTransport(input: {
    description: string;        // already-truncated text (see §5.4); sap-client validates length ≤60 and throws if exceeded
    type: 'K' | 'W' | 'T';      // K=Workbench, W=Customizing, T=Copy
    email: string;              // Jira user's email
    target?: string;            // ≤10 chars
  }): Promise<RequestType>;

  releaseTransport(requestId: string): Promise<RequestType>;

  getTransport(requestId: string): Promise<RequestType>;

  testConnection(): Promise<{ ok: true } | { ok: false; error: SapError }>;
}
```

### 4.3 Endpoint and request shape

Base: `{hostname}/sap/opu/odata4/sap/zjira_api_transportrequest_o4/srvd_a2x/sap/zjira_api_transportrequest_o4/0001`

Every request appends `?sap-client={client}` (the mandant from the connection), even when the URL already has a query string (use `&` then).

| Operation | Method | URL | Body |
|---|---|---|---|
| Create | POST | `/Request/SAP__self.Create?sap-client={client}` | `{ Description, Type, Email, Target? }` |
| Release | POST | `/Request('{id}')/SAP__self.Release?sap-client={client}` | `{}` |
| Get | GET | `/Request('{id}')?sap-client={client}&$select=Request,Description,Owner,Type,TypeText,Target,Status,StatusText` | — |
| Test | GET | `/?sap-client={client}` | — (expect 200, `{ value: [...] }` containing entry `name == "Request"`) |

Headers: `Authorization: Basic base64(user:password)`, `Accept: application/json`, `Content-Type: application/json` (on POST).

### 4.4 CSRF handling

SAP gateways typically require CSRF for unsafe methods. The client implements transparent retry:

1. POST request without token.
2. If response is 403 with header `x-csrf-token: Required`, do a `GET /?sap-client={client}` with `x-csrf-token: Fetch`, capture the returned token and `set-cookie` session, and retry the POST with `x-csrf-token: <token>` and the session cookie.
3. Cache token + cookie in-memory for the lifetime of the resolver invocation.

### 4.5 Error model

```ts
type SapError = {
  code: string;
  message: string;
  target?: string;
  severity: 'info' | 'warning' | 'error';   // mapped from numericSeverity 1/2/3-4
  httpStatus?: number;
};
```

Parsing rules:

- HTTP 4xx/5xx: read `error.message.value` and `error.details[].message` from the OData error JSON.
- Successful response containing `SAP__Messages`: surface as `warnings: SapError[]` alongside the result; do not fail.
- HTTP 401: classify as `AuthError` (distinct subtype) so the UI can offer "check credentials".

## 5. Description template engine (`template.ts`)

### 5.1 Syntax

Mustache-style single form: `{{path.with.dots}}`.

Default template (used when project config has an empty template):

```
{{issue.key}} {{issue.fields.summary}}
```

### 5.2 Resolution contexts

| Prefix | Source | Examples |
|---|---|---|
| `issue.*` | `GET /rest/api/3/issue/{key}` via `api.asApp().requestJira(...)` | `issue.key`, `issue.fields.summary`, `issue.fields.issuetype.name`, `issue.fields.customfield_10001`, `issue.fields.customfield_10001.value` |
| `project.*` | Project config + Jira project fetch | `project.code`, `project.key`, `project.name` |
| `user.*` | Acting Jira user | `user.email`, `user.displayName`, `user.accountId` |
| `date.*` | Server clock at render time | `date.iso` (YYYY-MM-DD), `date.year`, `date.month` |

### 5.3 Resolution and edge cases

- Walk dotted path against the resolved context object.
- Missing path → empty string + a `warning` in the returned render result (does not abort).
- Non-scalar value (object/array) → empty string + warning "non-scalar field".
- `null`/`undefined` → empty string.
- Numbers → `String(value)`.

### 5.4 60-char overflow

The SAP `Description` field is `MaxLength=60`. Truncation is the responsibility of the **template engine**, not `sap-client.ts`. Behaviour:

- `template.render(template, context)` returns `{ text, length, warnings, truncated: boolean }` where `text` is **already ≤60 chars**.
- Truncation rule: cut at the last whitespace ≤ 60; if no whitespace exists in the first 60 chars, hard-cut at 60.
- Truncation is non-blocking; the modal preview shows `truncated: true` as a UI warning before the user submits.
- `sap-client.ts` enforces a defensive precondition: throws `RangeError` if `description.length > 60`. This is a safety net against future callers that bypass the template engine; it should never fire in normal flows.

## 6. UI screens

### 6.1 Admin page (catalog)

- Table of connections with columns: label, hostname, client, username, actions (Test, Edit, Delete).
- Add/Edit form: `label`, `hostname` (validate https URL), `client` (3 chars), `username`, `password` (write-only).
- **Test connection** button calls `testConnection()` → green check on 200 with expected payload, otherwise red toast with parsed SAP error.

### 6.2 Project settings page

- Connection chooser: radio between "Use from catalog" (dropdown) and "Override" (inline form same as admin).
- Project code text input.
- Defaults: Type (Workbench / Customizing / Copy), Target (text, ≤10 chars).
- Description template textarea + live preview (sample issue from the project, picker to test against another issue key). Preview shows expanded text, `length/60` counter, truncation marker, and a list of warnings (missing paths, non-scalar fields).
- Save button persists to `project:<projectId>:config`.

### 6.3 Issue panel

- Header: connection label, project code.
- Table of linked transports (from issue property): Request, Type, Description, Status, actions (Refresh, Release).
- Buttons: `+ Create new ▾` (submenu Workbench/Customizing/Copy), `Link existing`.

Dialogs:

- **Create**: shows rendered Description (editable as one-off override), Target (prefilled from project default), Create button. Success → toast OK, row appears.
- **Link existing**: input Request ID → Validate calls `getTransport(id)` → shows fetched data, Confirm appends to issue property.
- **Release**: confirmation → spinner → status updates from response. Side-effect annotation in OData metadata refreshes Status and StatusText.
- **Refresh row (⟳)**: calls `getTransport(id)` and updates that row only.

## 7. Jira Automation actions

### 7.1 `Create SAP Transport`

| Input | Type | Notes |
|---|---|---|
| `type` | enum `K` \| `W` \| `T` | Required |
| `target` | string (smart value) | Optional, falls back to project default |
| `descriptionOverride` | string (smart value) | Optional, falls back to project template |
| `email` | string (smart value) | Default `{{initiator.emailAddress}}` |

Effect: creates the order, appends to issue property `sap.transports`.

### 7.2 `Release SAP Transport`

| Input | Type | Notes |
|---|---|---|
| `mode` | enum `all-linked` \| `by-id` \| `latest` | Default `all-linked` |
| `requestId` | string | Required when `mode = by-id` |
| `onlyType` | enum `K` \| `W` \| `T` \| `any` | Filter when `mode = all-linked` |

Iteration semantics: filter status ≠ "Released", release sequentially, collect per-item outcomes. The action overall succeeds if at least one release succeeds; per-item failures are reported in the smart-value output.

### 7.3 `Link Existing SAP Transport`

| Input | Type | Notes |
|---|---|---|
| `requestId` | string | Required |

Effect: validates via `getTransport(id)` and appends to issue property; fails the action if the request does not exist.

### 7.4 Output smart-values

- `{{sapTransport.requestId}}`
- `{{sapTransport.status}}`
- `{{sapTransport.statusText}}`
- `{{sapTransport.error}}` (empty when OK)

## 8. Permissions, error UX and observability

### 8.1 Per-screen permissions

| Surface | Gate |
|---|---|
| Admin page | Jira admins via `manage:jira-configuration` |
| Project settings | Project admins via `manage:jira-project` |
| Issue panel actions | `BROWSE_PROJECTS` permission plus a Jira project role "SAP Transport User". The role is registered by the app's post-install lifecycle handler (or manually created if the install hook cannot, with documentation in the README). |
| Automation actions | Run as the app actor on behalf of the rule trigger |

Passwords are never returned to the frontend; the frontend only ever sees `connectionId` references.

### 8.2 Error categories in UI

1. **Config errors** (no connection, no template) → info banner with CTA to project settings; Create button disabled.
2. **Recoverable SAP errors** (401, 4xx with `SAP__Messages`, timeout) → red toast with parsed SAP message; row not added; user can retry.
3. **Irrecoverable errors** (5xx, unparseable JSON) → toast with internal `requestId` for log correlation.

For Automation actions, the rule fails with the same parsed message in the Jira Automation audit log.

### 8.3 Logging

Structured `console.log` (Forge logs): `{ ts, projectId, issueKey, action, requestId?, durationMs, outcome, errorCode? }`. Never log passwords or auth headers. Levels: `info` (actions), `warn` (recoverable), `error` (irrecoverable).

## 9. Testing strategy

### 9.1 Pyramid

| Level | Coverage | Tools |
|---|---|---|
| Unit | `template.ts`, OData error parsing, `resolveConnection`, 60-char truncation, type mapping, `sap-client` query-param injection | Vitest |
| Integration | `sap-client.ts` against mocked OData; resolvers invoked with fake Forge events | Vitest + msw |
| Light E2E | UI Kit screens rendered in test env; smoke via `forge tunnel` | `@forge/test` |

### 9.2 Critical unit cases

- `template.ts`: table-driven cases — nested paths, missing customfields, non-scalar values, empty template falls back to default, last-space truncation, hard truncation, overflow flag.
- `sap-client.ts`: replay captured SAP responses for: Create OK, Create error with `SAP__Messages`, Release OK, Release on already-released (warning severity 2), GET 404, CSRF 403 → fetch → retry, 401.
- `resolveConnection`: precedence override > catalog > config error.
- Every request has `sap-client` query param.

### 9.3 Fixtures

`src/__tests__/fixtures/` holds JSON captures of real SAP responses (one per scenario), version-controlled without credentials.

### 9.4 Coverage

- **Global threshold ≥ 90%** for statements, branches, functions and lines, enforced in `vitest.config.ts` via `coverage.thresholds`.
- CI fails when any metric falls below 90%. HTML + lcov reports published as CI artifact.
- Exclusions (denominator): `manifest.yml`, pure barrel `index.ts` re-exports, `types.ts`, Forge-generated files.
- `template.ts` and the error-parsing branch of `sap-client.ts` must reach **100%** because they are the highest-blast-radius code paths.

### 9.5 CI

`npm run lint && npm test && forge lint`. No live SAP connection required — all SAP interaction is mocked.

## 10. Open questions deferred to implementation

None blocking. The following are decisions kept implicit and that the implementation plan should make explicit:

- Exact mapping between UI labels and SAP `Type` codes: Workbench=`K`, Customizing=`W`, Copy=`T`. Confirm during the first integration run against the user's SAP system.
- Whether Forge UI Kit (preferred) covers the live-preview interactions needed in project settings; fall back to Custom UI for that page only if UI Kit cannot render the preview reactively.
