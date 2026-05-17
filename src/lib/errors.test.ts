import { describe, it, expect } from 'vitest';
import { SapError, ConfigError, AuthError } from './errors';

describe('SapError', () => {
  it('carries code, message, severity and httpStatus', () => {
    const e = new SapError({ code: 'X1', message: 'boom', severity: 'error', httpStatus: 500 });
    expect(e.code).toBe('X1');
    expect(e.message).toBe('boom');
    expect(e.severity).toBe('error');
    expect(e.httpStatus).toBe(500);
    expect(e).toBeInstanceOf(Error);
  });

  it('serialises to plain object for transport to frontend', () => {
    const e = new SapError({ code: 'X1', message: 'boom', severity: 'warning' });
    expect(e.toJSON()).toEqual({ code: 'X1', message: 'boom', severity: 'warning', target: undefined, httpStatus: undefined });
  });
});

describe('ConfigError', () => {
  it('is an Error subclass with a message', () => {
    const e = new ConfigError('no connection');
    expect(e.message).toBe('no connection');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('AuthError', () => {
  it('extends SapError with severity=error and httpStatus=401', () => {
    const e = new AuthError('bad creds');
    expect(e).toBeInstanceOf(SapError);
    expect(e.severity).toBe('error');
    expect(e.httpStatus).toBe(401);
  });
});
