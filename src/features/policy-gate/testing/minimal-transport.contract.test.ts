import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MinimalTestTransport,
  type TestObservationFixture,
  type TestSubmitResult,
} from './minimal-transport';
import {
  type Context,
  type Scope,
  type TestRequest,
} from './minimal-admission';

describe('minimal-transport contract tests', () => {
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
  const otherWorkspaceId = '22222222-3333-4444-5555-666666666666';

  const validContext: Context = {
    controls: {
      mode: 'TEST_FAKE_ONLY',
      datasetMode: 'TEST',
      allowedWorkspaceIds: [validWorkspaceId, otherWorkspaceId],
      killSwitch: false,
    },
    now: new Date('2026-10-22T10:00:00.000Z'),
    evaluator: () => ({ ready: true }),
  };

  it('verifies zero external HTTP calls during transport submit and read', async () => {
    const transport = new MinimalTestTransport(['TEST_ACCEPTED']);
    const scope: Scope = {
      workspaceId: validWorkspaceId,
      provider: 'portone',
      action: 'payment',
      operationKey: 'op-http-check',
    };
    const request: TestRequest = {
      scope,
      payload: new Uint8Array([1, 2, 3]),
    };

    const res = await transport.submit(validContext, request);
    expect(res.kind).toBe('TEST_REQUEST_RESULT');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('explicit acceptance across three actions', () => {
    it('returns TEST_ACCEPTED with checkout URL for payment', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-pay-1',
      };
      const res = (await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([10, 20]),
      })) as Extract<TestSubmitResult, { kind: 'TEST_REQUEST_RESULT' }>;

      expect(res.kind).toBe('TEST_REQUEST_RESULT');
      expect(res.status).toBe('TEST_ACCEPTED');
      expect(res.acceptanceRef).toMatch(/^test-request:/);
      expect(res.checkoutUrl).toMatch(/^https:\/\/checkout\.example\.invalid\//);
      expect(res.datasetMode).toBe('TEST');
      expect(res.actualVerified).toBe(false);
      expect(res.actualAmountKrw).toBeNull();
      expect(res.actualRefundAmountKrw).toBeNull();
      expect(res.actualDeliveryCount).toBeNull();
      expect(res.actualCostKrw).toBeNull();
      expect(transport.getAttemptCount()).toBe(1);
    });

    it('returns TEST_ACCEPTED without checkout URL for refund', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'refund',
        operationKey: 'op-ref-1',
      };
      const res = (await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([30, 40]),
      })) as Extract<TestSubmitResult, { kind: 'TEST_REQUEST_RESULT' }>;

      expect(res.kind).toBe('TEST_REQUEST_RESULT');
      expect(res.status).toBe('TEST_ACCEPTED');
      expect(res.acceptanceRef).toMatch(/^test-request:/);
      expect(res.checkoutUrl).toBeNull();
    });

    it('returns TEST_ACCEPTED without checkout URL for message', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'kakao',
        action: 'message',
        operationKey: 'op-msg-1',
      };
      const res = (await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([50, 60]),
      })) as Extract<TestSubmitResult, { kind: 'TEST_REQUEST_RESULT' }>;

      expect(res.kind).toBe('TEST_REQUEST_RESULT');
      expect(res.status).toBe('TEST_ACCEPTED');
      expect(res.acceptanceRef).toMatch(/^test-request:/);
      expect(res.checkoutUrl).toBeNull();
    });
  });

  describe('idempotency, replay, and conflict semantics', () => {
    it('replays existing journal result on same key and same bytes without consuming script', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED', 'TEST_REJECTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-replay-1',
      };
      const request: TestRequest = {
        scope,
        payload: new Uint8Array([1, 2, 3, 4]),
      };

      const first = (await transport.submit(validContext, request)) as Extract<
        TestSubmitResult,
        { kind: 'TEST_REQUEST_RESULT' }
      >;
      expect(first.status).toBe('TEST_ACCEPTED');
      expect(first.replay).toBe(false);
      expect(transport.getAttemptCount()).toBe(1);

      const second = (await transport.submit(validContext, request)) as Extract<
        TestSubmitResult,
        { kind: 'TEST_REQUEST_RESULT' }
      >;
      expect(second.status).toBe('TEST_ACCEPTED');
      expect(second.replay).toBe(true);
      expect(second.acceptanceRef).toBe(first.acceptanceRef);
      expect(transport.getAttemptCount()).toBe(1); // Script unconsumed, attempt count unchanged!
    });

    it('returns CONFLICT on same key with different payload bytes', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED', 'TEST_ACCEPTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-conflict-1',
      };

      await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([1, 2, 3]),
      });

      const conflictRes = (await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([9, 9, 9]),
      })) as Extract<TestSubmitResult, { kind: 'TEST_REQUEST_RESULT' }>;

      expect(conflictRes.kind).toBe('TEST_REQUEST_RESULT');
      expect(conflictRes.status).toBe('TEST_CONFLICT');
    });

    it('isolates same operationKey under different workspaces', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED', 'TEST_REJECTED']);
      const requestA: TestRequest = {
        scope: {
          workspaceId: validWorkspaceId,
          provider: 'portone',
          action: 'payment',
          operationKey: 'op-shared-key',
        },
        payload: new Uint8Array([1, 2, 3]),
      };
      const requestB: TestRequest = {
        scope: {
          workspaceId: otherWorkspaceId,
          provider: 'portone',
          action: 'payment',
          operationKey: 'op-shared-key',
        },
        payload: new Uint8Array([1, 2, 3]),
      };

      const resA = (await transport.submit(validContext, requestA)) as Extract<
        TestSubmitResult,
        { kind: 'TEST_REQUEST_RESULT' }
      >;
      const resB = (await transport.submit(validContext, requestB)) as Extract<
        TestSubmitResult,
        { kind: 'TEST_REQUEST_RESULT' }
      >;

      expect(resA.status).toBe('TEST_ACCEPTED');
      expect(resB.status).toBe('TEST_REJECTED');
      expect(resA.scope.workspaceId).toBe(validWorkspaceId);
      expect(resB.scope.workspaceId).toBe(otherWorkspaceId);
    });

    it('claims in-flight first and denies concurrent duplicate without URL', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-concurrent-1',
      };

      // Manually acquire in-flight lock to simulate concurrent arrival
      transport._simulateInFlightClaim(scope, new Uint8Array([1, 2]));

      const inFlightRes = (await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([1, 2]),
      })) as Extract<TestSubmitResult, { kind: 'TEST_REQUEST_RESULT' }>;

      expect(inFlightRes.status).toBe('TEST_IN_FLIGHT');
      expect(inFlightRes.acceptanceRef).toBeNull();
      expect(inFlightRes.checkoutUrl).toBeNull();
    });
  });

  describe('TEST_UNKNOWN terminal semantics', () => {
    it('records UNKNOWN as terminal with 0 re-calls and allows read-only observation', async () => {
      const transport = new MinimalTestTransport(['TEST_UNKNOWN']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-unknown-1',
      };
      const request: TestRequest = {
        scope,
        payload: new Uint8Array([4, 5, 6]),
      };

      const res = (await transport.submit(validContext, request)) as Extract<
        TestSubmitResult,
        { kind: 'TEST_REQUEST_RESULT' }
      >;
      expect(res.status).toBe('TEST_UNKNOWN');
      expect(res.acceptanceRef).toBeNull();
      expect(res.checkoutUrl).toBeNull();

      // Re-calling with same key returns terminal replay
      const replayRes = (await transport.submit(validContext, request)) as Extract<
        TestSubmitResult,
        { kind: 'TEST_REQUEST_RESULT' }
      >;
      expect(replayRes.status).toBe('TEST_UNKNOWN');
      expect(replayRes.replay).toBe(true);
      expect(transport.getAttemptCount()).toBe(1);

      // Observation is still allowed to be read
      const obsRes = await transport.readObservation(validContext, scope);
      expect(obsRes.kind).toBe('TEST_OBSERVATION_RESULT');
      if (obsRes.kind !== 'TEST_OBSERVATION_RESULT') {
        throw new Error('fixture failed: expected TEST_OBSERVATION_RESULT');
      }
      expect(obsRes.status).toBe('NOT_OBSERVED');
    });
  });

  describe('independent observation fixtures', () => {
    it('returns NOT_OBSERVED when no observation is seeded', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-obs-empty',
      };
      await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([1]),
      });

      const obs = await transport.readObservation(validContext, scope);
      expect(obs.kind).toBe('TEST_OBSERVATION_RESULT');
      if (obs.kind !== 'TEST_OBSERVATION_RESULT') {
        throw new Error('fixture failed: expected TEST_OBSERVATION_RESULT');
      }
      expect(obs.status).toBe('NOT_OBSERVED');
    });

    it('reads successfully when matching fixture is seeded', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-obs-matched',
      };
      const submitRes = (await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([1, 2]),
      })) as Extract<TestSubmitResult, { kind: 'TEST_REQUEST_RESULT' }>;

      const fixture: TestObservationFixture = {
        kind: 'TEST_OBSERVATION',
        datasetMode: 'TEST',
        actualVerified: false,
        scope,
        requestFingerprint: submitRes.requestFingerprint,
        observationRef: 'test-observation:fixture-1',
        observedAt: '2026-10-22T10:05:00.000Z',
        payloadBytes: new Uint8Array([99, 100]),
      };
      transport.seedObservation(fixture);

      const obs = await transport.readObservation(validContext, scope);
      expect(obs.kind).toBe('TEST_OBSERVATION_RESULT');
      if (obs.kind !== 'TEST_OBSERVATION_RESULT') {
        throw new Error('fixture failed: expected TEST_OBSERVATION_RESULT');
      }
      expect(obs.status).toBe('TEST_OBSERVATION_AVAILABLE');
      if (obs.status !== 'TEST_OBSERVATION_AVAILABLE') {
        throw new Error('fixture failed: expected TEST_OBSERVATION_AVAILABLE');
      }
      expect(obs.actualVerified).toBe(false);
      expect(obs.actualAmountKrw).toBeNull();
      expect(obs.observationRef).toBe('test-observation:fixture-1');
      expect(obs.payloadBytes).toEqual(new Uint8Array([99, 100]));
    });

    it('rejects foreign observation fixture or mismatched fingerprint with CONFLICT', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-obs-conflict',
      };
      await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([1, 2]),
      });

      const foreignFixture: TestObservationFixture = {
        kind: 'TEST_OBSERVATION',
        datasetMode: 'TEST',
        actualVerified: false,
        scope,
        requestFingerprint: 'sha256:different-fingerprint',
        observationRef: 'test-observation:fixture-bad',
        observedAt: '2026-10-22T10:05:00.000Z',
        payloadBytes: new Uint8Array([1]),
      };
      transport.seedObservation(foreignFixture);

      const obs = await transport.readObservation(validContext, scope);
      expect(obs.kind).toBe('TEST_OBSERVATION_RESULT');
      if (obs.kind !== 'TEST_OBSERVATION_RESULT') {
        throw new Error('fixture failed: expected TEST_OBSERVATION_RESULT');
      }
      expect(obs.status).toBe('CONFLICT');
    });

    it('refuses seeding ACTUAL fixture', () => {
      const transport = new MinimalTestTransport();
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-obs-actual',
      };
      const actualFixture = {
        kind: 'TEST_OBSERVATION',
        datasetMode: 'ACTUAL',
        actualVerified: false,
        scope,
        requestFingerprint: 'sha256:abc',
        observationRef: 'test-observation:1',
        observedAt: '2026-10-22T10:00:00.000Z',
        payloadBytes: new Uint8Array([1]),
      } as unknown as TestObservationFixture;

      expect(() => transport.seedObservation(actualFixture)).toThrow(/TEST_DATASET_ONLY/);
    });
  });

  describe('byte mutation isolation', () => {
    it('isolates submit request payload bytes from mutation', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-mutation-1',
      };
      const inputBytes = new Uint8Array([1, 2, 3]);
      const res = (await transport.submit(validContext, {
        scope,
        payload: inputBytes,
      })) as Extract<TestSubmitResult, { kind: 'TEST_REQUEST_RESULT' }>;

      // Mutate caller's original array
      inputBytes[0] = 99;

      // Replay with original bytes should still match fingerprint and succeed
      const replayRes = (await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([1, 2, 3]),
      })) as Extract<TestSubmitResult, { kind: 'TEST_REQUEST_RESULT' }>;
      expect(replayRes.requestFingerprint).toBe(res.requestFingerprint);
      expect(replayRes.replay).toBe(true);
    });

    it('isolates returned observation payload bytes from mutation', async () => {
      const transport = new MinimalTestTransport(['TEST_ACCEPTED']);
      const scope: Scope = {
        workspaceId: validWorkspaceId,
        provider: 'portone',
        action: 'payment',
        operationKey: 'op-obs-mut',
      };
      const submitRes = (await transport.submit(validContext, {
        scope,
        payload: new Uint8Array([1]),
      })) as Extract<TestSubmitResult, { kind: 'TEST_REQUEST_RESULT' }>;

      transport.seedObservation({
        kind: 'TEST_OBSERVATION',
        datasetMode: 'TEST',
        actualVerified: false,
        scope,
        requestFingerprint: submitRes.requestFingerprint,
        observationRef: 'test-observation:mut',
        observedAt: '2026-10-22T10:05:00.000Z',
        payloadBytes: new Uint8Array([5, 6, 7]),
      });

      const obs1 = await transport.readObservation(validContext, scope);
      expect(obs1.kind).toBe('TEST_OBSERVATION_RESULT');
      if (obs1.kind !== 'TEST_OBSERVATION_RESULT') {
        throw new Error('fixture failed: expected TEST_OBSERVATION_RESULT');
      }
      expect(obs1.status).toBe('TEST_OBSERVATION_AVAILABLE');
      if (obs1.status !== 'TEST_OBSERVATION_AVAILABLE') {
        throw new Error('fixture failed: expected TEST_OBSERVATION_AVAILABLE');
      }
      obs1.payloadBytes[0] = 99; // mutate returned array

      const obs2 = await transport.readObservation(validContext, scope);
      expect(obs2.kind).toBe('TEST_OBSERVATION_RESULT');
      if (obs2.kind !== 'TEST_OBSERVATION_RESULT') {
        throw new Error('fixture failed: expected TEST_OBSERVATION_RESULT');
      }
      expect(obs2.status).toBe('TEST_OBSERVATION_AVAILABLE');
      if (obs2.status !== 'TEST_OBSERVATION_AVAILABLE') {
        throw new Error('fixture failed: expected TEST_OBSERVATION_AVAILABLE');
      }
      expect(obs2.payloadBytes).toEqual(new Uint8Array([5, 6, 7]));
    });
  });
});
