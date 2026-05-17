# Jira ↔ SAP Transport Connector — Diseño

***Español** · [English](./2026-05-17-jira-sap-transport-connector-design.md)*

**Fecha:** 2026-05-17
**Estado:** Borrador para revisión
**Plataforma:** Atlassian Forge (Jira Cloud)

## 1. Propósito

Una app de Forge que permite a los usuarios de Jira **crear, vincular y liberar órdenes de transporte SAP** directamente desde una incidencia Jira, y que permite a las reglas de Jira Automation ejecutar las mismas operaciones programáticamente (por ejemplo: liberar órdenes cuando una incidencia pasa a "Done").

La app habla con un servicio OData v4 custom de SAP:

```
{hostname}/sap/opu/odata4/sap/zjira_api_transportrequest_o4/srvd_a2x/sap/zjira_api_transportrequest_o4/0001/?sap-client={client}
```

Superficie del servicio utilizada (ver `$metadata` adjunto):

- `EntitySet Request` de `RequestType` (sólo lectura mediante CRUD estándar)
- Acción `Create(Description, Type, Email, Target) → RequestType` (enlazada a la colección). `Email` es una personalización del campo estándar `Owner`: SAP mapea internamente el email del usuario Jira a su usuario SAP.
- Acción `Release()` enlazada a una instancia de `RequestType`
- `SAP__Messages` (colección de `SAP__Message`) devuelta con cada entidad

## 2. Objetivos / No-objetivos

**Objetivos**

- Configuración por proyecto: conexión SAP, código de proyecto, valores por defecto y plantilla de Description.
- Panel del issue: lista de órdenes vinculadas, crear (workbench/customizing/copia), vincular existente, liberar, refrescar estado.
- Acciones de Jira Automation: Crear, Liberar, Vincular.
- Varias órdenes por incidencia.
- Sintaxis de plantilla libre con acceso completo a campos Jira (incluyendo customfields).

**No-objetivos**

- Sincronización bidireccional de objetos SAP arbitrarios (solo órdenes de transporte).
- Reemplazar las herramientas de transporte SAP (SE09/SE10) — somos una capa fina de orquestación.
- Tablas de mapeo usuario-Jira → usuario-SAP (el servicio OData lo gestiona internamente a partir del email de Jira).
- Exponer el contenido de las órdenes (los objetos dentro de la orden).

## 3. Arquitectura

### 3.1 Distribución de módulos

```
forge-app/
├── manifest.yml
└── src/
    ├── frontend/
    │   ├── admin-page.tsx          # Catálogo global de conexiones SAP
    │   ├── project-settings.tsx    # Configuración por proyecto
    │   └── issue-panel.tsx         # Acciones por issue
    ├── handlers/
    │   ├── connections.ts          # Resolvers CRUD del catálogo
    │   ├── project-config.ts       # Resolvers CRUD de configuración de proyecto
    │   ├── issue-actions.ts        # Resolvers Crear / Vincular / Liberar / Refrescar
    │   └── automation.ts           # Handlers de las acciones de Jira Automation
    ├── lib/
    │   ├── sap-client.ts           # Cliente OData v4 (fetch + auth + CSRF)
    │   ├── template.ts             # Motor de plantilla de Description
    │   ├── storage.ts              # Wrappers tipados sobre Forge storage
    │   └── types.ts
    └── __tests__/
        └── fixtures/               # Respuestas SAP capturadas
```

### 3.2 Módulos Forge (`manifest.yml`)

| Módulo | Propósito |
|---|---|
| `jira:adminPage` | Catálogo global de conexiones SAP |
| `jira:projectSettingsPage` | Configuración por proyecto |
| `jira:issuePanel` | Panel del issue con acciones |
| `jira:jiraAutomationAction` × 3 | `create-sap-transport`, `release-sap-transport`, `link-sap-transport` |
| `function` (varios) | Resolvers de frontend y handlers de automation |

### 3.3 Permisos / scopes

- `read:jira-work`, `read:jira-user` — leer issues y usuarios (para resolución de plantilla y email del usuario).
- `manage:jira-configuration` — proteger la página de admin.
- `manage:jira-project` — proteger la página de configuración de proyecto.
- `storage:app` — persistir catálogo y configuración de proyecto.
- `external.fetch.backend: ["https://*"]` (en producción se restringe a los hostnames SAP registrados).

### 3.4 Distribución del storage

El storage de Forge está cifrado en reposo. Tres buckets lógicos:

