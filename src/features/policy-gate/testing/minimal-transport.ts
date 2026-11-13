/**
 * Minimal Transport Contract
 * ANI-1616 / ANI-1617 / ANI-1620
 * Strict TEST transport journal & decoupled observation fixture.
 */

import { randomUUID } from 'node:crypto';
import {
  checkMinimalAdmission,
  type Context,
  type Scope,
  type TestRequest,
  type AdmissionDenied,
} from './minimal-admission';
export type TestSubmitStatus =
  | 'TEST_IN_FLIGHT'
  | 'TEST_ACCEPTED'
  | 'TEST_REJECTED'
  | 'TEST_UNKNOWN'
  | 'TEST_CONFLICT';

export type TestRequestResult = Readonly<{
  kind: 'TEST_REQUEST_RESULT';
  datasetMode: 'TEST';
  actualVerified: false;
  scope: Scope;
  requestFingerprint: string;
  replay: boolean;
  status: TestSubmitStatus;
  acceptanceRef: string | null;
  checkoutUrl: string | null;
  actualAmountKrw: null;
  actualRefundAmountKrw: null;
  actualDeliveryCount: null;
  actualCostKrw: null;
}>;

export type TestSubmitResult = TestRequestResult | AdmissionDenied;

export type TestObservationStatus =
  | 'TEST_OBSERVATION_AVAILABLE'
  | 'NOT_OBSERVED'
  | 'CONFLICT';

export type TestObservationSuccess = Readonly<{
  kind: 'TEST_OBSERVATION_RESULT';
  datasetMode: 'TEST';
  actualVerified: false;
  scope: Scope;
  requestFingerprint: string;
  status: 'TEST_OBSERVATION_AVAILABLE';
  observationRef: string;
  observedAt: string;
  payloadBytes: Uint8Array;
  actualAmountKrw: null;
  actualRefundAmountKrw: null;
  actualDeliveryCount: null;
  actualCostKrw: null;
}>;

export type TestObservationEmpty = Readonly<{
  kind: 'TEST_OBSERVATION_RESULT';
  datasetMode: 'TEST';
  actualVerified: false;
  scope: Scope;
  requestFingerprint: string;
  status: 'NOT_OBSERVED';
  observationRef: null;
  observedAt: null;
  payloadBytes: null;
  actualAmountKrw: null;
  actualRefundAmountKrw: null;
  actualDeliveryCount: null;
  actualCostKrw: null;
}>;

export type TestObservationConflict = Readonly<{
  kind: 'TEST_OBSERVATION_RESULT';
  datasetMode: 'TEST';
  actualVerified: false;
  scope: Scope;
  requestFingerprint: string;
  status: 'CONFLICT';
  observationRef: null;
  observedAt: null;
  payloadBytes: null;
  actualAmountKrw: null;
  actualRefundAmountKrw: null;
  actualDeliveryCount: null;
  actualCostKrw: null;
}>;

export type TestObservationResult =
  | TestObservationSuccess
  | TestObservationEmpty
  | TestObservationConflict
  | AdmissionDenied;

export type TestObservationFixture = Readonly<{
  kind: 'TEST_OBSERVATION';
  datasetMode: 'TEST';
  actualVerified: false;
  scope: Scope;
  requestFingerprint: string;
  observationRef: string;
  observedAt: string;
  payloadBytes: Uint8Array;
}>;

export interface TestTransport {
  submit(context: Context, request: TestRequest): Promise<TestSubmitResult>;
  readObservation(context: Context, scope: Scope): Promise<TestObservationResult>;
}

// 순수 계산 함수는 운영 모듈로 옮겼다. 이 파일 안에서도 쓰고(아래 submit), 기존 테스트 import
// 경로도 깨지지 않도록 import 후 재export 한다. `export ... from` 만 쓰면 지역 바인딩이 없어
// 아래 사용처에서 ReferenceError 가 난다.
import { computeRequestFingerprint, scopeKey } from '../request-fingerprint';
export { computeRequestFingerprint, scopeKey };

