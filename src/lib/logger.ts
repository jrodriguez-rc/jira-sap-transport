// src/lib/logger.ts

export type LogLevel = 'info' | 'warn' | 'error';

const REDACT_KEYS = new Set(['password', 'Authorization', 'authorization']);

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k) ? '[REDACTED]' : redact(v);
  }
  return out;
}

export function logEvent(level: LogLevel, fields: Record<string, unknown>): void {
  const payload = { ts: new Date().toISOString(), level, ...(redact(fields) as Record<string, unknown>) };
  const line = JSON.stringify(payload);
  switch (level) {
    case 'info':  console.log(line); break;
    case 'warn':  console.warn(line); break;
    case 'error': console.error(line); break;
  }
}
