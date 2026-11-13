import { describe, expect, it, vi } from 'vitest';
import type { IssuedBillingKeyInfo } from '@portone/server-sdk/payment/billingKey';
import {
  REVIEW_CHANNEL_KEY,
  REVIEW_COOKIE_NAME,
  REVIEW_STORE_ID,
  openReviewSession,
  readbackBillingKey,
  resolveReviewConfig,
  sealReviewSession,
  verifyBillingKeyReadback,
  type ReviewSession,
} from './pg-review-readback';

const MOCK_SECRET_32 = '12345678901234567890123456789012';

function createValidSession(overrides?: Partial<ReviewSession>): ReviewSession {
  const now = Date.now();
  return {
    issueId: 'issue_test_123',
    userId: 'user_tester_1',
    workspaceId: '11111111-2222-3333-4444-555555555555',
    planCode: 'scale',
    createdAt: now,
    expiresAt: now + 900_000,
    ...overrides,
  };
}

function createValidIssuedInfo(overrides?: Partial<IssuedBillingKeyInfo>): IssuedBillingKeyInfo {
  return {
    status: 'ISSUED',
    billingKey: 'bkey_mock_abc123',
    merchantId: 'merchant_test_1',
    storeId: REVIEW_STORE_ID,
    channels: [
      {
        key: REVIEW_CHANNEL_KEY,
        type: 'TEST',
        pgProvider: 'INICIS_V2',
        pgMerchantId: 'INIBillTst',
      },
    ],
    customer: {
      id: 'user_tester_1',
    },
    issueId: 'issue_test_123',
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('pg-review-readback constants & config', () => {
  it('exposes pinned review store and channel constants', () => {
    expect(REVIEW_STORE_ID).toBe('store-42cc855c-71b9-4fd7-99c9-4ef1a8a29f63');
    expect(REVIEW_CHANNEL_KEY).toBe('channel-key-a54326f5-27c7-4e36-95a1-3e2a3f28355b');
    expect(REVIEW_COOKIE_NAME).toBe('sohee-pg-review');
  });

  it('resolves review config only when all env gates are satisfied', () => {
    const validEnv = {
      NODE_ENV: 'development',
      PORTONE_REVIEW_ENABLED: '1',
      PORTONE_REVIEW_MODE: 'TEST',
      PORTONE_REVIEW_SESSION_SECRET: MOCK_SECRET_32,
      PORTONE_REVIEW_USER_IDS: 'user_1, user_2',
    };

    expect(resolveReviewConfig(validEnv)).toEqual({
      sessionSecret: MOCK_SECRET_32,
      userIds: ['user_1', 'user_2'],
    });

    expect(resolveReviewConfig({ ...validEnv, NODE_ENV: 'production' })).toBeNull();
    expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_ENABLED: '0' })).toBeNull();
    expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_MODE: 'LIVE' })).toBeNull();
    expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_SESSION_SECRET: 'short' })).toBeNull();
    expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_USER_IDS: '' })).toBeNull();
  });
});

describe('session sealing and opening', () => {
  it('seals and opens a valid session token', () => {
    const now = Date.now();
    const session = createValidSession({ createdAt: now, expiresAt: now + 900_000 });
    const token = sealReviewSession(session, MOCK_SECRET_32);
    expect(typeof token).toBe('string');

    const opened = openReviewSession(token, MOCK_SECRET_32, now + 10_000);
    expect(opened).toEqual(session);
  });

  it('rejects tampered or expired tokens', () => {
    const now = Date.now();
    const session = createValidSession({ createdAt: now, expiresAt: now + 900_000 });
    const token = sealReviewSession(session, MOCK_SECRET_32);

    // Tampered payload
    const parts = token.split('.');
    const tampered = `${parts[0]}tamper.${parts[1]}`;
    expect(openReviewSession(tampered, MOCK_SECRET_32, now)).toBeNull();

    // Expired
    expect(openReviewSession(token, MOCK_SECRET_32, now + 900_001)).toBeNull();

    // Wrong secret
    expect(openReviewSession(token, '99999999999999999999999999999999', now)).toBeNull();
  });
});

