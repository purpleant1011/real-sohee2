import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { ProviderId } from './registry';
import {
  hasRequiredProviderConfig,
  listProviderReadiness,
  resolveProviderReadiness,
  validateCallbackOrigin,
} from './config.server';

describe('marketing-connectors/providers/config.server', () => {
  const TEST_SECRETS = {
    googleSecret: 'SECRET_GOOGLE_CLIENT_KEY_12345',
    googleTokenKey: 'SECRET_GOOGLE_ENCRYPTION_KEY_99999',
    microsoftSecret: 'SECRET_MS_CLIENT_KEY_54321',
    microsoftTokenKey: 'SECRET_MS_ENCRYPTION_KEY_88888',
  };

  const FULL_VALID_ENV: Readonly<Record<string, string | undefined>> = {
    MARKETING_GOOGLE_CLIENT_ID: 'google-client-id-abc',
    MARKETING_GOOGLE_CLIENT_SECRET: TEST_SECRETS.googleSecret,
    MARKETING_CONNECTOR_TOKEN_KEY: TEST_SECRETS.googleTokenKey,
    MARKETING_MICROSOFT_CLIENT_ID: 'ms-client-id-def',
    MARKETING_MICROSOFT_CLIENT_SECRET: TEST_SECRETS.microsoftSecret,
    MARKETING_MICROSOFT_TENANT_ID: 'ms-tenant-id-ghi',
    NEXT_PUBLIC_APP_URL: 'https://real.sohee.ai',
  };

  describe('validateCallbackOrigin', () => {
    describe('Type and malformed string defenses', () => {
      it('rejects undefined, null, non-string, empty, and whitespace values', () => {
        expect(validateCallbackOrigin(undefined, false)).toBe(false);
        expect(validateCallbackOrigin(null, false)).toBe(false);
        expect(validateCallbackOrigin(12345, false)).toBe(false);
        expect(validateCallbackOrigin({}, false)).toBe(false);
        expect(validateCallbackOrigin('', false)).toBe(false);
        expect(validateCallbackOrigin('   ', false)).toBe(false);
      });

      it('rejects malformed URLs', () => {
        expect(validateCallbackOrigin('not-a-url', false)).toBe(false);
        expect(validateCallbackOrigin('http://', false)).toBe(false);
        expect(validateCallbackOrigin('://foo.com', false)).toBe(false);
      });
    });

    describe('URL component restrictions: userinfo, query, hash, path', () => {
      it('rejects URLs containing userinfo (credentials in URL)', () => {
        expect(
          validateCallbackOrigin('https://user:pass@real.sohee.ai', true)
        ).toBe(false);
        expect(
          validateCallbackOrigin('http://admin:secret@localhost:3000', false)
        ).toBe(false);
        expect(validateCallbackOrigin('https://u@a.com', true)).toBe(false);
        expect(validateCallbackOrigin('https://:@a.com', true)).toBe(false);
      });

      it('rejects URLs containing backslash or parser confusion', () => {
        expect(
          validateCallbackOrigin('https://a.com\\@evil.com', true)
        ).toBe(false);
      });

      it('rejects URLs containing query parameters including empty query', () => {
        expect(
          validateCallbackOrigin('https://real.sohee.ai?ref=test', true)
        ).toBe(false);
        expect(
          validateCallbackOrigin('http://localhost:3000/?token=abc', false)
        ).toBe(false);
        expect(validateCallbackOrigin('https://a.com/?', true)).toBe(false);
      });

      it('rejects URLs containing hash fragments including empty hash', () => {
        expect(
          validateCallbackOrigin('https://real.sohee.ai#section', true)
        ).toBe(false);
        expect(
          validateCallbackOrigin('http://localhost:3000/#fragment', false)
        ).toBe(false);
        expect(validateCallbackOrigin('https://a.com/#', true)).toBe(false);
      });

      it('rejects URLs containing non-root paths', () => {
        expect(
          validateCallbackOrigin('https://real.sohee.ai/api/callback', true)
        ).toBe(false);
        expect(
          validateCallbackOrigin('https://real.sohee.ai/app', true)
        ).toBe(false);
        expect(
          validateCallbackOrigin('http://localhost:3000/some/path', false)
        ).toBe(false);
      });

      it('accepts root origins with or without trailing slash and preserves uppercase hosts', () => {
        expect(validateCallbackOrigin('https://real.sohee.ai', true)).toBe(true);
        expect(validateCallbackOrigin('https://real.sohee.ai/', true)).toBe(true);
        expect(validateCallbackOrigin('https://a.com', true)).toBe(true);
        expect(validateCallbackOrigin('https://a.com/', true)).toBe(true);
        expect(validateCallbackOrigin('https://A.COM', true)).toBe(true);
        expect(validateCallbackOrigin('https://REAL.SOHEE.AI', true)).toBe(true);
      });
    });

    describe('Environment separation (Production HTTPS only vs Development localhost)', () => {
      it('strictly enforces HTTPS in production and rejects all HTTP URLs', () => {
        expect(validateCallbackOrigin('https://real.sohee.ai', true)).toBe(true);
        expect(validateCallbackOrigin('http://real.sohee.ai', true)).toBe(false);
        // Even localhost is rejected on HTTP in production
        expect(validateCallbackOrigin('http://localhost:3000', true)).toBe(false);
        expect(validateCallbackOrigin('http://127.0.0.1:8799', true)).toBe(false);
      });

      it('allows HTTP in development only for localhost and exact 127.0.0.1 with any port, rejecting dot-suffix, IPv6, and other numeric IPs', () => {
        expect(validateCallbackOrigin('http://localhost', false)).toBe(true);
        expect(validateCallbackOrigin('http://localhost:3000', false)).toBe(true);
        expect(validateCallbackOrigin('http://LOCALHOST:3000', false)).toBe(true);
        expect(validateCallbackOrigin('http://127.0.0.1', false)).toBe(true);
        expect(validateCallbackOrigin('http://127.0.0.1:8799', false)).toBe(true);
        // Dot-suffix localhost is rejected
        expect(validateCallbackOrigin('http://localhost.', false)).toBe(false);
        expect(validateCallbackOrigin('http://localhost.:3000', false)).toBe(false);
        // IPv6 loopback [::1] is rejected
        expect(validateCallbackOrigin('http://[::1]', false)).toBe(false);
        expect(validateCallbackOrigin('http://[::1]:3000', false)).toBe(false);
        // Other numeric IPs are rejected over HTTP
        expect(validateCallbackOrigin('http://127.0.0.2', false)).toBe(false);
        expect(validateCallbackOrigin('http://127.0.0.2:8799', false)).toBe(false);
        expect(validateCallbackOrigin('http://10.0.0.1', false)).toBe(false);
        expect(validateCallbackOrigin('http://10.0.0.1:3000', false)).toBe(false);
        expect(validateCallbackOrigin('http://0.0.0.0', false)).toBe(false);
        expect(validateCallbackOrigin('http://192.168.1.10:3000', false)).toBe(false);
        // Non-localhost HTTP is rejected even in development
        expect(validateCallbackOrigin('http://real.sohee.ai', false)).toBe(false);
        expect(validateCallbackOrigin('http://external-redirect.com', false)).toBe(false);
      });

      it('rejects unsupported protocols (ftp, javascript, file, mailto)', () => {
        expect(validateCallbackOrigin('ftp://real.sohee.ai', true)).toBe(false);
        expect(validateCallbackOrigin('javascript:alert(1)', true)).toBe(false);
        expect(validateCallbackOrigin('file:///etc/passwd', false)).toBe(false);
      });
    });
  });

  describe('hasRequiredProviderConfig', () => {
    it('returns false when required env variables are missing or empty', () => {
      const partialEnv: Record<string, string | undefined> = {
        MARKETING_GOOGLE_CLIENT_ID: 'client-id-only',
      };
      expect(hasRequiredProviderConfig('google', partialEnv, true)).toBe(false);
      expect(hasRequiredProviderConfig('microsoft', partialEnv, true)).toBe(false);

      const whitespaceEnv: Record<string, string | undefined> = {
        ...FULL_VALID_ENV,
        MARKETING_GOOGLE_CLIENT_SECRET: '   ',
      };
      expect(hasRequiredProviderConfig('google', whitespaceEnv, true)).toBe(false);
    });

    it('returns false when NEXT_PUBLIC_APP_URL is invalid or insecure for the environment', () => {
      const insecureProdEnv: Record<string, string | undefined> = {
        ...FULL_VALID_ENV,
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      };
      expect(hasRequiredProviderConfig('google', insecureProdEnv, true)).toBe(false);

      const pathProdEnv: Record<string, string | undefined> = {
        ...FULL_VALID_ENV,
        NEXT_PUBLIC_APP_URL: 'https://real.sohee.ai/subpath',
      };
      expect(hasRequiredProviderConfig('google', pathProdEnv, true)).toBe(false);
    });

    it('returns true when all required env variables are present and origin is valid', () => {
      expect(hasRequiredProviderConfig('google', FULL_VALID_ENV, true)).toBe(true);
      expect(hasRequiredProviderConfig('microsoft', FULL_VALID_ENV, true)).toBe(true);
    });

    it('returns true for meta and apple which have no required env keys', () => {
      expect(hasRequiredProviderConfig('meta', {}, true)).toBe(true);
      expect(hasRequiredProviderConfig('apple', {}, true)).toBe(true);
    });

    it('returns false for unknown provider', () => {
      expect(
        hasRequiredProviderConfig('unknown_provider' as ProviderId, FULL_VALID_ENV, true)
      ).toBe(false);
    });
  });

  describe('resolveProviderReadiness', () => {
    it('sets not_implemented and canConnect=false for Google even when all env keys exist and provider is approved', () => {
      const readiness = resolveProviderReadiness('google', FULL_VALID_ENV, {
        isProduction: true,
        approvedProviders: ['google', 'microsoft'],
      });

      expect(readiness.providerId).toBe('google');
      expect(readiness.method).toBe('oauth');
      expect(readiness.canConnect).toBe(false);
      expect(readiness.status).toBe('not_implemented');
      expect(readiness.managementHref).toBeUndefined();
      expect(typeof readiness.message).toBe('string');
      expect(readiness.message.length).toBeGreaterThan(0);
    });

    it('sets not_implemented and canConnect=false for Microsoft even when all env keys exist and provider is approved', () => {
      const readiness = resolveProviderReadiness('microsoft', FULL_VALID_ENV, {
        isProduction: true,
        approvedProviders: ['google', 'microsoft'],
      });

      expect(readiness.providerId).toBe('microsoft');
      expect(readiness.method).toBe('oauth');
      expect(readiness.canConnect).toBe(false);
      expect(readiness.status).toBe('not_implemented');
      expect(readiness.managementHref).toBeUndefined();
      expect(typeof readiness.message).toBe('string');
      expect(readiness.message.length).toBeGreaterThan(0);
    });

    it('sets existing_management and canConnect=false with managementHref for Meta', () => {
      const readiness = resolveProviderReadiness('meta', {}, {
        isProduction: true,
        approvedProviders: [],
      });

      expect(readiness.providerId).toBe('meta');
      expect(readiness.method).toBe('existing');
      expect(readiness.canConnect).toBe(false);
      expect(readiness.status).toBe('existing_management');
      expect(readiness.managementHref).toBe('/app/channels');
      expect(typeof readiness.message).toBe('string');
      expect(readiness.message.length).toBeGreaterThan(0);
    });

    it('sets manual_import_unavailable and canConnect=false for Apple without callback links', () => {
      const readiness = resolveProviderReadiness('apple', {}, {
        isProduction: true,
        approvedProviders: [],
      });

      expect(readiness.providerId).toBe('apple');
      expect(readiness.method).toBe('import');
      expect(readiness.canConnect).toBe(false);
      expect(readiness.status).toBe('manual_import_unavailable');
      expect(readiness.managementHref).toBeUndefined();
      expect(typeof readiness.message).toBe('string');
      expect(readiness.message.length).toBeGreaterThan(0);
    });

    it('fails closed for unknown provider ID', () => {
      const readiness = resolveProviderReadiness('unknown_provider' as ProviderId, FULL_VALID_ENV, {
        isProduction: true,
        approvedProviders: [],
      });

      expect(readiness.canConnect).toBe(false);
      expect(readiness.status).toBe('not_implemented');
    });
  });

  describe('listProviderReadiness', () => {
    it('returns readiness for all four providers, all with canConnect=false', () => {
      const list = listProviderReadiness(FULL_VALID_ENV, {
        isProduction: true,
        approvedProviders: ['google', 'microsoft'],
      });

      expect(list).toHaveLength(4);
      const providerIds = list.map((p) => p.providerId);
      expect(providerIds).toEqual(['google', 'microsoft', 'meta', 'apple']);

      for (const item of list) {
        expect(item.canConnect).toBe(false);
        expect(typeof item.message).toBe('string');
        expect(item.message.length).toBeGreaterThan(0);
      }
    });

    it('freezes the returned readiness list', () => {
      const list = listProviderReadiness(FULL_VALID_ENV, {
        isProduction: true,
        approvedProviders: [],
      });
      expect(Object.isFrozen(list)).toBe(true);
      for (const item of list) {
        expect(Object.isFrozen(item)).toBe(true);
      }
    });
  });

  describe('Security & Privacy bounds: No secrets, scopes, or env names leaked', () => {
    it('never contains secret values, internal scopes, or env var names in serialized JSON output', () => {
      const list = listProviderReadiness(FULL_VALID_ENV, {
        isProduction: true,
        approvedProviders: ['google', 'microsoft'],
      });
      const serialized = JSON.stringify(list);

      // Secret values must never leak
      expect(serialized).not.toContain(TEST_SECRETS.googleSecret);
      expect(serialized).not.toContain(TEST_SECRETS.googleTokenKey);
      expect(serialized).not.toContain(TEST_SECRETS.microsoftSecret);
      expect(serialized).not.toContain(TEST_SECRETS.microsoftTokenKey);

      // Environment variable names must never leak in public readiness output
      expect(serialized).not.toContain('MARKETING_GOOGLE_CLIENT_ID');
      expect(serialized).not.toContain('MARKETING_GOOGLE_CLIENT_SECRET');
      expect(serialized).not.toContain('MARKETING_CONNECTOR_TOKEN_KEY');
      expect(serialized).not.toContain('MARKETING_MICROSOFT_CLIENT_ID');
      expect(serialized).not.toContain('MARKETING_MICROSOFT_CLIENT_SECRET');
      expect(serialized).not.toContain('MARKETING_MICROSOFT_TENANT_ID');
      expect(serialized).not.toContain('NEXT_PUBLIC_APP_URL');

      // Internal OAuth scope strings must never leak in readiness messages
      expect(serialized).not.toContain('https://www.googleapis.com/auth/calendar.events.readonly');
      expect(serialized).not.toContain('calendar.events.readonly');
      expect(serialized).not.toContain('Mail.ReadBasic');
      expect(serialized).not.toContain('offline_access');
    });

    it('ensures individual provider readiness messages never contain secrets or env names', () => {
      for (const id of ['google', 'microsoft', 'meta', 'apple'] as const) {
        const readiness = resolveProviderReadiness(id, FULL_VALID_ENV, {
          isProduction: true,
          approvedProviders: ['google', 'microsoft'],
        });
        const msg = readiness.message;
        expect(msg).not.toContain(TEST_SECRETS.googleSecret);
        expect(msg).not.toContain('MARKETING_');
        expect(msg).not.toContain('NEXT_PUBLIC_');
        expect(msg).not.toContain('calendar.events');
      }
    });
  });
});
