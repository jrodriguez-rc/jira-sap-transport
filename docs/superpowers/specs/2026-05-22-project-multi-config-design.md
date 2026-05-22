# Project multi-config — Design

**Date:** 2026-05-22
**Author:** Brainstormed with Jaime Rodríguez (jrodriguez@resultoconsultoria.com)
**Status:** Approved — ready for implementation plan

---

## 1. Goal

Today a Jira project has **one** SAP transport configuration: a single project code, a single default type (`K`/`W`/`T`), and a single default target. The issue panel exposes three hardcoded buttons — `+ Workbench`, `+ Customizing`, `+ Copy` — and every transport is created against that single configuration.

Real teams need to create transports for different combinations in the same project, for example:

- "Órdenes de workbench de **ZPROJ** proyecto a **QAS** destino"
- "Órdenes de customizing de **ZPROJ** proyecto a **PRD** destino"

We redesign the project configuration to hold an arbitrary list of transport configurations, each with its own label, type, target, and project code. The issue panel renders one button per configuration. The Jira automation action selects a configuration by its label.

---

## 2. Scope decisions

| Question | Decision |
|---|---|
| What stays project-level vs per-config? | **Project-level:** SAP connection (catalog or override), description template. **Per-config:** label, type, target, projectCode. |
| Migration of existing projects | Hard cutover — no automated migration. Legacy fields are dropped silently on read. Admins re-enter what they need inside the new configs. |
| Automation action API | `create-sap-transport` swaps `type + target` inputs for a single `configLabel` (case-sensitive exact match). |
| Project-settings UX | Two top sections (Connection, Description template) with a single "Save settings" button; bottom section is a CRUD table for configs with "Add" / "Edit" / "Delete" via modal. |
| Issue-panel UX | One button per config, label = config's `label`, with a `+` prefix in the button text (e.g. `+ Workbench QAS`). "Link existing" stays. |

---

## 3. Data model

### 3.1 New / changed types — `src/lib/types.ts`

```ts
export type TransportType = 'K' | 'W' | 'T';   // unchanged

export interface TransportConfig {
  id: string;                  // internal uuid, never shown in UI nor in automation
  label: string;               // unique per project, shown as button text
  type: TransportType;
  target: string;              // e.g. 'PRD', 'QAS'
  projectCode: string;
}

export interface ProjectConfig {
  connectionId?: string;
  connectionOverride?: Connection;
  descriptionTemplate: string;
  configs: TransportConfig[];
}
```

**Removed from `ProjectConfig`:** the top-level `projectCode` field and the `defaults: { type, target? }` object. Each `TransportConfig` carries its own.

`Connection`, `ConnectionPublic`, `SapTransportEntry`, `RenderResult`, `RequestType`, `SapMessage`, `SapClientCallContext` are unchanged.

### 3.2 Validation (enforced server-side in resolvers)

| Field | Rule |
|---|---|
| `label` | Non-empty; ≤ 50 chars; unique within the project's `configs[]` (case-sensitive). |
| `type` | Must be one of `K`, `W`, `T`. |
| `target` | Non-empty. SAP target system code; we don't enforce a length or charset beyond non-empty (existing connections allow any SAP-side target). |
| `projectCode` | Non-empty. |

Validation errors are thrown as plain `Error` instances; `bridgeSafe` converts them to `{ ok: false, error: { code, message, ... } }` for the frontend.

For the special case of "label already exists in this project", the error message includes the offending label so the modal can show it inline.

---

## 4. Storage

Storage layer (`src/lib/storage.ts`) does **not** change structurally. The project document continues to live under a single KVS key:

```
project:<projectId>:config   →   ProjectConfig (one document holding everything)
```

All CRUD on the `configs[]` array happens via read-modify-write on this one key. No new key prefixes, no new query patterns.

**Atomicity:** the project-settings page is single-admin in practice. `kvs.get → mutate → kvs.set` is not formally atomic but the race is irrelevant for this UX. Documented as accepted risk.

**`normalizeProjectConfig`** is a new helper used inside `getProjectConfigResolver` to coerce any legacy document into the new shape (see §7).

---

## 5. Resolver API

`src/index.ts` wires these via `bridgeSafe` (same pattern as today). The old `project.saveConfig` registration is removed — hard cutover.

