# Jira–SAP Transport Connector

*[Español](./README.es.md) · **English***

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
