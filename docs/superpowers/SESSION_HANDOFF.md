# Session Handoff — Jira–SAP Transport Connector

**Date:** 2026-05-19
**Last branch:** `feature/sap-system-id-and-adt-link` (PR #11 open)
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

## Currently open PR — #11 `feature/sap-system-id-and-adt-link`

**Goal:** Add 3-char SAP System ID (SID) to Connection. Render the Request ID in the issue panel as a clickable link that opens Eclipse ADT via the `adt://` custom protocol.

**Commits in the branch (latest first):**
1. `51ed840` — Use `window.open()` instead of `router.open()` (still doesn't work, see Blocker)
2. `c97436e` — Use `router.open()` instead of `<Link>` (rejected too)
3. `589bc36` — Backfill systemId on existing entries via refresh/release/link
4. `9a6f1a1` — Deep-link the Request ID to Eclipse ADT (initial `<Link href>` attempt)
5. `7f776e0` — Add 3-char SAP System ID (SID) to Connection

**Tests:** 206/206 passing locally. Coverage 98.36/90.19/98.13/99.28. `forge lint` clean.

### 🔴 Functional blocker on PR #11 (resume here)

The Eclipse ADT link button renders but clicking **does nothing in production**. After three attempts:

| Attempt | Why it failed |
|---|---|
| `<Link href="adt://...">` from `@forge/react` | UI Kit 2's `Link` sanitises non-http(s) hrefs and strips the URL |
| `<Button onClick={() => router.open(url)}>` | Atlassian's parent frame ALSO sanitises non-http schemes before navigating |
| `<Button onClick={() => window.open(url, '_blank')}>` | onClick handlers in UI Kit 2 `render: native` run in a sandboxed Forge worker without real DOM access; `window.open` either no-ops or targets a hidden worker window |

**Root cause:** UI Kit 2 with `render: native` runs event handlers in a sandboxed Forge runtime (Node-like worker), and the only navigation channel back to the user's browser is via `@forge/bridge` (`router.open`, `view.*`) — all of which sanitise non-http schemes.

**Decision (already made with the user):** Migrate ONLY the issue panel (`src/frontend/issue-panel.tsx`) to **Custom UI**. Custom UI gives a full iframe with real DOM, where `<a href="adt://..." target="_blank">` works natively. The admin page and project-settings stay on UI Kit 2.

---

## What needs to happen next (the new session's job)

### Migrate `jira:issuePanel` to Custom UI

#### 1. Build pipeline

- Install Vite + `@vitejs/plugin-react` as devDeps (Forge's recommended bundler for Custom UI)
- Create `static/issue-panel/` with:
  - `package.json` (or use root scripts) — script that runs `vite build` for this app
  - `vite.config.ts` — config that outputs to `static/issue-panel/build/`
  - `index.html` — minimal HTML shell that loads the bundled JS
  - `src/index.tsx` — React entry point
  - `src/App.tsx` — port of the current `src/frontend/issue-panel.tsx`
- Add a root `package.json` script `"build:issue-panel": "vite build --config static/issue-panel/vite.config.ts"`
- Add it to `lint`/`test:coverage` flow as appropriate
- `forge deploy` needs to pick up the built directory — verify that the manifest path points there

#### 2. Component swaps

Custom UI cannot use `@forge/react`'s UI Kit 2 components (they're server-rendered blueprints). Replace with:

| UI Kit 2 (`@forge/react`) | Custom UI replacement |
|---|---|
| `Button`, `ButtonGroup` | `@atlaskit/button` (the v5 "new" one) |
| `DynamicTable` | `@atlaskit/dynamic-table` |
| `Modal`, `ModalHeader`, etc. | `@atlaskit/modal-dialog` |
| `Textfield` | `@atlaskit/textfield` |
| `Text`, `Heading`, `Stack`, `Inline` | plain HTML + Atlaskit `@atlaskit/heading` for headings |
| `SectionMessage` | `@atlaskit/section-message` |

The Request-ID link becomes a real:
```tsx
<a
  href={`adt://${entry.systemId}/sap/bc/adt/cts/transportrequests/${entry.requestId}`}
  target="_blank"
  rel="noopener noreferrer"
>
  {entry.requestId}
</a>
```

This works in Custom UI's iframe — the OS hands off the `adt://` URL to Eclipse exactly like a manual paste.

#### 3. Bridge usage stays the same

`@forge/bridge` works in both Custom UI and UI Kit 2. Keep:
- `invoke('issue.list' | 'issue.create' | 'issue.release' | 'issue.refresh' | 'issue.link', ...)`
- `view.getContext()`

#### 4. Manifest changes

Change `manifest.yml` `jira:issuePanel`:

```yaml
jira:issuePanel:
  - key: sap-issue-panel
    title: SAP Transport
    icon: https://developer.atlassian.com/platform/forge/images/icons/issue-panel-icon.svg
    resource: issue-panel-ui
    # REMOVE: render: native
    # REMOVE: resolver: function: resolver  (or keep — Custom UI can still talk to resolvers)
    resolver:
      function: resolver
```

And change the `resources` entry:

```yaml
resources:
  - key: issue-panel-ui
    path: static/issue-panel/build   # directory, not a .tsx file
```

#### 5. Tests

- Delete or move `src/frontend/issue-panel.test.tsx`
- Create new tests in `static/issue-panel/src/App.test.tsx` (or similar)
- Use vitest + jsdom + testing-library/react — same stack
- @atlaskit components are real React — no mocking needed beyond `@forge/bridge`
- The ADT link test now just asserts an `<a>` exists with the right href — no need to spy on `window.open` or `router.open`
- Update `vitest.config.ts` `coverage.include` to add `static/issue-panel/src/**/*.{ts,tsx}`

#### 6. Lockfile

After installing new deps, regenerate inside the Linux container (this has bitten us 3 times):
```bash
docker run --rm -v "C:\Users\jaime\projects\jira-abap-connector:/app" -w /app node:20 \
  bash -c "npm install --package-lock-only --include=optional --no-audit --no-fund"
```
(use `MSYS_NO_PATHCONV=1` prefix from MSYS bash)

#### 7. Verify and push

- `npm run lint` — exit 0
- `npm run build:issue-panel` — produces `static/issue-panel/build/index.html` + bundled JS
- `npm test` — all green
- `npm run test:coverage` — ≥90% on all four metrics
- `npx @forge/cli lint` — clean
- Push to the SAME branch `feature/sap-system-id-and-adt-link` so PR #11 picks up the commits

---

## Recurring gotchas to be aware of

1. **Lockfile must be Linux-generated** for `npm ci` in CI to work. Use the docker command above. Symptom: `npm error Missing: @emnapi/core@1.10.0 from lock file`.

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
- Reuse the stored password when editing a connection with an empty password field (already done in PR #9 — verify still working after the issue-panel migration).
- Extract a `STATUS_RELEASED = 'R'` constant instead of the magic char in `automation.ts` and `issue-panel.tsx`.
- Decide automation `release` smart-value contract: arrays vs `sapTransport.*` projection.
- Forge Remote `configurable` upgrade: when Atlassian moves the EAP to GA, revisit PR #7's design (25 slots) and migrate back from static egress patterns to per-customer configurable remotes.

---

## State of the code at handoff

The user said the click button visually appears in the panel but does nothing. We're mid-iteration on PR #11. **Don't merge PR #11 in its current state** — the ADT link doesn't work yet. The Custom UI migration is the fix.
