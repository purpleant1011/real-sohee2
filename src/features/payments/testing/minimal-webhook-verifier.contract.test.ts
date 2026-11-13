import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MinimalTestWebhookVerifier,
  signMinimalTestPayload,
  type TestVerifyInput,
} from './minimal-webhook-verifier';
import {
  type Context,
  type Scope,
} from '../../policy-gate/testing/minimal-admission';

describe('minimal-webhook-verifier contract tests', () => {
  const createFetchSpy = () => vi.spyOn(globalThis, 'fetch');
  let fetchSpy: ReturnType<typeof createFetchSpy>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    fetchSpy = createFetchSpy();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fetchSpy.mockRestore();
  });

  const validWorkspaceId = '11111111-2222-3333-4444-555555555555';
  const validScope: Scope = {
    workspaceId: validWorkspaceId,
    provider: 'portone',
    action: 'payment',
    operationKey: 'op-verify-1',
  };

  const validContext: Context = {
    controls: {
      mode: 'TEST_FAKE_ONLY',
      datasetMode: 'TEST',
      allowedWorkspaceIds: [validWorkspaceId],
      killSwitch: false,
    },
    now: new Date('2026-10-22T10:00:00.000Z'),
    evaluator: () => ({ ready: true }),
  };

  const testSecret = 'test-secret-key-for-contracts';
  const verifier = new MinimalTestWebhookVerifier({ secret: testSecret });

  it('verifies zero external HTTP calls during webhook verification', async () => {
    const rawBody = new Uint8Array([1, 2, 3, 4]);
    const timestamp = '2026-10-22T10:00:00.000Z';
    const eventId = 'evt-1001';

    const headers = signMinimalTestPayload({
      secret: testSecret,
      protocol: 'SOHEE_MINIMAL_TEST_V1',
      timestamp,
      eventId,
      scope: validScope,
      rawBody,
    });

    const input: TestVerifyInput = {
      expectedScope: validScope,
      rawBody,
      headers,
    };

    const result = await verifier.verify(validContext, input);
    expect(result.kind).toBe('TEST_SIGNATURE_OBSERVATION');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('signature and tampering validation', () => {
    const rawBody = new Uint8Array([10, 20, 30]);
    const timestamp = '2026-10-22T10:00:00.000Z';
    const eventId = 'evt-test-1';

    it('successfully verifies valid signature frame', async () => {
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp,
        eventId,
        scope: validScope,
        rawBody,
      });

      const result = await verifier.verify(validContext, {
        expectedScope: validScope,
        rawBody,
        headers,
      });

      expect(result.kind).toBe('TEST_SIGNATURE_OBSERVATION');
      if (result.kind === 'TEST_SIGNATURE_OBSERVATION') {
        expect(result.datasetMode).toBe('TEST');
        expect(result.actualVerified).toBe(false);
        expect(result.eventId).toBe(eventId);
        expect(result.scope).toEqual(validScope);
        expect(result.bodyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
    });

    it('rejects tampered raw body bytes', async () => {
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp,
        eventId,
        scope: validScope,
        rawBody,
      });

      const tamperedBody = new Uint8Array([10, 20, 99]); // modified last byte
      const result = await verifier.verify(validContext, {
        expectedScope: validScope,
        rawBody: tamperedBody,
        headers,
      });

      expect(result.kind).toBe('SIGNATURE_VERIFICATION_FAILED');
      if (result.kind !== 'SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('fixture failed: expected SIGNATURE_VERIFICATION_FAILED');
      }
      expect(result.reason).toBe('INVALID_SIGNATURE');
    });

    it('rejects tampered timestamp header', async () => {
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp,
        eventId,
        scope: validScope,
        rawBody,
      });

      const tamperedHeaders = {
        ...headers,
        'x-sohee-test-timestamp': '2026-10-22T10:00:05.000Z',
      };

      const result = await verifier.verify(validContext, {
        expectedScope: validScope,
        rawBody,
        headers: tamperedHeaders,
      });

      expect(result.kind).toBe('SIGNATURE_VERIFICATION_FAILED');
      if (result.kind !== 'SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('fixture failed: expected SIGNATURE_VERIFICATION_FAILED');
      }
      expect(result.reason).toBe('INVALID_SIGNATURE');
    });

    it('rejects tampered eventId header', async () => {
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp,
        eventId,
        scope: validScope,
        rawBody,
      });

      const tamperedHeaders = {
        ...headers,
        'x-sohee-test-event': 'evt-tampered',
      };

      const result = await verifier.verify(validContext, {
        expectedScope: validScope,
        rawBody,
        headers: tamperedHeaders,
      });

      expect(result.kind).toBe('SIGNATURE_VERIFICATION_FAILED');
      if (result.kind !== 'SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('fixture failed: expected SIGNATURE_VERIFICATION_FAILED');
      }
      expect(result.reason).toBe('INVALID_SIGNATURE');
    });

    it('rejects foreign scope in expectedScope vs headers', async () => {
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp,
        eventId,
        scope: validScope,
        rawBody,
      });

      const foreignScope: Scope = {
        ...validScope,
        operationKey: 'op-different',
      };

      const result = await verifier.verify(validContext, {
        expectedScope: foreignScope,
        rawBody,
        headers,
      });

      expect(result.kind).toBe('SIGNATURE_VERIFICATION_FAILED');
      if (result.kind !== 'SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('fixture failed: expected SIGNATURE_VERIFICATION_FAILED');
      }
      expect(result.reason).toBe('SCOPE_MISMATCH');
    });
  });

  describe('replay window and timestamp validation', () => {
    const rawBody = new Uint8Array([1, 2]);
    const eventId = 'evt-time-check';

    it('rejects timestamp outside past tolerance (> 300s old)', async () => {
      const expiredTimestamp = new Date(
        validContext.now.getTime() - 301 * 1000
      ).toISOString();
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp: expiredTimestamp,
        eventId,
        scope: validScope,
        rawBody,
      });

      const result = await verifier.verify(validContext, {
        expectedScope: validScope,
        rawBody,
        headers,
      });

      expect(result.kind).toBe('SIGNATURE_VERIFICATION_FAILED');
      if (result.kind !== 'SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('fixture failed: expected SIGNATURE_VERIFICATION_FAILED');
      }
      expect(result.reason).toBe('TIMESTAMP_EXPIRED');
    });

    it('rejects timestamp outside future tolerance (> 60s in future)', async () => {
      const futureTimestamp = new Date(
        validContext.now.getTime() + 61 * 1000
      ).toISOString();
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp: futureTimestamp,
        eventId,
        scope: validScope,
        rawBody,
      });

      const result = await verifier.verify(validContext, {
        expectedScope: validScope,
        rawBody,
        headers,
      });

      expect(result.kind).toBe('SIGNATURE_VERIFICATION_FAILED');
      if (result.kind !== 'SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('fixture failed: expected SIGNATURE_VERIFICATION_FAILED');
      }
      expect(result.reason).toBe('TIMESTAMP_FUTURE');
    });

    it('rejects timestamp without timezone offset', async () => {
      const nonOffsetTimestamp = '2026-10-22T10:00:00'; // Missing Z or +/- offset
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp: nonOffsetTimestamp,
        eventId,
        scope: validScope,
        rawBody,
      });

      const result = await verifier.verify(validContext, {
        expectedScope: validScope,
        rawBody,
        headers,
      });

      expect(result.kind).toBe('SIGNATURE_VERIFICATION_FAILED');
      if (result.kind !== 'SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('fixture failed: expected SIGNATURE_VERIFICATION_FAILED');
      }
      expect(result.reason).toBe('INVALID_TIMESTAMP_FORMAT');
    });

    it('rejects invalid now Date in context', async () => {
      const timestamp = validContext.now.toISOString();
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp,
        eventId,
        scope: validScope,
        rawBody,
      });

      const result = await verifier.verify(
        { ...validContext, now: new Date('invalid') },
        {
          expectedScope: validScope,
          rawBody,
          headers,
        }
      );

      expect(result.kind).toBe('SIGNATURE_VERIFICATION_FAILED');
      if (result.kind !== 'SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('fixture failed: expected SIGNATURE_VERIFICATION_FAILED');
      }
      expect(result.reason).toBe('INVALID_NOW');
    });
  });

  describe('protocol and environment safety', () => {
    it('rejects non-SOHEE_MINIMAL_TEST_V1 protocol (e.g. real PortOne protocol)', async () => {
      const headers = {
        'x-sohee-test-protocol': 'PORTONE_V1',
        'x-sohee-test-timestamp': validContext.now.toISOString(),
        'x-sohee-test-event': 'evt-1',
        'x-sohee-test-workspace': validScope.workspaceId,
        'x-sohee-test-provider': validScope.provider,
        'x-sohee-test-action': validScope.action,
        'x-sohee-test-operation': validScope.operationKey,
        'x-sohee-test-signature': 'any-sig',
      };

      const result = await verifier.verify(validContext, {
        expectedScope: validScope,
        rawBody: new Uint8Array([1]),
        headers,
      });

      expect(result.kind).toBe('SIGNATURE_VERIFICATION_FAILED');
      if (result.kind !== 'SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('fixture failed: expected SIGNATURE_VERIFICATION_FAILED');
      }
      expect(result.reason).toBe('UNSUPPORTED_PROTOCOL');
    });

    it('rejects execution when NODE_ENV is production', async () => {
      const timestamp = validContext.now.toISOString();
      const rawBody = new Uint8Array([1]);
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp,
        eventId: 'evt-prod',
        scope: validScope,
        rawBody,
      });

      // Switch to production after generating fixture headers
      vi.stubEnv('NODE_ENV', 'production');

      const result = await verifier.verify(validContext, {
        expectedScope: validScope,
        rawBody,
        headers,
      });

      expect(result.kind).toBe('SIGNATURE_VERIFICATION_FAILED');
      if (result.kind !== 'SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('fixture failed: expected SIGNATURE_VERIFICATION_FAILED');
      }
      expect(result.reason).toBe('PRODUCTION_FORBIDDEN');

      // Also verify signer itself refuses running in production
      expect(() =>
        signMinimalTestPayload({
          secret: testSecret,
          protocol: 'SOHEE_MINIMAL_TEST_V1',
          timestamp,
          eventId: 'evt-prod-signer',
          scope: validScope,
          rawBody,
        })
      ).toThrow(/PRODUCTION_FORBIDDEN/);
    });

    it('confirms stateless duplicate verification has no side effects and yields same result', async () => {
      const rawBody = new Uint8Array([7, 8, 9]);
      const timestamp = validContext.now.toISOString();
      const eventId = 'evt-duplicate-check';
      const headers = signMinimalTestPayload({
        secret: testSecret,
        protocol: 'SOHEE_MINIMAL_TEST_V1',
        timestamp,
        eventId,
        scope: validScope,
        rawBody,
      });

      const input: TestVerifyInput = {
        expectedScope: validScope,
        rawBody,
        headers,
      };

      const res1 = await verifier.verify(validContext, input);
      const res2 = await verifier.verify(validContext, input);

      expect(res1).toEqual(res2);
      expect(res1.kind).toBe('TEST_SIGNATURE_OBSERVATION');
    });
  });
});
