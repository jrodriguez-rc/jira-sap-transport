// src/lib/types.ts

export type TransportType = 'K' | 'W' | 'T';   // K=Workbench, W=Customizing, T=Copy

export interface Connection {
  id: string;
  label: string;
  slotKey: string;        // matches one of the 25 declared Forge remotes (e.g. sap-backend-1)
  client: string;         // SAP mandant, 3 chars
  username: string;
  password: string;       // never returned to frontend
}

export const SAP_SLOT_COUNT = 25;
export const SAP_SLOT_KEYS: readonly string[] = Array.from(
  { length: SAP_SLOT_COUNT },
  (_v, i) => `sap-backend-${i + 1}`
);
export function isValidSlotKey(key: string): boolean {
  return /^sap-backend-([1-9]|1\d|2[0-5])$/.test(key);
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
  slotKey: string;        // Forge remote key (e.g. sap-backend-1); admin sets URL via Atlassian UI
  client: string;
  username: string;
  password: string;
}