| Clave / scope | Forma | Notas |
|---|---|---|
| `connections:<id>` (app) | `{ id, label, hostname, client, username, password }` | `client` es el mandante SAP (string de 3 chars). El `password` nunca viaja al frontend. |
| `project:<projectId>:config` (app) | `{ connectionId?, connectionOverride?, projectCode, descriptionTemplate, defaults: { type, target? } }` | El override gana sobre el catálogo. |
| Propiedad de issue `sap.transports` (issue) | `Array<{ requestId, type, target, description, createdAt, status, statusText, releasedAt? }>` | Un issue → varias órdenes. |

## 4. Cliente SAP OData (`sap-client.ts`)

### 4.1 Resolución de conexión

```
resolveConnection(projectId):
  cfg = storage.get(`project:${projectId}:config`)
  if cfg.connectionOverride: return cfg.connectionOverride
  if cfg.connectionId:       return catalog.get(cfg.connectionId)
  throw ConfigError("No SAP connection configured for project")
```

### 4.2 Superficie pública

```ts
type SapClient = {
  createTransport(input: {
    description: string;        // texto ya truncado (ver §5.4); sap-client valida ≤60 y lanza error si se excede
    type: 'K' | 'W' | 'T';      // K=Workbench, W=Customizing, T=Copia
    email: string;              // email del usuario Jira
    target?: string;            // ≤10 chars
  }): Promise<RequestType>;

  releaseTransport(requestId: string): Promise<RequestType>;

  getTransport(requestId: string): Promise<RequestType>;

  testConnection(): Promise<{ ok: true } | { ok: false; error: SapError }>;
}
```

### 4.3 Endpoint y forma de las peticiones

Base: `{hostname}/sap/opu/odata4/sap/zjira_api_transportrequest_o4/srvd_a2x/sap/zjira_api_transportrequest_o4/0001`

Cada petición añade `?sap-client={client}` (el mandante de la conexión), incluso cuando la URL ya tiene una query string (en ese caso `&`).

| Operación | Método | URL | Body |
|---|---|---|---|
| Crear | POST | `/Request/SAP__self.Create?sap-client={client}` | `{ Description, Type, Email, Target? }` |
| Liberar | POST | `/Request('{id}')/SAP__self.Release?sap-client={client}` | `{}` |
| Leer | GET | `/Request('{id}')?sap-client={client}&$select=Request,Description,Owner,Type,TypeText,Target,Status,StatusText` | — |
| Test | GET | `/?sap-client={client}` | — (espera 200, `{ value: [...] }` con entrada `name == "Request"`) |

Cabeceras: `Authorization: Basic base64(user:password)`, `Accept: application/json`, `Content-Type: application/json` (en POST).

### 4.4 Gestión de CSRF

Los gateways SAP suelen requerir CSRF para métodos no seguros. El cliente implementa reintento transparente:

1. Petición POST sin token.
2. Si la respuesta es 403 con header `x-csrf-token: Required`, hace un `GET /?sap-client={client}` con `x-csrf-token: Fetch`, captura el token devuelto y la cookie de sesión `set-cookie`, y reintenta el POST con `x-csrf-token: <token>` y la cookie.
3. Cachea el token + la cookie en memoria durante la invocación del resolver.

### 4.5 Modelo de errores

```ts
type SapError = {
  code: string;
  message: string;
  target?: string;
  severity: 'info' | 'warning' | 'error';   // mapeado desde numericSeverity 1/2/3-4
  httpStatus?: number;
};
```

Reglas de parseo:

- HTTP 4xx/5xx: leer `error.message.value` y `error.details[].message` del JSON OData de error.
- Respuesta exitosa con `SAP__Messages`: exponer como `warnings: SapError[]` junto al resultado; no fallar.
- HTTP 401: clasificar como `AuthError` (subtipo) para que la UI pueda ofrecer "revisar credenciales".

## 5. Motor de plantilla de Description (`template.ts`)

### 5.1 Sintaxis

Forma única tipo Mustache: `{{ruta.con.puntos}}`.

Plantilla por defecto (cuando la configuración del proyecto tiene plantilla vacía):

```
{{issue.key}} {{issue.fields.summary}}
```

### 5.2 Contextos de resolución

| Prefijo | Origen | Ejemplos |
|---|---|---|
| `issue.*` | `GET /rest/api/3/issue/{key}` vía `api.asApp().requestJira(...)` | `issue.key`, `issue.fields.summary`, `issue.fields.issuetype.name`, `issue.fields.customfield_10001`, `issue.fields.customfield_10001.value` |
| `project.*` | Configuración del proyecto + fetch del proyecto Jira | `project.code`, `project.key`, `project.name` |
| `user.*` | Usuario Jira que actúa | `user.email`, `user.displayName`, `user.accountId` |
| `date.*` | Reloj del servidor en el momento del render | `date.iso` (YYYY-MM-DD), `date.year`, `date.month` |

