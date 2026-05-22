// src/lib/types.ts

export type TransportType = 'K' | 'W' | 'T';   // K=Workbench, W=Customizing, T=Copy

export interface Connection {
  id: string;
  label: string;
  hostname: string;       // https URL, no trailing slash (e.g. https://sap.example.com)
  systemId: string;       // 3-char SAP System ID (SID), e.g. A4H, DEV, PRD
  client: string;         // SAP mandant, 3 chars
  username: string;
  password: string;       // never returned to frontend
  // Optional default Description template at the Connection level. The cascade
  // at render time is: project override > project config > connection > engine default.
  descriptionTemplate?: string;
}

export type ConnectionPublic = Omit<Connection, 'password'>;

export interface TransportConfig {
  id: string;                  // internal uuid; never shown in UI, never exposed in automation API
  label: string;               // unique per project; shown as the button text in the issue panel
  type: TransportType;
  // Optional. When absent, SAP picks the default target route for the
  // transport's source system; the OData createTransport call omits the
  // Target field entirely.
  target?: string;             // e.g. 'PRD', 'QAS'
  // Optional. When absent, the description template's `{{project.code}}`
  // smart-value renders empty (the template engine treats undefined as '').
  projectCode?: string;
}

export interface ProjectConfig {
  connectionId?: string;
  connectionOverride?: Connection;
  descriptionTemplate: string;
  configs: TransportConfig[];
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
  // SID of the SAP system that owns this transport. Optional for backward
  // compatibility with entries created before the field was added; the issue
  // panel falls back to plain text when absent.
  systemId?: string;
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
