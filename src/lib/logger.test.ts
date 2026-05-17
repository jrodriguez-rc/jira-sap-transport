import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logEvent } from './logger';

describe('logEvent', () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  beforeEach(() => { spy.mockClear(); });
  afterEach(() => { spy.mockClear(); });

  it('emits a JSON line with the supplied fields plus a timestamp', () => {
    logEvent('info', { action: 'create', issueKey: 'PROJ-1', outcome: 'ok' });
    expect(spy).toHaveBeenCalledOnce();
    const line = spy.mock.calls[0][0] as string;
    const obj = JSON.parse(line);
    expect(obj.level).toBe('info');
    expect(obj.action).toBe('create');
    expect(obj.issueKey).toBe('PROJ-1');
    expect(obj.outcome).toBe('ok');
    expect(typeof obj.ts).toBe('string');
  });

  it('never serialises a password field — redacts it if present', () => {
    logEvent('info', { action: 'x', password: 'leak', headers: { Authorization: 'Basic abc' } });
    const obj = JSON.parse(spy.mock.calls[0][0] as string);
    expect(obj.password).toBe('[REDACTED]');
    expect(obj.headers.Authorization).toBe('[REDACTED]');
  });

  it('routes warn level to console.warn and error to console.error', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logEvent('warn', { action: 'a' });
    logEvent('error', { action: 'b' });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});
