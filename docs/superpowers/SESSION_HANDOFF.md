# Session Handoff — Jira–SAP Transport Connector

**Date:** 2026-05-22 (PR #12 merged)
**Repository:** https://github.com/jrodriguez-rc/jira-sap-transport
**Local path:** `C:\Users\jaime\projects\jira-abap-connector`
**Atlassian instance:** `standardised.atlassian.net` (Jira)
**Forge app id:** `ari:cloud:ecosystem::app/848cbd63-7137-4183-abe7-bf3262757e22`

---

## High-level history (PRs merged to main, in order)

| PR | Title | Highlights |
|---|---|---|
| #1 | Initial implementation | 24-task TDD plan, 169 tests, coverage gate 90% |
| #2 | Dependabot bump @forge/react → 11 + drop prismjs | Major UI Kit bump |
| #5 | UI Kit 2 frontend unit tests | +55 tests; JSDOM + testing-library; mocks of @forge/react primitives |
| #6 | vitest 4 upgrade | Branch counter is stricter in v4; added 12 tests to stay above 90% |
| #7 | Forge modern platform refactor | `storage` → `@forge/kvs`, `jira:jiraAutomationAction` → `automation:actionProvider` + `action`, `runtime: nodejs22.x`, attempted Forge Remote configurable (25 slots) |
| #8 | Roll back Forge Remote to static egress | `configurable` remotes are EAP; reverted to `permissions.external.fetch.backend` with two address patterns |
| #9 | Admin UX improvements | (a) reuse stored password on edit, (b) per-row Test action, (c) Description template at Connection level + cascade, (d) `SmartValuesPicker` (Popup with search) |
| #10 | Default Description template visible on first render + preview on initial load + email lookup via `asUser /myself` | Fixed multiple bugs that surfaced in real smoke test |
| #11 | SAP System ID + Custom UI issue panel + adt:// deep-link | Added 3-char SID to Connection. Migrated `jira:issuePanel` from UI Kit 2 to Custom UI (Vite 8 + @atlaskit/* + ReactDOM). Request ID button calls `router.open('adt://…')`. Manifest declares `permissions.external.fetch.client: - address: '*'` so Forge appends `allow-popups` to the iframe sandbox — the only pattern that does this per Atlassian docs. CI now builds the bundle before tests. Node 22 in CI (Vite 8 needs ≥20.19). |
| #12 | Multi-config project model + automation `configLabel` | Replaced the single per-project transport config (`projectCode + defaults: {type, target}` at the top level of `ProjectConfig`) with `configs: TransportConfig[]` — each entry is `{id, label, type, target?, projectCode?}`. Connection and `descriptionTemplate` stay project-level. Backend resolvers go from `project.saveConfig` to `project.saveSettings` + `project.config.add/update/delete`; `getProjectConfig` normalises legacy docs on read (hard cutover — legacy `projectCode`/`defaults` fields silently dropped). `issue.create` takes `configId`; `automation.create` action's manifest input changes from `type+target` to `configLabel` (case-sensitive exact match; miss surfaces an error listing valid labels). Both create paths share a `createTransportFromConfig` helper. Issue panel renders one `+ <label>` button per config with a simplified Create modal (only description override; target gone — define another config if you need a different target). Project-settings page reorganised into Connection / Template / Configs sections with inline CRUD via modal. `target` and `projectCode` are optional on each config — blank input is persisted as `undefined` and the SAP client / template engine fall back gracefully. Spec at `docs/superpowers/specs/2026-05-22-project-multi-config-design.md`, plan at `docs/superpowers/plans/2026-05-22-project-multi-config-implementation.md`. |

---

## What's next (entry points for a future session)

No active blockers. Pick from the Open follow-ups list below, or whatever the user prioritises.

If working on the issue panel (Custom UI):
- `static/issue-panel/src/App.tsx` is the component (~380 lines, App + CreateDialog + LinkDialog)
- `static/issue-panel/src/App.test.tsx` is the suite (23 tests)
- `npm run build:issue-panel` to produce `static/issue-panel/build/`
- The mount-effect calls `invoke('project.getConfig')` to load the configs array; render() emits one `+ <label>` button per entry plus the empty-state branch when there are none.

If working on the project-settings page (UI Kit 2):
- `src/frontend/project-settings.tsx` is the component (~370 lines, three sections + inline draft block)
- `src/frontend/project-settings.test.tsx` is the suite (16 tests)
- CRUD goes through `project.config.add/update/delete`; project-level fields through `project.saveSettings`.

If working on the backend resolvers:
- `src/handlers/project-config.ts` holds the 5 resolvers + `normalizeProjectConfig` legacy shim
- `src/handlers/issue-actions.ts` exposes `createTransportFromConfig` as the shared create path; both `issue.create` (panel) and `automation.create` (rule) delegate to it
- `src/handlers/automation.ts` has `automationCreate` looking up the config by exact-match label

For local dev iteration, consider adding a `tunnel:` block to the manifest resource (port the Vite dev server) — not done yet, the user has been running full `forge deploy` for each iteration.

## Recurring gotchas to be aware of

1. **Lockfile must be Linux-generated** for `npm ci` in CI to work. After any `npm install` on Windows, regenerate inside a Linux container:
   ```bash
   MSYS_NO_PATHCONV=1 docker run --rm -v "C:\Users\jaime\projects\jira-abap-connector:/app" -w /app node:22 \
     bash -c "npm install --package-lock-only --include=optional --no-audit --no-fund"
   ```
   Symptom when skipped: `npm error Missing: @emnapi/core@1.10.0 from lock file` in CI.

2. **`forge lint --fix` strips manifest comments.** Avoid running it; do manual fixes.

3. **`@forge/react` primitives are string-tags in jsdom.** Existing tests mock `Textfield`, `TextArea`, `RadioGroup`, `Select`, `Popup` as plain HTML. Custom UI eliminates this — use `@atlaskit/*` real components.

4. **React peer-dep conflicts** with `@atlaskit/*` are pinned via `package.json` `overrides`:
   ```json
   "overrides": {
     "react": "^18.3.1",
     "react-dom": "^18.3.1"
   }
   ```
   Keep this block intact.

5. **vitest 4 counts more branches than 1.6.** Adding code without tests will drop branch coverage; add focused tests for new branches.

6. **`@forge/cli` is invoked via `npx @forge/cli ...`** (no global install).

7. **Forge runtime is `nodejs22.x`**, TypeScript `moduleResolution: "node"` (not "Bundler" — Forge's internal tsc rejects it).

8. **Egress is restricted** to:
   - `https://*.newmethodologies.net`
   - `https://*.resultoconsultoria.com`
   
   The SAP test backend in use is `https://a4h.newmethodologies.net/`.

9. **No `git add -A`** — keeps committing the `.claude/` and `.codegraph/` directories. Use explicit file list.

10. **Commit author** in this repo:
    ```
    git -c user.email=jrodriguez@resultoconsultoria.com -c user.name="Jaime Rodriguez" commit ...
    ```

11. **🔥 `forge deploy` does NOT update the installed app when `permissions.*` changes.** Any change to `permissions.scopes` or `permissions.external.fetch.*` triggers a **major-version bump** on deploy. The installation on the site stays pinned to the previous major (shown as `Outdated app` by `forge install list`) until you explicitly run:
    ```
    npx @forge/cli install --upgrade --product Jira --site standardised.atlassian.net --environment development
    ```
    **Symptom that bit us hard in PR #11 sandbox debugging:** "I deployed the fix three times and the browser still shows the same error." The fixes were in v3/v4, but the browser was loading v2. Always before assuming a Forge fix didn't work:
    1. Run `npx @forge/cli install list` and check the `App version` column matches the latest deployed major.
    2. If `Outdated app`, run `install --upgrade`. The user has to re-accept the new permissions in the browser.

12. **ADT `adt://` deep-link from Custom UI requires `permissions.external.fetch.client: - address: '*'`.** Per [Atlassian docs](https://developer.atlassian.com/platform/forge/manifest-reference/permissions/#allow-for-popups-from-frames) this is the ONLY pattern that appends `allow-popups` + `allow-popups-to-escape-sandbox` to the iframe sandbox. Narrower patterns (`adt:*`, `https://*`, etc.) leave the sandbox locked, and every navigation path (router.open, router.navigate, plain anchor, window.open) gets blocked with `Blocked opening '…' in a new window because the request was made in a sandboxed frame whose 'allow-popups' permission is not set`. The wildcard costs only the "Runs on Atlassian" Marketplace badge — irrelevant for this app, which is already ineligible because of the SAP `backend:` egress.

---

## Open follow-ups deferred from earlier code reviews

- Strip `connectionOverride.password` in `getProjectConfigResolver` before returning to the frontend.
- Extract a `STATUS_RELEASED = 'R'` constant instead of the magic char in `automation.ts` and `issue-panel/src/App.tsx`.
- Decide automation `release` smart-value contract: arrays vs `sapTransport.*` projection.
- Forge Remote `configurable` upgrade: when Atlassian moves the EAP to GA, revisit PR #7's design (25 slots) and migrate back from static egress patterns to per-customer configurable remotes.
- project-settings.tsx: move test queries off `getAllByRole('textbox')[index]` to `data-testid` / `getByLabelText` so the test mock for `TextArea` (currently a `<div>` to avoid the role collision) becomes a normal `<textarea>` again. Same sweep should land in `static/issue-panel/src/App.test.tsx` so both UIs use the same pattern.
- project-settings.tsx: split into smaller components if it grows further (`<ConfigDraft>`, `<ConnectionOverrideForm>`, `<TransportConfigsList>` are the natural seams). Currently ~370 lines, still cohesive — defer.
- Spec doc (`docs/superpowers/specs/2026-05-22-project-multi-config-design.md`) refresh: the as-shipped behaviour relaxes `target` and `projectCode` to optional (vs the original "Non-empty" rule); doc updated in the same series of commits to stay coherent for future reference.

---

## State of the code at handoff

`main` is at PR #12 merged. Tests 247/247 green, coverage 98.09 / 90.64 / 98.94 / 99.54 (all ≥90%). `forge lint` clean (with the documented `*` egress warning, which is intentional — see gotcha #12). The multi-config issue panel works end-to-end on `standardised.atlassian.net` — admins create one or more transport configurations from project-settings, each appears as a `+ <label>` button in the issue panel, the Jira Automation action `create-sap-transport` selects a config by `configLabel`, and the ADT deep-link via `router.open('adt://…')` still opens Eclipse from the Request ID button.