export class MinimalTestTransport implements TestTransport {
  private scripts: ('TEST_ACCEPTED' | 'TEST_REJECTED' | 'TEST_UNKNOWN')[];
  private journal: Map<string, { fingerprint: string; result: TestRequestResult; payload: Uint8Array }> = new Map();
  private inFlight: Map<string, { fingerprint: string }> = new Map();
  private observations: Map<string, TestObservationFixture> = new Map();
  private attemptCount = 0;

  constructor(scripts: readonly ('TEST_ACCEPTED' | 'TEST_REJECTED' | 'TEST_UNKNOWN')[] = []) {
    this.scripts = [...scripts];
  }

  getAttemptCount(): number {
    return this.attemptCount;
  }

  _simulateInFlightClaim(scope: Scope, payload: Uint8Array): void {
    const key = scopeKey(scope);
    const fingerprint = computeRequestFingerprint(scope, payload);
    this.inFlight.set(key, { fingerprint });
  }

  seedObservation(fixture: TestObservationFixture): void {
    if (fixture.datasetMode !== 'TEST') {
      throw new Error('TEST_DATASET_ONLY: cannot seed non-TEST observation fixture');
    }
    if (fixture.kind !== 'TEST_OBSERVATION') {
      throw new Error('INVALID_FIXTURE_KIND');
    }
    if (fixture.actualVerified !== false) {
      throw new Error('ACTUAL_VERIFIED_FORBIDDEN');
    }
    if (!fixture.observationRef || !fixture.observationRef.startsWith('test-observation:')) {
      throw new Error('INVALID_OBSERVATION_REF: must start with test-observation:');
    }
    const key = scopeKey(fixture.scope);
    this.observations.set(key, {
      ...fixture,
      payloadBytes: new Uint8Array(fixture.payloadBytes),
    });
  }

