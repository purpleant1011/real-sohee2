/**
 * Test-Only Fake Channel Provider (ANI-1640 / ANI-1641 v2)
 *
 * Implements an isolated, zero-network fake provider simulating
 * transport and readback failure modes (401, 403, 429, 5xx, timeout-after-record,
 * readback mismatches on text/recipient/sender/messageId/observedAt).
 *
 * Crucial Invariant:
 * - Separates transport invocation attempts (sendAttempts) from actual
 *   internally committed side effects (sideEffectsRecorded).
 * - NOT a production SSOT. Used strictly to observe contract behaviors.
 */

import type { ReadbackResult, AttemptedSendEvidence } from '@/features/booking-recovery/reconcile';

export type FakeFailureMode =
  | 'OK'
  | 'AUTH_401'
  | 'AUTH_403'
  | 'RATE_LIMIT_429'
  | 'SERVER_ERROR_500'
  | 'SERVER_ERROR_502'
  | 'SERVER_ERROR_503'
  | 'SERVER_ERROR_504'
  | 'TIMEOUT_BEFORE_RECORD'
  | 'TIMEOUT_AFTER_RECORD'
  | 'READBACK_NOT_FOUND'
  | 'READBACK_IS_NOT_LIVE'
  | 'READBACK_MISMATCH_TEXT'
  | 'READBACK_MISMATCH_RECIPIENT'
  | 'READBACK_MISMATCH_SENDER'
  | 'READBACK_MISMATCH_MESSAGE_ID'
  | 'READBACK_OBSERVED_PAST'
  | 'READBACK_OBSERVED_FUTURE'
  | 'READBACK_EXCEPTION';

export interface FakeRecordedMessage {
  id: string;
  pageId: string;
  recipientId: string;
  text: string;
  recordedAt: string;
}

export interface ReconcileReadbackExpected {
  workspaceId: string;
  caseId: string;
  sourceEventKey: string;
  expectedRecipientId: string;
  expectedText: string;
  expectedSenderId: string;
  expectedProviderMessageId?: string;
  attemptedSend?: AttemptedSendEvidence;
}

export class FakeChannelProvider {
  public sendAttempts = 0;
  public sideEffectsRecorded = 0;
  public readbackAttempts = 0;

  private records = new Map<string, FakeRecordedMessage>();
  private failureMode: FakeFailureMode = 'OK';
  private messageCounter = 0;

  constructor(initialMode: FakeFailureMode = 'OK') {
    this.failureMode = initialMode;
  }

  setMode(mode: FakeFailureMode): void {
    this.failureMode = mode;
  }

  resetMetrics(): void {
    this.sendAttempts = 0;
    this.sideEffectsRecorded = 0;
    this.readbackAttempts = 0;
    this.records.clear();
    this.messageCounter = 0;
  }