### 5.3 Resolución y casos límite

- Recorrer la ruta con puntos sobre el objeto de contexto resuelto.
- Ruta inexistente → cadena vacía + `warning` en el resultado del render (no aborta).
- Valor no escalar (objeto/array) → cadena vacía + warning "non-scalar field".
- `null`/`undefined` → cadena vacía.
- Números → `String(value)`.

### 5.4 Desbordamiento de 60 chars

El campo SAP `Description` es `MaxLength=60`. El truncado es responsabilidad del **motor de plantilla**, no de `sap-client.ts`. Comportamiento:

- `template.render(template, context)` devuelve `{ text, length, warnings, truncated: boolean }` donde `text` **ya es ≤60 chars**.
- Regla de truncado: cortar en el último whitespace ≤ 60; si no hay whitespace en los primeros 60 chars, corte duro a 60.
- El truncado no es bloqueante; el preview del modal muestra `truncated: true` como warning de UI antes de que el usuario envíe.
- `sap-client.ts` impone una precondición defensiva: lanza `RangeError` si `description.length > 60`. Es una red de seguridad ante futuros llamadores que se salten el motor de plantilla; no debería dispararse en flujos normales.

## 6. Pantallas UI

### 6.1 Página de admin (catálogo)

- Tabla de conexiones con columnas: label, hostname, client, username, acciones (Test, Edit, Delete).
- Formulario Añadir/Editar: `label`, `hostname` (validar URL https), `client` (3 chars), `username`, `password` (solo escritura).
- Botón **Test connection** llama a `testConnection()` → check verde con 200 y payload esperado, en caso contrario toast rojo con el error SAP parseado.

### 6.2 Página de configuración de proyecto

- Selector de conexión: radio entre "From catalog" (dropdown) y "Override" (formulario inline igual que el de admin).
- Input de texto para el código de proyecto.
- Defaults: Type (Workbench / Customizing / Copy), Target (texto, ≤10 chars).
- Textarea de plantilla de Description + preview en vivo (issue de muestra del proyecto, selector para probar contra otra issue key). El preview muestra el texto expandido, contador `length/60`, marcador de truncado y la lista de warnings (rutas no encontradas, campos no escalares).
- Botón Save persiste en `project:<projectId>:config`.

### 6.3 Panel del issue

- Cabecera: label de la conexión, código de proyecto.
- Tabla de órdenes vinculadas (desde la propiedad del issue): Request, Type, Description, Status, acciones (Refresh, Release).
- Botones: `+ Create new ▾` (submenú Workbench/Customizing/Copia), `Link existing`.

Diálogos:

- **Crear**: muestra la Description renderizada (editable como override puntual), Target (precargado desde el default del proyecto), botón Create. Éxito → toast OK, aparece la fila.
- **Vincular existente**: input Request ID → Validate llama a `getTransport(id)` → muestra los datos recuperados, Confirm añade a la propiedad del issue.
- **Liberar**: confirmación → spinner → el estado se actualiza con la respuesta. Las anotaciones de side-effect del OData refrescan Status y StatusText.
- **Refrescar fila (⟳)**: llama a `getTransport(id)` y actualiza solo esa fila.

## 7. Acciones de Jira Automation

### 7.1 `Create SAP Transport`

| Input | Tipo | Notas |
|---|---|---|
| `type` | enum `K` \| `W` \| `T` | Requerido |
| `target` | string (smart value) | Opcional, cae al default del proyecto |
| `descriptionOverride` | string (smart value) | Opcional, cae a la plantilla del proyecto |
| `email` | string (smart value) | Default `{{initiator.emailAddress}}` |

Efecto: crea la orden, añade a la propiedad de issue `sap.transports`.

### 7.2 `Release SAP Transport`

| Input | Tipo | Notas |
|---|---|---|
| `mode` | enum `all-linked` \| `by-id` \| `latest` | Default `all-linked` |
| `requestId` | string | Requerido cuando `mode = by-id` |
| `onlyType` | enum `K` \| `W` \| `T` \| `any` | Filtro cuando `mode = all-linked` |

Semántica de iteración: filtrar status ≠ "Released", liberar secuencialmente, recoger resultados por item. La acción tiene éxito global si al menos una liberación funciona; los fallos por item se reportan en el output smart-value.

### 7.3 `Link Existing SAP Transport`

| Input | Tipo | Notas |
|---|---|---|
| `requestId` | string | Requerido |