describe('verifyBillingKeyReadback pure logic', () => {
  it('succeeds with verified_test_billing_key and charged=false, activated=false when all match', () => {
    const session = createValidSession();
    const info = createValidIssuedInfo();

    const result = verifyBillingKeyReadback(info, session);
    expect(result).toEqual({
      ok: true,
      status: 'verified_test_billing_key',
      paymentCharged: false,
      subscriptionActivated: false,
    });
  });

  it('fails if status is not ISSUED', () => {
    const session = createValidSession();
    const info = createValidIssuedInfo({ status: 'DELETED' as unknown as 'ISSUED' });

    const result = verifyBillingKeyReadback(info, session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('STATUS_NOT_ISSUED');
    }
  });

  it('fails if storeId does not match REVIEW_STORE_ID', () => {
    const session = createValidSession();
    const info = createValidIssuedInfo({ storeId: 'store-other-123' });

    const result = verifyBillingKeyReadback(info, session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('STORE_ID_MISMATCH');
    }
  });

  it('fails if pinned test channel key is missing', () => {
    const session = createValidSession();
    const info = createValidIssuedInfo({
      channels: [
        {
          key: 'channel-other',
          type: 'TEST',
          pgProvider: 'INICIS_V2',
          pgMerchantId: 'INIBillTst',
        },
      ],
    });

    const result = verifyBillingKeyReadback(info, session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('CHANNEL_NOT_FOUND');
    }
  });

  it('fails if channel type is LIVE (strictly requires TEST)', () => {
    const session = createValidSession();
    const info = createValidIssuedInfo({
      channels: [
        {
          key: REVIEW_CHANNEL_KEY,
          type: 'LIVE',
          pgProvider: 'INICIS_V2',
          pgMerchantId: 'INIpayTest',
        },
      ],
    });

    const result = verifyBillingKeyReadback(info, session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('CHANNEL_TYPE_NOT_TEST');
    }
  });

  it('fails if customer.id does not match session userId', () => {
    const session = createValidSession({ userId: 'user_tester_1' });
    const info = createValidIssuedInfo({ customer: { id: 'user_intruder_2' } });

    const result = verifyBillingKeyReadback(info, session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('CUSTOMER_ID_MISMATCH');
    }
  });

  it('fails if issueId is missing or does not match session issueId (no assumption of match)', () => {
    const session = createValidSession({ issueId: 'issue_test_123' });

    // Missing issueId
    const infoWithoutIssueId = createValidIssuedInfo({ issueId: undefined });
    const res1 = verifyBillingKeyReadback(infoWithoutIssueId, session);
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      expect(res1.reason).toBe('ISSUE_ID_MISSING');
    }

    // Mismatched issueId
    const infoWithMismatch = createValidIssuedInfo({ issueId: 'issue_different_456' });
    const res2 = verifyBillingKeyReadback(infoWithMismatch, session);
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.reason).toBe('ISSUE_ID_MISMATCH');
    }
  });
});

describe('readbackBillingKey SDK client interaction', () => {
  it('calls client.payment.billingKey.getBillingKeyInfo and returns verified result', async () => {
    const session = createValidSession();
    const info = createValidIssuedInfo();

    const mockGetBillingKeyInfo = vi.fn().mockResolvedValue(info);
    const mockClient = {
      payment: {
        billingKey: {
          getBillingKeyInfo: mockGetBillingKeyInfo,
        },
      },
    };

    const result = await readbackBillingKey({
      billingKey: 'bkey_mock_abc123',
      session,
      apiSecret: 'test_secret',
      storeId: REVIEW_STORE_ID,
      portOneClient: mockClient as unknown as import('@portone/server-sdk').PortOneClient,
    });

    expect(mockGetBillingKeyInfo).toHaveBeenCalledWith({
      billingKey: 'bkey_mock_abc123',
      storeId: REVIEW_STORE_ID,
    });
    expect(result).toEqual({
      ok: true,
      status: 'verified_test_billing_key',
      paymentCharged: false,
      subscriptionActivated: false,
    });
  });

  it('handles client API errors safely without leaking sensitive error payload or stack', async () => {
    const session = createValidSession();
    const mockGetBillingKeyInfo = vi.fn().mockRejectedValue(new Error('PG_NETWORK_DOWN_SENSITIVE_KEY_12345'));
    const mockClient = {
      payment: {
        billingKey: {
          getBillingKeyInfo: mockGetBillingKeyInfo,
        },
      },
    };

    const result = await readbackBillingKey({
      billingKey: 'bkey_mock_abc123',
      session,
      apiSecret: 'test_secret',
      storeId: REVIEW_STORE_ID,
      portOneClient: mockClient as unknown as import('@portone/server-sdk').PortOneClient,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('READBACK_API_ERROR');
      // Must not leak the raw PG / sensitive error message
      expect(result.message).not.toContain('SENSITIVE_KEY_12345');
    }
  });
});