  /**
   * Seam conforming to `sendProviderDm` dependency in `approveAndSendReply`.
   */
  async sendDm(payload: {
    pageId: string;
    recipientId: string;
    accessToken: string;
    text: string;
  }): Promise<{ providerMessageId: string }> {
    this.sendAttempts += 1;

    // Failures before recording any side effect
    if (this.failureMode === 'AUTH_401') {
      const err: any = new Error('Meta Graph API: Invalid OAuth access token (401)');
      err.status = 401;
      err.code = 'TOKEN_EXPIRED';
      throw err;
    }

    if (this.failureMode === 'AUTH_403') {
      const err: any = new Error('Meta Graph API: Insufficient permissions for user (403)');
      err.status = 403;
      err.code = 'PERMISSION_DENIED';
      throw err;
    }

    if (this.failureMode === 'RATE_LIMIT_429') {
      const err: any = new Error('Meta Graph API: User request limit reached (429)');
      err.status = 429;
      err.code = 'RATE_LIMITED';
      throw err;
    }

    if (this.failureMode === 'SERVER_ERROR_500') {
      const err: any = new Error('Meta Graph API: Internal server error (500)');
      err.status = 500;
      err.code = 'TEMPORARY_NETWORK';
      throw err;
    }

    if (this.failureMode === 'SERVER_ERROR_502') {
      const err: any = new Error('Meta Graph API: Bad Gateway (502)');
      err.status = 502;
      err.code = 'TEMPORARY_NETWORK';
      throw err;
    }

    if (this.failureMode === 'SERVER_ERROR_503') {
      const err: any = new Error('Meta Graph API: Service Unavailable (503)');
      err.status = 503;
      err.code = 'TEMPORARY_NETWORK';
      throw err;
    }

    if (this.failureMode === 'SERVER_ERROR_504') {
      const err: any = new Error('Meta Graph API: Gateway Timeout (504)');
      err.status = 504;
      err.code = 'TEMPORARY_NETWORK';
      throw err;
    }

    if (this.failureMode === 'TIMEOUT_BEFORE_RECORD') {
      const err: any = new Error('Connection timed out before upstream provider recorded message');
      err.code = 'ETIMEDOUT';
      throw err;
    }

    // Success path or Timeout AFTER recording side effect
    this.messageCounter += 1;
    const msgId = `fake_mid_${Date.now()}_${this.messageCounter}`;
    this.records.set(msgId, {
      id: msgId,
      pageId: payload.pageId,
      recipientId: payload.recipientId,
      text: payload.text,
      recordedAt: new Date().toISOString(),
    });
    this.sideEffectsRecorded += 1;

    if (this.failureMode === 'TIMEOUT_AFTER_RECORD') {
      // Provider internally committed the message, but connection dropped before response
      const err: any = new Error('HTTP 504 Gateway Timeout: Response dropped after write');
      err.code = 'ETIMEDOUT';
      throw err;
    }

    return { providerMessageId: msgId };
  }

