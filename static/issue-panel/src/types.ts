// Re-export the shared frontend/backend types so the Custom UI bundle is
// self-contained at its Vite root but stays in sync with the resolver.
export type {
  ProjectConfig,
  SapTransportEntry,
  TransportConfig,
  TransportType,
} from '../../../src/lib/types';