  async submit(context: Context, request: TestRequest): Promise<TestSubmitResult> {
    const payloadCopy = new Uint8Array(request.payload);
    const fingerprint = computeRequestFingerprint(request.scope, payloadCopy);
    const key = scopeKey(request.scope);

    // 1. Check in-flight claim before any await
    if (this.inFlight.has(key)) {
      const claim = this.inFlight.get(key)!;
      if (claim.fingerprint !== fingerprint) {
        return {
          kind: 'TEST_REQUEST_RESULT',
          datasetMode: 'TEST',
          actualVerified: false,
          scope: request.scope,
          requestFingerprint: fingerprint,
          replay: false,
          status: 'TEST_CONFLICT',
          acceptanceRef: null,
          checkoutUrl: null,
          actualAmountKrw: null,
          actualRefundAmountKrw: null,
          actualDeliveryCount: null,
          actualCostKrw: null,
        };
      }
      return {
        kind: 'TEST_REQUEST_RESULT',
        datasetMode: 'TEST',
        actualVerified: false,
        scope: request.scope,
        requestFingerprint: fingerprint,
        replay: true,
        status: 'TEST_IN_FLIGHT',
        acceptanceRef: null,
        checkoutUrl: null,
        actualAmountKrw: null,
        actualRefundAmountKrw: null,
        actualDeliveryCount: null,
        actualCostKrw: null,
      };
    }

    // 2. Check existing journal (idempotency replay or conflict)
    if (this.journal.has(key)) {
      const existing = this.journal.get(key)!;
      if (existing.fingerprint !== fingerprint) {
        return {
          kind: 'TEST_REQUEST_RESULT',
          datasetMode: 'TEST',
          actualVerified: false,
          scope: request.scope,
          requestFingerprint: fingerprint,
          replay: false,
          status: 'TEST_CONFLICT',
          acceptanceRef: null,
          checkoutUrl: null,
          actualAmountKrw: null,
          actualRefundAmountKrw: null,
          actualDeliveryCount: null,
          actualCostKrw: null,
        };
      }

      // Re-apply admission check even on replay
      const admission = await checkMinimalAdmission(context, request.scope);
      if (admission.kind === 'DENIED') {
        return admission;
      }

      return {
        ...existing.result,
        replay: true,
      };
    }

    // 3. Claim in-flight synchronously before await
    this.inFlight.set(key, { fingerprint });

    try {
      // 4. Admission check
      const admission = await checkMinimalAdmission(context, request.scope);
      if (admission.kind === 'DENIED') {
        return admission;
      }

      // 5. Consume scripted response
      const status = this.scripts.length > 0 ? this.scripts.shift()! : 'TEST_UNKNOWN';
      this.attemptCount++;

      let acceptanceRef: string | null = null;
      let checkoutUrl: string | null = null;

      if (status === 'TEST_ACCEPTED') {
        acceptanceRef = `test-request:${randomUUID()}`;
        if (request.scope.action === 'payment') {
          checkoutUrl = `https://checkout.example.invalid/pay/${encodeURIComponent(request.scope.operationKey)}`;
        }
      }

      const result: TestRequestResult = {
        kind: 'TEST_REQUEST_RESULT',
        datasetMode: 'TEST',
        actualVerified: false,
        scope: request.scope,
        requestFingerprint: fingerprint,
        replay: false,
        status,
        acceptanceRef,
        checkoutUrl,
        actualAmountKrw: null,
        actualRefundAmountKrw: null,
        actualDeliveryCount: null,
        actualCostKrw: null,
      };

      this.journal.set(key, {
        fingerprint,
        result,
        payload: payloadCopy,
      });

      return result;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async readObservation(context: Context, scope: Scope): Promise<TestObservationResult> {
    const admission = await checkMinimalAdmission(context, scope);
    if (admission.kind === 'DENIED') {
      return admission;
    }

    const key = scopeKey(scope);
    const entry = this.journal.get(key);
    const fingerprint = entry ? entry.fingerprint : '';

    if (!entry) {
      return {
        kind: 'TEST_OBSERVATION_RESULT',
        datasetMode: 'TEST',
        actualVerified: false,
        scope,
        requestFingerprint: fingerprint,
        status: 'NOT_OBSERVED',
        observationRef: null,
        observedAt: null,
        payloadBytes: null,
        actualAmountKrw: null,
        actualRefundAmountKrw: null,
        actualDeliveryCount: null,
        actualCostKrw: null,
      };
    }

    const fixture = this.observations.get(key);
    if (!fixture) {
      return {
        kind: 'TEST_OBSERVATION_RESULT',
        datasetMode: 'TEST',
        actualVerified: false,
        scope,
        requestFingerprint: entry.fingerprint,
        status: 'NOT_OBSERVED',
        observationRef: null,
        observedAt: null,
        payloadBytes: null,
        actualAmountKrw: null,
        actualRefundAmountKrw: null,
        actualDeliveryCount: null,
        actualCostKrw: null,
      };
    }

    // Match validation
    const scopeMatches =
      fixture.scope.workspaceId === scope.workspaceId &&
      fixture.scope.provider === scope.provider &&
      fixture.scope.action === scope.action &&
      fixture.scope.operationKey === scope.operationKey;

    if (!scopeMatches || fixture.requestFingerprint !== entry.fingerprint) {
      return {
        kind: 'TEST_OBSERVATION_RESULT',
        datasetMode: 'TEST',
        actualVerified: false,
        scope,
        requestFingerprint: entry.fingerprint,
        status: 'CONFLICT',
        observationRef: null,
        observedAt: null,
        payloadBytes: null,
        actualAmountKrw: null,
        actualRefundAmountKrw: null,
        actualDeliveryCount: null,
        actualCostKrw: null,
      };
    }

    return {
      kind: 'TEST_OBSERVATION_RESULT',
      datasetMode: 'TEST',
      actualVerified: false,
      scope,
      requestFingerprint: entry.fingerprint,
      status: 'TEST_OBSERVATION_AVAILABLE',
      observationRef: fixture.observationRef,
      observedAt: fixture.observedAt,
      payloadBytes: new Uint8Array(fixture.payloadBytes),
      actualAmountKrw: null,
      actualRefundAmountKrw: null,
      actualDeliveryCount: null,
      actualCostKrw: null,
    };
  }
}
