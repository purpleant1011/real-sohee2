import { describe, expect, it } from 'vitest';
import { CONNECTOR_CATALOG, type ConnectorId } from '../catalog';
import {
  getProviderDefinition,
  isKnownProviderId,
  PROVIDER_DEFINITIONS,
  type ProviderId,
} from './registry';

describe('marketing-connectors/providers/registry', () => {
  const EXPECTED_PROVIDER_IDS: readonly ProviderId[] = [
    'google',
    'microsoft',
    'meta',
    'apple',
  ];

  describe('Static Provider Registry completeness and uniqueness', () => {
    it('defines exactly four known providers', () => {
      expect(PROVIDER_DEFINITIONS).toHaveLength(4);
      const ids = PROVIDER_DEFINITIONS.map((p) => p.id);
      expect(ids.sort()).toEqual([...EXPECTED_PROVIDER_IDS].sort());
    });

    it('maps every connector from CONNECTOR_CATALOG exactly once with no duplicates', () => {
      const allCatalogIds: ConnectorId[] = CONNECTOR_CATALOG.map((c) => c.id);
      const mappedConnectorIds: ConnectorId[] = [];

      for (const provider of PROVIDER_DEFINITIONS) {
        // No duplicate within provider
        const uniqueInProvider = new Set(provider.connectorIds);
        expect(uniqueInProvider.size).toBe(provider.connectorIds.length);
        mappedConnectorIds.push(...provider.connectorIds);
      }

      // No duplicate across providers
      const uniqueAcrossAll = new Set(mappedConnectorIds);
      expect(uniqueAcrossAll.size).toBe(mappedConnectorIds.length);

      // Matches catalog 1:1
      expect(mappedConnectorIds.sort()).toEqual(allCatalogIds.sort());
    });

    it('enforces deep immutability with Object.isFrozen', () => {
      expect(Object.isFrozen(PROVIDER_DEFINITIONS)).toBe(true);
      for (const provider of PROVIDER_DEFINITIONS) {
        expect(Object.isFrozen(provider)).toBe(true);
        expect(Object.isFrozen(provider.connectorIds)).toBe(true);
        expect(Object.isFrozen(provider.requiredEnv)).toBe(true);
        expect(Object.isFrozen(provider.requestedScopes)).toBe(true);
      }
    });
  });

  describe('Implementation flags reflect feature completion', () => {
    it('sets implementation flags accurately according to shipped providers', () => {
      const google = getProviderDefinition('google');
      expect(google?.oauthImplemented).toBe(true);
      expect(google?.sourceReadImplemented).toBe(true);

      const ms = getProviderDefinition('microsoft');
      expect(ms?.oauthImplemented).toBe(true);
      expect(ms?.sourceReadImplemented).toBe(true);

      const apple = getProviderDefinition('apple');
      expect(apple?.oauthImplemented).toBe(false);
      expect(apple?.sourceReadImplemented).toBe(true);

      const meta = getProviderDefinition('meta');
      expect(meta?.oauthImplemented).toBe(false);
      expect(meta?.sourceReadImplemented).toBe(false);
    });
  });

  describe('Provider contracts per provider specification', () => {
    it('configures Google with calendar-only scope and callback path', () => {
      const google = getProviderDefinition('google');
      expect(google).toBeDefined();
      expect(google?.method).toBe('oauth');
      expect(google?.redirectPath).toBe(
        '/api/marketing-connectors/google/callback'
      );
      expect(google?.requiredEnv).toEqual([
        'MARKETING_GOOGLE_CLIENT_ID',
        'MARKETING_GOOGLE_CLIENT_SECRET',
        'MARKETING_CONNECTOR_TOKEN_KEY',
        'NEXT_PUBLIC_APP_URL',
      ]);
      // Calendar events readonly only — no broad drive.readonly or gmail scopes
      expect(google?.requestedScopes).toEqual([
        'https://www.googleapis.com/auth/calendar.events.readonly',
      ]);
      expect(google?.connectorIds).toContain('google_calendar');
      expect(google?.connectorIds).toContain('google_docs');
      expect(google?.connectorIds).toContain('google_sheets');
      expect(google?.connectorIds).toContain('gmail');
      expect(google?.connectorIds).toContain('google_drive');
      expect(google?.connectorIds).toHaveLength(5);
    });

    it('configures Microsoft with least privilege scopes and callback path', () => {
      const ms = getProviderDefinition('microsoft');
      expect(ms).toBeDefined();
      expect(ms?.method).toBe('oauth');
      expect(ms?.redirectPath).toBe(
        '/api/marketing-connectors/microsoft/callback'
      );
      expect(ms?.requiredEnv).toEqual([
        'MARKETING_MICROSOFT_CLIENT_ID',
        'MARKETING_MICROSOFT_CLIENT_SECRET',
        'MARKETING_MICROSOFT_TENANT_ID',
        'MARKETING_CONNECTOR_TOKEN_KEY',
        'NEXT_PUBLIC_APP_URL',
      ]);
      expect(ms?.requestedScopes).toEqual([
        'openid',
        'offline_access',
        'Mail.ReadBasic',
      ]);
      expect(ms?.connectorIds).toEqual(['outlook_mail']);
    });

    it('preserves Meta existing management path and null redirect', () => {
      const meta = getProviderDefinition('meta');
      expect(meta).toBeDefined();
      expect(meta?.method).toBe('existing');
      expect(meta?.redirectPath).toBeNull();
      expect(meta?.requiredEnv).toEqual([]);
      expect(meta?.requestedScopes).toEqual([]);
      expect(meta?.managementHref).toBe('/app/channels');
      expect(meta?.connectorIds).toEqual([
        'threads',
        'instagram',
        'instagram_messages',
      ]);
    });

    it('configures Apple as import method with null redirect', () => {
      const apple = getProviderDefinition('apple');
      expect(apple).toBeDefined();
      expect(apple?.method).toBe('import');
      expect(apple?.redirectPath).toBeNull();
      expect(apple?.requiredEnv).toEqual([]);
      expect(apple?.requestedScopes).toEqual([]);
      expect(apple?.connectorIds).toEqual([
        'apple_calendar',
        'apple_reminders',
      ]);
    });
  });

  describe('getProviderDefinition runtime fail-closed lookups', () => {
    it('returns frozen definition for valid provider ID', () => {
      const def = getProviderDefinition('google');
      expect(def).toBeDefined();
      expect(def?.id).toBe('google');
      expect(Object.isFrozen(def)).toBe(true);
    });

    it('returns undefined for unknown, empty, or non-string inputs', () => {
      expect(getProviderDefinition('unknown_provider')).toBeUndefined();
      expect(getProviderDefinition('')).toBeUndefined();
      // @ts-expect-error testing invalid runtime input
      expect(getProviderDefinition(null)).toBeUndefined();
      // @ts-expect-error testing invalid runtime input
      expect(getProviderDefinition(undefined)).toBeUndefined();
      // @ts-expect-error testing invalid runtime input
      expect(getProviderDefinition(123)).toBeUndefined();
      // @ts-expect-error testing invalid runtime input
      expect(getProviderDefinition({})).toBeUndefined();
    });
  });

  describe('isKnownProviderId type guard', () => {
    it('returns true for known providers and false for all others', () => {
      expect(isKnownProviderId('google')).toBe(true);
      expect(isKnownProviderId('microsoft')).toBe(true);
      expect(isKnownProviderId('meta')).toBe(true);
      expect(isKnownProviderId('apple')).toBe(true);

      expect(isKnownProviderId('kakao')).toBe(false);
      expect(isKnownProviderId('naver')).toBe(false);
      expect(isKnownProviderId('')).toBe(false);
      expect(isKnownProviderId(null)).toBe(false);
      expect(isKnownProviderId(undefined)).toBe(false);
      expect(isKnownProviderId(42)).toBe(false);
    });
  });
});