| Resolver | Payload | Behaviour |
|---|---|---|
| `project.getConfig` | `{ projectId }` | Returns `ProjectConfig` (normalized — see §7) or `undefined` if the project has never been saved. |
| `project.saveSettings` | `{ projectId, settings: { connectionId?, connectionOverride?, descriptionTemplate } }` | Writes **only** the project-level fields. Preserves `configs[]` untouched. If the document does not exist, creates one with `configs: []`. |
| `project.config.add` | `{ projectId, config: { label, type, target, projectCode } }` | Assigns `id = 'cfg-' + Date.now() + '-' + random6`, validates, appends to `configs[]`, persists, returns `{ id }`. |
| `project.config.update` | `{ projectId, configId, patch }` | Locates by `id`, re-validates including label-uniqueness against the rest of the array, applies patch, persists. Throws `ConfigError` if `configId` not found. |
| `project.config.delete` | `{ projectId, configId }` | Removes the matching entry. Idempotent — no error if `configId` is not present. |
| `project.previewTemplate` | `{ template, sampleContext }` | Unchanged. |

### 5.1 `issue.create` resolver (panel-facing)

Input shape changes:

```ts
// Before
{ projectId, issueKey, type, descriptionOverride?, target?, emailOverride? }

// After
{ projectId, issueKey, configId, descriptionOverride?, emailOverride? }
```

The handler loads the project, finds `configs.find(c => c.id === configId)`, throws `ConfigError` if not found, then delegates to the shared `createTransportFromConfig` (§6).

`target` is no longer accepted as a per-call override (see §8.3).

### 5.2 `automation.create` action handler (rule-facing)

Input shape changes:

```ts
// Before
{ projectId, issueKey, type, target, email }

// After
{ projectId, issueKey, configLabel, email }
```

The handler loads the project, finds `configs.find(c => c.label === configLabel)`, and on miss throws a `ConfigError` whose message lists the available labels (so the admin in the Jira automation editor sees what they should have typed):

```
No transport configuration with label "Workbench DEV" in this project.
Available: "Workbench QAS", "Customizing PRD"
```

`release-sap-transport` and `link-sap-transport` are **unchanged** — their inputs (`requestId`, `onlyType`, `mode`) don't depend on the project config structure.

### 5.3 Shared helper

`src/handlers/issue-actions.ts` extracts the common transport-creation logic out of `createTransportResolver`:

```ts
async function createTransportFromConfig(args: {
  projectId: string;
  issueKey: string;
  config: TransportConfig;
  descriptionOverride?: string;
  emailOverride?: string;
}): Promise<SapTransportEntry>
```

This is the single place that resolves the connection, computes the description template, calls the SAP client, persists the entry, and logs. Both `issue.create` (panel) and `automation.create` (automation) become thin wrappers that locate the config (by id or by label respectively) and call this function.

### 5.4 Template cascade — unchanged shape, source of `project.code` changes

The render context for `descriptionTemplate` is built the same way:

```
override > projectConfig.descriptionTemplate > connection.descriptionTemplate > engine default
```

The render context object substitutes one field:

```ts
// Before
const renderCtx = { issue, project: { code: cfg.projectCode }, user, date };
// After
const renderCtx = { issue, project: { code: args.config.projectCode }, user, date };
```

i.e. `project.code` in smart-values now resolves to the per-config code, not a project-level one.

---

## 6. Manifest changes — `manifest.yml`

Only the `create-sap-transport` action changes. The two other automation actions, all resources, all permissions, and all modules are unchanged.

```yaml
- key: create-sap-transport
  name: Create SAP Transport
  description: Create an SAP transport request and link it to the Jira issue.
  function: automation-create
  actionVerb: CREATE
  config:
    resource: automation-create-ui
    render: native
  inputs:
    projectId:
      title: Project ID
      description: Jira project ID
      type: string
    issueKey:
      title: Issue key
      description: Jira issue key (e.g. PROJ-1)
      type: string
    configLabel:                                       # NEW (replaces `type` and `target`)
      title: Config label
      description: Exact, case-sensitive label of the project's transport configuration to use
      type: string
    email:
      title: Owner email
      description: Email of the SAP transport owner
      type: string
  outputContext: { ... unchanged ... }
  outputs:       { ... unchanged ... }
```

---

## 7. Migration — hard cutover

No data migration script. No code path tries to lift `projectCode` / `defaults` from a legacy document into the new `configs[]`. The decision is explicit: admins re-enter what they want inside the new configs.

What *is* implemented is a forward-compatible **read normalization**, so a project that was last saved before this deploy doesn't crash the resolver.