Efecto: valida vía `getTransport(id)` y añade a la propiedad de issue; la acción falla si la orden no existe.

### 7.4 Smart-values de salida

- `{{sapTransport.requestId}}`
- `{{sapTransport.status}}`
- `{{sapTransport.statusText}}`
- `{{sapTransport.error}}` (vacío cuando OK)

## 8. Permisos, UX de errores y observabilidad

### 8.1 Permisos por pantalla

| Superficie | Gate |
|---|---|
| Página de admin | Admins de Jira vía `manage:jira-configuration` |
| Configuración de proyecto | Admins del proyecto vía `manage:jira-project` |
| Acciones del panel de issue | Permiso `BROWSE_PROJECTS` más un rol de proyecto Jira "SAP Transport User". El rol se registra mediante el lifecycle handler post-install de la app (o se crea manualmente si el hook de instalación no puede, con documentación en el README). |
| Acciones de Automation | Se ejecutan como el actor de la app en nombre del trigger de la regla |

Los passwords nunca se devuelven al frontend; el frontend solo ve referencias por `connectionId`.

### 8.2 Categorías de error en UI

1. **Errores de configuración** (sin conexión, sin plantilla) → banner informativo con CTA a la configuración de proyecto; botón Create deshabilitado.
2. **Errores SAP recuperables** (401, 4xx con `SAP__Messages`, timeout) → toast rojo con el mensaje SAP parseado; la fila no se añade; el usuario puede reintentar.
3. **Errores irrecuperables** (5xx, JSON imposible de parsear) → toast con un `requestId` interno para correlación con logs.

Para las acciones de Automation, la regla falla con el mismo mensaje parseado en el audit log de Jira Automation.

### 8.3 Logging

`console.log` estructurado (Forge logs): `{ ts, projectId, issueKey, action, requestId?, durationMs, outcome, errorCode? }`. Nunca loggear passwords ni cabeceras de autenticación. Niveles: `info` (acciones), `warn` (recuperable), `error` (irrecuperable).

## 9. Estrategia de testing

### 9.1 Pirámide

| Nivel | Cobertura | Herramientas |
|---|---|---|
| Unit | `template.ts`, parseo de errores OData, `resolveConnection`, truncado a 60 chars, mapeo de tipo, inyección del query param `sap-client` | Vitest |
| Integración | `sap-client.ts` contra OData mockeado; resolvers invocados con eventos Forge falsos | Vitest + msw |
| E2E ligero | Pantallas de UI Kit renderizadas en entorno de test; smoke vía `forge tunnel` | `@forge/test` |

### 9.2 Casos unitarios críticos

- `template.ts`: casos table-driven — rutas anidadas, customfields ausentes, valores no escalares, plantilla vacía cae al default, truncado en último espacio, truncado duro, flag de desbordamiento.
- `sap-client.ts`: replay de respuestas SAP capturadas para: Create OK, Create con error con `SAP__Messages`, Release OK, Release sobre orden ya liberada (warning severity 2), GET 404, CSRF 403 → fetch → reintento, 401.
- `resolveConnection`: precedencia override > catálogo > error de configuración.
- Cada petición lleva el query param `sap-client`.

### 9.3 Fixtures

`src/__tests__/fixtures/` guarda capturas JSON de respuestas SAP reales (una por escenario), versionadas sin credenciales.

### 9.4 Cobertura

- **Umbral global ≥ 90%** para statements, branches, functions y lines, forzado en `vitest.config.ts` vía `coverage.thresholds`.
- CI falla cuando alguna métrica baja del 90%. Reportes HTML + lcov publicados como artifact de CI.
- Exclusiones (denominador): `manifest.yml`, ficheros barrel `index.ts` de solo re-export, `types.ts`, ficheros generados por Forge.
- `template.ts` y la rama de parseo de errores de `sap-client.ts` deben llegar al **100%** porque son las rutas de código con mayor blast-radius.

### 9.5 CI

`npm run lint && npm test && forge lint`. No requiere conexión SAP real — toda la interacción SAP está mockeada.

## 10. Cuestiones abiertas diferidas a la implementación

Ninguna bloqueante. Las siguientes son decisiones que quedan implícitas y que el plan de implementación debe hacer explícitas:

- Mapeo exacto entre etiquetas de UI y códigos `Type` de SAP: Workbench=`K`, Customizing=`W`, Copia=`T`. Confirmar durante la primera ejecución de integración contra el sistema SAP del usuario.
- Si Forge UI Kit (preferido) cubre las interacciones de live-preview necesarias en la configuración de proyecto; caer a Custom UI solo para esa página si UI Kit no puede renderizar el preview reactivamente.
