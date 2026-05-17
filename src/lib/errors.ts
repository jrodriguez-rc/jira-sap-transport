export type SapErrorSeverity = 'info' | 'warning' | 'error';

export interface SapErrorJSON {
  code: string;
  message: string;
  severity: SapErrorSeverity;
  target?: string;
  httpStatus?: number;
}

export class SapError extends Error {
  readonly code: string;
  readonly severity: SapErrorSeverity;
  readonly target?: string;
  readonly httpStatus?: number;

  constructor(input: { code: string; message: string; severity: SapErrorSeverity; target?: string; httpStatus?: number }) {
    super(input.message);
    this.name = 'SapError';
    this.code = input.code;
    this.severity = input.severity;
    this.target = input.target;
    this.httpStatus = input.httpStatus;
  }

  toJSON(): SapErrorJSON {
    return {
      code: this.code,
      message: this.message,
      severity: this.severity,
      target: this.target,
      httpStatus: this.httpStatus
    };
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class AuthError extends SapError {
  constructor(message: string) {
    super({ code: 'AUTH', message, severity: 'error', httpStatus: 401 });
    this.name = 'AuthError';
  }
}