```ts
// Inside getProjectConfigResolver
function normalizeProjectConfig(doc: unknown): ProjectConfig | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const d = doc as Record<string, unknown>;
  return {
    connectionId: typeof d.connectionId === 'string' ? d.connectionId : undefined,
    connectionOverride: (d.connectionOverride && typeof d.connectionOverride === 'object')
      ? (d.connectionOverride as Connection)
      : undefined,
    descriptionTemplate: typeof d.descriptionTemplate === 'string' ? d.descriptionTemplate : '',
    configs: Array.isArray(d.configs) ? (d.configs as TransportConfig[]) : [],
  };
}
```

Behaviour for a legacy doc:

| Legacy field | Result |
|---|---|
| `connectionId` / `connectionOverride` | Kept (same name in new shape). |
| `descriptionTemplate` | Kept (same name in new shape). |
| `projectCode` (top-level) | Silently dropped. |
| `defaults: { type, target }` | Silently dropped. |
| no `configs` key | Coerced to `[]`. |

Effect for the admin of a legacy project: opens project-settings, sees their connection and template intact, finds the configs table empty, and creates new configs. The dropped legacy fields physically disappear from KVS as soon as that project does its next Save (because we re-serialise the full normalised document).

No background job is required.

---

## 8. Frontend changes

### 8.1 `src/frontend/project-settings.tsx` — UI Kit 2 (stays)

Layout reorganised into three vertical sections:

```
Heading: SAP Transport — Project Settings

╔══ SAP Connection ════════════════════════╗
║  Catalog | Override (radio)              ║
║  <Select picker | override form>         ║
╚══════════════════════════════════════════╝

╔══ Description template ══════════════════╗
║  [SmartValuesPicker]                     ║
║  <TextArea>                              ║
║  Preview: "PRJ-1 Sample summary" (24/60) ║
╚══════════════════════════════════════════╝

[ Save settings ]    ← persists the two sections above
                       via project.saveSettings

╔══ Transport configurations ══════════════╗
║                          [ + Add config ]║
║  ┌────────────────┬──────┬──────┬───────┐║
║  │ Label          │ Type │ Tgt  │ Code  │║   …+ Edit / Delete per row
║  ├────────────────┼──────┼──────┼───────┤║
║  │ Workbench QAS  │  K   │ QAS  │ ZPROJ │║
║  │ Customizing PRD│  W   │ PRD  │ ZPROJ │║
║  └────────────────┴──────┴──────┴───────┘║
║  (empty) "No configurations yet — click  ║
║          + Add config to define one."    ║
╚══════════════════════════════════════════╝
```

**Add / Edit modal — four fields:**

- `Label` — Textfield; client-side validates non-empty and `length ≤ 50`.
- `Type` — Select with options Workbench / Customizing / Copy.
- `Target` — Textfield.
- `Project code` — Textfield.
- `[Save] [Cancel]`.

**Per-action flow:**

| Trigger | Resolver call | Post-action |
|---|---|---|
| `+ Add config` Save | `project.config.add` | Close modal, refresh table from resolver result. |
| `Edit` Save | `project.config.update` | Close modal, refresh table. |
| `Delete` (confirm) | `project.config.delete` | Refresh table. |
| `Save settings` | `project.saveSettings` | Toast/banner "Saved". |

If `project.config.add` / `update` returns `ok: false` with a label-uniqueness error, the modal stays open and shows the error inline.

### 8.2 `static/issue-panel/src/App.tsx` — Custom UI (stays)

On mount, in addition to the current `issue.list`, also load the project configs:

```ts
const projectCfg = await invoke<ResolverResult<ProjectConfig>>('project.getConfig', { projectId });
setConfigs(projectCfg.ok ? projectCfg.data?.configs ?? [] : []);
```

The three hardcoded buttons are removed. In their place: one Atlaskit `Button` per config, with `appearance="default"`, `spacing="compact"`, `children = '+ ' + config.label`. They flex-wrap so several fit on one row. `Link existing` stays as-is.

```
┌─────────────────────────────────────────────────────────────┐
│ SAP Transport                                               │
│                                                             │
│ <existing transport table — unchanged>                      │
│                                                             │
│ [+ Workbench QAS] [+ Customizing PRD] [Link existing]       │
│                                                             │
│ Opening a Request ID requires SAP ADT (Eclipse) installed.  │
└─────────────────────────────────────────────────────────────┘
```

**Empty state — no configs defined:**

```
[Link existing]

⚠ Ask a project admin to add a transport configuration
   in project settings before creating new requests.
```