  /**
   * Seam conforming to `readbackFetcher` in `approveAndSendReply`.
   */
  async readbackDm(payload: {
    messageId: string;
    accessToken: string;
  }): Promise<{
    isLive: boolean;
    reason?: string;
    messageId?: string;
    text?: string;
    senderId?: string;
    recipientId?: string;
    observedAt?: string;
  }> {
    this.readbackAttempts += 1;

    if (this.failureMode === 'READBACK_EXCEPTION') {
      throw new Error('Upstream provider connection error during readback');
    }

    if (this.failureMode === 'READBACK_NOT_FOUND') {
      return { isLive: false, reason: 'Message not found on upstream provider' };
    }

    const record = this.records.get(payload.messageId);
    if (!record) {
      return { isLive: false, reason: 'Message not found in fake provider store' };
    }

    if (this.failureMode === 'READBACK_IS_NOT_LIVE') {
      return {
        isLive: false,
        reason: 'Provider reported message is not live',
        messageId: record.id,
        text: record.text,
        senderId: record.pageId,
        recipientId: record.recipientId,
        observedAt: new Date().toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_MISMATCH_TEXT') {
      return {
        isLive: true,
        reason: 'Text mismatch injected',
        messageId: record.id,
        text: '위조된_불일치_본문',
        senderId: record.pageId,
        recipientId: record.recipientId,
        observedAt: new Date().toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_MISMATCH_RECIPIENT') {
      return {
        isLive: true,
        reason: 'Recipient mismatch injected',
        messageId: record.id,
        text: record.text,
        senderId: record.pageId,
        recipientId: 'victim_other_customer_999',
        observedAt: new Date().toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_MISMATCH_SENDER') {
      return {
        isLive: true,
        reason: 'Sender mismatch injected',
        messageId: record.id,
        text: record.text,
        senderId: 'wrong_page_999',
        recipientId: record.recipientId,
        observedAt: new Date().toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_MISMATCH_MESSAGE_ID') {
      return {
        isLive: true,
        reason: 'MessageId mismatch injected',
        messageId: 'different_message_id_999',
        text: record.text,
        senderId: record.pageId,
        recipientId: record.recipientId,
        observedAt: new Date().toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_OBSERVED_PAST') {
      return {
        isLive: true,
        messageId: record.id,
        text: record.text,
        senderId: record.pageId,
        recipientId: record.recipientId,
        observedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_OBSERVED_FUTURE') {
      return {
        isLive: true,
        messageId: record.id,
        text: record.text,
        senderId: record.pageId,
        recipientId: record.recipientId,
        observedAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };
    }

    return {
      isLive: true,
      messageId: record.id,
      text: record.text,
      senderId: record.pageId,
      recipientId: record.recipientId,
      observedAt: new Date().toISOString(),
    };
  }

  /**
   * Seam conforming to `reconcileOutboxItem`'s `readbackFetcher`.
   * Requires explicit matching on expected recipient/text/sender/messageId.
   * Never returns verified: true arbitrarily for unverified or mismatched records.
   */
  async reconcileReadback(params: ReconcileReadbackExpected): Promise<ReadbackResult> {
    this.readbackAttempts += 1;

    if (this.failureMode === 'READBACK_EXCEPTION') {
      throw new Error('Reconciliation readback upstream failure');
    }

    if (this.failureMode === 'READBACK_NOT_FOUND') {
      return { verified: false, reason: 'Readback not found' };
    }

    // Required fields check: expected recipient, text, and sender must be provided
    if (!params.expectedRecipientId || !params.expectedText || !params.expectedSenderId) {
      return {
        verified: false,
        reason: 'Unbound reconcile readback: missing mandatory expected recipient, text, or sender',
      };
    }

    // Check workspace and case binding from sourceEventKey
    const expectedKeyPrefix = `recovery:${params.caseId}:send:`;
    if (!params.sourceEventKey.startsWith(expectedKeyPrefix)) {
      return {
        verified: false,
        reason: 'Source event key does not match target case',
      };
    }

    const records = Array.from(this.records.values());
    if (records.length === 0) {
      return { verified: false, reason: 'No message recorded in provider' };
    }

    const matched = records.find((r) => {
      const recipientMatch = r.recipientId === params.expectedRecipientId;
      const textMatch = r.text === params.expectedText;
      const senderMatch = r.pageId === params.expectedSenderId;
      const msgMatch = !params.expectedProviderMessageId || r.id === params.expectedProviderMessageId;
      return recipientMatch && textMatch && senderMatch && msgMatch;
    });

    if (!matched) {
      return {
        verified: false,
        reason: 'Provider records do not match expected recipient, text, sender, or messageId',
      };
    }

    if (this.failureMode === 'READBACK_IS_NOT_LIVE') {
      return {
        verified: false,
        reason: 'Provider reports message is not live',
        providerMessageId: matched.id,
        recipientRef: matched.recipientId,
        text: matched.text,
        senderId: matched.pageId,
        observedAt: new Date().toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_MISMATCH_TEXT') {
      return {
        verified: true, // Malicious provider claiming verified
        providerMessageId: matched.id,
        recipientRef: matched.recipientId,
        text: '위조된_불일치_본문',
        senderId: matched.pageId,
        observedAt: new Date().toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_MISMATCH_RECIPIENT') {
      return {
        verified: true,
        providerMessageId: matched.id,
        recipientRef: 'victim_other_customer_999',
        text: matched.text,
        senderId: matched.pageId,
        observedAt: new Date().toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_MISMATCH_SENDER') {
      return {
        verified: true,
        providerMessageId: matched.id,
        recipientRef: matched.recipientId,
        text: matched.text,
        senderId: 'wrong_page_999',
        observedAt: new Date().toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_MISMATCH_MESSAGE_ID') {
      return {
        verified: true,
        providerMessageId: 'different_message_id_999',
        recipientRef: matched.recipientId,
        text: matched.text,
        senderId: matched.pageId,
        observedAt: new Date().toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_OBSERVED_PAST') {
      return {
        verified: true,
        providerMessageId: matched.id,
        recipientRef: matched.recipientId,
        text: matched.text,
        senderId: matched.pageId,
        observedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      };
    }

    if (this.failureMode === 'READBACK_OBSERVED_FUTURE') {
      return {
        verified: true,
        providerMessageId: matched.id,
        recipientRef: matched.recipientId,
        text: matched.text,
        senderId: matched.pageId,
        observedAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };
    }

    return {
      verified: true,
      providerMessageId: matched.id,
      recipientRef: matched.recipientId,
      text: matched.text,
      senderId: matched.pageId,
      observedAt: new Date().toISOString(),
    };
  }

  getRecord(messageId: string): FakeRecordedMessage | undefined {
    return this.records.get(messageId);
  }

  getAllRecords(): readonly FakeRecordedMessage[] {
    return Array.from(this.records.values());
  }
}
