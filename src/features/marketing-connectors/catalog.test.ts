import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_CATALOG,
  getConnectorDefinition,
  type ConnectorId,
} from './catalog';

describe('CONNECTOR_CATALOG', () => {
  const EXPECTED_IDS: readonly ConnectorId[] = [
    'gmail',
    'google_calendar',
    'apple_calendar',
    'apple_reminders',
    'google_docs',
    'google_sheets',
    'outlook_mail',
    'threads',
    'instagram',
    'instagram_messages',
    'google_drive',
  ];

  it('contains exactly the 11 requested connector IDs without duplicates', () => {
    expect(CONNECTOR_CATALOG).toHaveLength(11);
    const catalogIds = CONNECTOR_CATALOG.map((c) => c.id);
    const uniqueIds = new Set(catalogIds);
    expect(uniqueIds.size).toBe(11);

    for (const expectedId of EXPECTED_IDS) {
      expect(catalogIds).toContain(expectedId);
    }
  });

  it('provides non-empty Korean and search alias inputs for every connector', () => {
    for (const connector of CONNECTOR_CATALOG) {
      expect(connector.aliases).toBeDefined();
      expect(connector.aliases.length).toBeGreaterThan(0);
      // Verify aliases contain string items
      for (const alias of connector.aliases) {
        expect(typeof alias).toBe('string');
        expect(alias.trim().length).toBeGreaterThan(0);
      }
    }

    // Spot-check specific Korean aliases
    const instagram = getConnectorDefinition('instagram');
    expect(instagram?.aliases).toContain('인스타그램');

    const gmail = getConnectorDefinition('gmail');
    expect(gmail?.aliases).toContain('지메일');

    const threads = getConnectorDefinition('threads');
    expect(threads?.aliases).toContain('스레드');
  });

  it('enforces that Gmail cannot be available (must be review_required)', () => {
    const gmail = getConnectorDefinition('gmail');
    expect(gmail).toBeDefined();
    expect(gmail?.readiness).not.toBe('available');
    expect(gmail?.readiness).toBe('review_required');
    expect(gmail?.method).toBe('oauth');
    expect(gmail?.category).toBe('productivity');
  });

  it('enforces that Apple Reminders is unsupported with unavailable method', () => {
    const reminders = getConnectorDefinition('apple_reminders');
    expect(reminders).toBeDefined();
    expect(reminders?.readiness).toBe('unsupported');
    expect(reminders?.method).toBe('unavailable');
    expect(reminders?.category).toBe('productivity');
  });

  it('enforces Apple Calendar is import method and setup_required readiness', () => {
    const appleCal = getConnectorDefinition('apple_calendar');
    expect(appleCal).toBeDefined();
    expect(appleCal?.method).toBe('import');
    expect(appleCal?.readiness).toBe('setup_required');
    expect(appleCal?.category).toBe('productivity');
  });

  it('enforces social connectors are existing and available with /app/channels management link', () => {
    const socialIds: readonly ConnectorId[] = ['threads', 'instagram', 'instagram_messages'];
    for (const id of socialIds) {
      const def = getConnectorDefinition(id);
      expect(def).toBeDefined();
      expect(def?.category).toBe('social');
      expect(def?.method).toBe('existing');
      expect(def?.readiness).toBe('available');
      expect(def?.managementHref).toBe('/app/channels');
    }
  });

  it('enforces Google and Microsoft productivity connectors are setup_required or review_required', () => {
    const productivityOauth: readonly ConnectorId[] = [
      'google_calendar',
      'google_docs',
      'google_sheets',
      'google_drive',
      'outlook_mail',
    ];
    for (const id of productivityOauth) {
      const def = getConnectorDefinition(id);
      expect(def).toBeDefined();
      expect(def?.category).toBe('productivity');
      expect(def?.method).toBe('oauth');
      expect(['setup_required', 'review_required']).toContain(def?.readiness);
      expect(def?.readiness).not.toBe('available');
    }
  });

  it('is immutable (Object.isFrozen on catalog and entries)', () => {
    expect(Object.isFrozen(CONNECTOR_CATALOG)).toBe(true);
    for (const connector of CONNECTOR_CATALOG) {
      expect(Object.isFrozen(connector)).toBe(true);
      expect(Object.isFrozen(connector.reads)).toBe(true);
      expect(Object.isFrozen(connector.excludes)).toBe(true);
      expect(Object.isFrozen(connector.aliases)).toBe(true);
    }
  });
});

describe('getConnectorDefinition', () => {
  it('returns definition by connector ID', () => {
    const def = getConnectorDefinition('google_calendar');
    expect(def).toBeDefined();
    expect(def?.id).toBe('google_calendar');
    expect(def?.name).toBe('Google Calendar');
  });

  it('returns undefined for unknown, empty, or invalid ID inputs fail-closed', () => {
    expect(getConnectorDefinition('unknown_id')).toBeUndefined();
    expect(getConnectorDefinition('')).toBeUndefined();
    // @ts-expect-error test invalid runtime inputs
    expect(getConnectorDefinition(null)).toBeUndefined();
    // @ts-expect-error test invalid runtime inputs
    expect(getConnectorDefinition(undefined)).toBeUndefined();
    // @ts-expect-error test invalid runtime inputs
    expect(getConnectorDefinition(123)).toBeUndefined();
  });
});
