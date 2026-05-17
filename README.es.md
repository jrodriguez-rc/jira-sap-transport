# Jira–SAP Transport Connector

***Español** · [English](./README.md)*

App de Forge que crea, vincula y libera órdenes de transporte de SAP desde incidencias Jira y reglas de Jira Automation.

## Desarrollo

```
npm install
npm run lint
npm test
npm run test:coverage
```

## Despliegue (primera vez)

```
npx forge login
npx forge create   # acepta el prompt y copia el id generado a manifest.yml
npx forge deploy
npx forge install --site <tu-site>.atlassian.net --product jira
```

## Configuración

1. Como administrador de Jira, abre `Apps → Administrar apps → SAP Transport — Connections` y añade al menos una conexión (hostname `https://…`, mandante `100`, usuario, password). Pulsa `Test connection`.
2. Como administrador del proyecto, abre `Configuración del proyecto → SAP Transport` y elige una conexión (o un override), establece un código de proyecto, el tipo/target por defecto y la plantilla de Description. Guarda.
3. Abre cualquier incidencia. El panel `SAP Transport` ofrece Crear / Vincular / Liberar / Refrescar.
4. Para Automation: construye una regla en la UI de Jira, elige el trigger que prefieras y añade la acción `Create SAP Transport`, `Release SAP Transport` o `Link Existing SAP Transport`.

## Arquitectura

Consulta `docs/superpowers/specs/2026-05-17-jira-sap-transport-connector-design.es.md` (diseño en español) o `2026-05-17-jira-sap-transport-connector-design.md` (inglés), y el plan de implementación en `docs/superpowers/plans/2026-05-17-jira-sap-transport-connector-implementation.md`.
