import { describe, expect, it } from 'vitest';
import { securityHeaders } from '../../vite.config';

describe('security headers', () => {
  it('serves the exact §8 CSP', () => {
    expect(securityHeaders['Content-Security-Policy']).toBe(
      "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'",
    );
  });

  it('sets referrer and permissions policies', () => {
    expect(securityHeaders['Referrer-Policy']).toBe('no-referrer');
    expect(securityHeaders['Permissions-Policy']).toContain('camera=()');
    expect(securityHeaders['Permissions-Policy']).toContain('microphone=()');
  });
});
