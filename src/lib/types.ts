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