`Link existing` always stays — it only needs a `requestId` of a transport that already exists in SAP, independent of project configs.

**Create modal** opens on click of a `+` button:

- Title: `Create {config.label}` (e.g. `Create Workbench QAS`).
- One field: `Description override` (optional).
- Submit calls `invoke('issue.create', { projectId, issueKey, configId: config.id, descriptionOverride })`.
- `[Create] [Cancel]`.

### 8.3 Removed UI / inputs

- `+ Workbench`, `+ Customizing`, `+ Copy` hardcoded buttons in the issue panel.
- `Target` field in the Create modal. Was a per-call target override; with per-config target the right action for a one-off different target is to create a new config. Confirmed with user.
- `project.saveConfig` resolver registration in `src/index.ts`.

---

## 9. Test strategy

Coverage gate stays at ≥90% on the four metrics. Current branch coverage (90.65%) leaves little headroom; the rewrites must include focused tests for every new branch (validation, label uniqueness, configId-not-found, normalize-on-read of a legacy doc).

| File | Treatment |
|---|---|
| `src/handlers/project-config.test.ts` | **Rewrite.** New cases per resolver: happy path, validation (label duplicated, type invalid, target/projectCode empty), normalize-on-read of a legacy document, idempotency of delete. |
| `src/handlers/issue-actions.test.ts` | **Adapt.** New cases: configId not found → error, `project.code` in render context comes from the matched config (not from a project-level field). All release/refresh/link/list cases unchanged. |
| `src/handlers/automation.test.ts` | **Adapt.** New cases: configLabel exact match (success), label not found → error message lists available labels, case-sensitivity. |
| `src/lib/storage.test.ts` | Unchanged. |
| `src/frontend/project-settings.test.tsx` | **Rewrite.** Cover: empty/populated table render, Add → modal → save → table refresh, Edit pre-fills modal values, Delete confirms + removes, Save settings persists only project-level, duplicate label surfaces an inline banner in the modal. |
| `static/issue-panel/src/App.test.tsx` | **Adapt.** Replace the six tests bound to the three hardcoded buttons with: render N buttons from N configs, empty-state message, click on `+ Workbench QAS` opens modal titled accordingly, modal submit calls `issue.create` with `configId`. Drop the modal-target-override test. |
| `manifest.yml` | No automated test; covered by `npx @forge/cli lint`. |

Existing `bridgeSafe` error-mapping is reused; we don't add a new error path code.

---

## 10. Out of scope

Explicitly **not** part of this design — to be evaluated later if needed:

- Reordering configs (drag-drop). Sort is alphabetical by `label`.
- Per-config description template override. Template stays project-level.
- Per-config SAP connection override. Connection stays project-level.
- Per-config `isDefault` flag. There is no "default config" concept; the issue panel just lists what exists.
- Carrying legacy `projectCode` / `defaults` into the new shape automatically.
- A migration UI shown to the admin on first open after upgrade.

---

## 11. Risk register

| Risk | Mitigation |
|---|---|
| Admin renames a config that's referenced by a live Jira Automation rule (which matches by `configLabel`). The rule silently stops firing. | Error message from `automation.create` lists available labels — first failed run surfaces the typo. Documented in handoff gotchas for admins. |
| Read-modify-write race in `project.config.*` if two admins edit at the same instant. | Accepted: admin UI is single-user in practice. Not worth adding optimistic concurrency. |
| Coverage drop below 90% during the rewrite. | Add focused branch tests as part of each task in the implementation plan. |
| User of a legacy project opens project-settings and is confused that their `projectCode` / `defaults` are gone. | Documented in handoff. No code mitigation — this is the cost of the chosen "hard cutover" path. |

---

## 12. Acceptance criteria

- `ProjectConfig.configs[]` is the single source of transport configurations for a project.
- The project-settings page renders the table + modal CRUD; a single "Save settings" button persists connection + description template.
- The issue panel renders one `+ <label>` button per config and a `Link existing` button; clicking a config button opens a modal with only `Description override` and a Create button.
- An empty `configs[]` shows the empty state without a console error.
- The Jira automation action `create-sap-transport` accepts `configLabel` instead of `type` + `target`; bad label produces an error message that lists valid labels.
- A project whose KVS document is in legacy shape can be opened and saved without errors; the legacy `projectCode` / `defaults` fields are dropped on the next save.
- `npm run lint`, `npm test`, `npm run test:coverage` (≥90% all four metrics), `npm run build:issue-panel`, and `npx @forge/cli lint` all pass.
