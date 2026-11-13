/**
 * Minimal Webhook Verifier Contract
 * ANI-1616 / ANI-1617 / ANI-1620
 * Strict TEST signature verifier for SOHEE_MINIMAL_TEST_V1 protocol.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  type Context,
  type Scope,
  type Provider,
  type Action,
} from '../../policy-gate/testing/minimal-admission';

export const SUPPORTED_TEST_PROTOCOL = 'SOHEE_MINIMAL_TEST_V1';

export type TestVerifyInput = Readonly<{
  expectedScope: Scope;
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string>>;
}>;

export type TestSignatureObservation = Readonly<{
  kind: 'TEST_SIGNATURE_OBSERVATION';
  datasetMode: 'TEST';
  actualVerified: false;
  eventId: string;
  scope: Scope;
  bodyDigest: string;
}>;

export type TestSignatureFailure = Readonly<{
  kind: 'SIGNATURE_VERIFICATION_FAILED';
  reason: string;
}>;

export type TestSignatureResult = TestSignatureObservation | TestSignatureFailure;

export interface TestVerifier {
  verify(context: Context, input: TestVerifyInput): Promise<TestSignatureResult>;
}

export type WebhookVerifierOptions = Readonly<{
  secret: string;
  pastToleranceMs?: number;
  futureToleranceMs?: number;
}>;

export function createSignatureFrame(params: {
  protocol: string;
  timestamp: string;
  eventId: string;
  scope: Scope;
  rawBody: Uint8Array;
}): Buffer {
  const metaTuple = [
    params.protocol,
    params.timestamp,
    params.eventId,
    params.scope.workspaceId,
    params.scope.provider,
    params.scope.action,
    params.scope.operationKey,
  ];
  const metaJson = JSON.stringify(metaTuple);
  const metaBytes = Buffer.from(metaJson, 'utf8');
  const lenPrefix = Buffer.alloc(4);
  lenPrefix.writeUInt32BE(metaBytes.length, 0);

  return Buffer.concat([lenPrefix, metaBytes, Buffer.from(params.rawBody)]);
}

export function signMinimalTestPayload(params: {
  secret: string;
  protocol: string;
  timestamp: string;
  eventId: string;
  scope: Scope;
  rawBody: Uint8Array;
}): Record<string, string> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PRODUCTION_FORBIDDEN: minimal test signer cannot be run in production');
  }

  const frame = createSignatureFrame(params);
  const signature = createHmac('sha256', params.secret).update(frame).digest('hex');

  return {
    'x-sohee-test-protocol': params.protocol,
    'x-sohee-test-timestamp': params.timestamp,
    'x-sohee-test-event': params.eventId,
    'x-sohee-test-workspace': params.scope.workspaceId,
    'x-sohee-test-provider': params.scope.provider,
    'x-sohee-test-action': params.scope.action,
    'x-sohee-test-operation': params.scope.operationKey,
    'x-sohee-test-signature': signature,
  };
}

function getHeader(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

const OFFSET_ISO_REGEX = /(Z|[+-]\d{2}:?\d{2})$/i;

export class MinimalTestWebhookVerifier implements TestVerifier {
  private readonly secret: string;
  private readonly pastToleranceMs: number;
  private readonly futureToleranceMs: number;

  constructor(options: WebhookVerifierOptions) {
    this.secret = options.secret;
    this.pastToleranceMs = options.pastToleranceMs ?? 300_000; // 5 minutes
    this.futureToleranceMs = options.futureToleranceMs ?? 60_000; // 1 minute
  }

  async verify(context: Context, input: TestVerifyInput): Promise<TestSignatureResult> {
    if (process.env.NODE_ENV === 'production') {
      return { kind: 'SIGNATURE_VERIFICATION_FAILED', reason: 'PRODUCTION_FORBIDDEN' };
    }

    if (!context.now || !(context.now instanceof Date) || isNaN(context.now.getTime())) {
      return { kind: 'SIGNATURE_VERIFICATION_FAILED', reason: 'INVALID_NOW' };
    }

    const headers = input.headers;
    const protocol = getHeader(headers, 'x-sohee-test-protocol');
    const timestamp = getHeader(headers, 'x-sohee-test-timestamp');
    const eventId = getHeader(headers, 'x-sohee-test-event');
    const workspaceId = getHeader(headers, 'x-sohee-test-workspace');
    const provider = getHeader(headers, 'x-sohee-test-provider') as Provider | undefined;
    const action = getHeader(headers, 'x-sohee-test-action') as Action | undefined;
    const operationKey = getHeader(headers, 'x-sohee-test-operation');
    const signature = getHeader(headers, 'x-sohee-test-signature');

    if (
      !protocol ||
      !timestamp ||
      !eventId ||
      !workspaceId ||
      !provider ||
      !action ||
      !operationKey ||
      !signature
    ) {
      return { kind: 'SIGNATURE_VERIFICATION_FAILED', reason: 'MISSING_REQUIRED_HEADERS' };
    }

    if (protocol !== SUPPORTED_TEST_PROTOCOL) {
      return { kind: 'SIGNATURE_VERIFICATION_FAILED', reason: 'UNSUPPORTED_PROTOCOL' };
    }

    const headerScope: Scope = {
      workspaceId,
      provider,
      action,
      operationKey,
    };

    if (
      headerScope.workspaceId !== input.expectedScope.workspaceId ||
      headerScope.provider !== input.expectedScope.provider ||
      headerScope.action !== input.expectedScope.action ||
      headerScope.operationKey !== input.expectedScope.operationKey
    ) {
      return { kind: 'SIGNATURE_VERIFICATION_FAILED', reason: 'SCOPE_MISMATCH' };
    }

    if (!OFFSET_ISO_REGEX.test(timestamp)) {
      return { kind: 'SIGNATURE_VERIFICATION_FAILED', reason: 'INVALID_TIMESTAMP_FORMAT' };
    }

    const timestampDate = new Date(timestamp);
    if (isNaN(timestampDate.getTime())) {
      return { kind: 'SIGNATURE_VERIFICATION_FAILED', reason: 'INVALID_TIMESTAMP_FORMAT' };
    }

    const diff = context.now.getTime() - timestampDate.getTime();
    if (diff > this.pastToleranceMs) {
      return { kind: 'SIGNATURE_VERIFICATION_FAILED', reason: 'TIMESTAMP_EXPIRED' };
    }
    if (diff < -this.futureToleranceMs) {
      return { kind: 'SIGNATURE_VERIFICATION_FAILED', reason: 'TIMESTAMP_FUTURE' };
    }

    const frame = createSignatureFrame({
      protocol,
      timestamp,
      eventId,
      scope: headerScope,
      rawBody: input.rawBody,
    });

    const expectedSignature = createHmac('sha256', this.secret).update(frame).digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const providedBuf = Buffer.from(signature, 'utf8');

    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      return { kind: 'SIGNATURE_VERIFICATION_FAILED', reason: 'INVALID_SIGNATURE' };
    }

    const bodyDigest = `sha256:${createHash('sha256').update(input.rawBody).digest('hex')}`;

    return {
      kind: 'TEST_SIGNATURE_OBSERVATION',
      datasetMode: 'TEST',
      actualVerified: false,
      eventId,
      scope: input.expectedScope,
      bodyDigest,
    };
  }
}
