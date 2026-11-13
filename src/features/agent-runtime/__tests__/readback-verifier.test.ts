import { describe, it, expect } from 'vitest';
import { verifyExternalWriteWithReadback, calculateReadbackHash } from '../readback-verifier';

describe('ANI-815: Independent Readback Verifier', () => {
  const baseReq = {
    workspaceId: 'ws-gangnam-skin',
    actionRunId: 'run-post-001',
    channel: 'instagram' as const,
    providerResult: {
      status: 200,
      acceptedAt: '2026-09-06T09:00:00.000Z',
      temporaryReferenceId: 'tmp-ig-123',
    },
    expectedPayload: {
      title: '가을 피부 케어 이벤트',
      bodyContent: '가을철 수분 관리 필수 코스!',
      targetAccountId: 'ig-act-999',
    },
  };

  it('elevates to EXTERNAL_VERIFIED and generates tamper-proof hash on successful readback', async () => {
    const cert = await verifyExternalWriteWithReadback({
      ...baseReq,
      readbackQuery: async () => ({
        isFound: true,
        authoritativeId: 'ig-media-777888',
        liveUrl: 'https://instagram.com/p/C99xyz123',
        actualPayload: { title: '가을 피부 케어 이벤트' },
      }),
    });

    expect(cert.isVerified).toBe(true);
    expect(cert.verificationState).toBe('EXTERNAL_VERIFIED');
    expect(cert.authoritativeId).toBe('ig-media-777888');
    expect(cert.liveUrl).toBe('https://instagram.com/p/C99xyz123');
    expect(cert.readbackHash).toBeDefined();
    expect(cert.allowRetry).toBe(false);
  });

  it('marks as RESULT_UNKNOWN when readback cannot find the object (delayed consistency / network issue)', async () => {
    const cert = await verifyExternalWriteWithReadback({
      ...baseReq,
      readbackQuery: async () => ({
        isFound: false,
        errorMessage: 'Object not found yet in Instagram Graph API query',
      }),
    });

    expect(cert.isVerified).toBe(false);
    expect(cert.verificationState).toBe('RESULT_UNKNOWN');
    expect(cert.allowRetry).toBe(false); // Blind retry is forbidden
    expect(cert.failureReason).toContain('Object not found yet');
  });

  it('marks as RESULT_UNKNOWN when readback query throws an error', async () => {
    const cert = await verifyExternalWriteWithReadback({
      ...baseReq,
      readbackQuery: async () => {
        throw new Error('ETIMEDOUT connecting to graph.facebook.com');
      },
    });

    expect(cert.isVerified).toBe(false);
    expect(cert.verificationState).toBe('RESULT_UNKNOWN');
    expect(cert.failureReason).toContain('ETIMEDOUT');
  });

  it('rejects fake/placeholder domains as VERIFY_FAILED', async () => {
    const cert = await verifyExternalWriteWithReadback({
      ...baseReq,
      readbackQuery: async () => ({
        isFound: true,
        authoritativeId: 'dummy-id',
        liveUrl: 'https://example.com/fake-post/123',
      }),
    });

    expect(cert.isVerified).toBe(false);
    expect(cert.verificationState).toBe('VERIFY_FAILED');
    expect(cert.failureReason).toContain('Prohibited mock/placeholder domain');
  });

  it('rejects channel domain mismatches as VERIFY_FAILED', async () => {
    const cert = await verifyExternalWriteWithReadback({
      ...baseReq,
      channel: 'naver',
      readbackQuery: async () => ({
        isFound: true,
        authoritativeId: 'naver-blog-99',
        liveUrl: 'https://daum.net/post/99', // should be naver.com
      }),
    });

    expect(cert.isVerified).toBe(false);
    expect(cert.verificationState).toBe('VERIFY_FAILED');
    expect(cert.failureReason).toContain('Channel domain mismatch');
  });

  it('detects payload inconsistency (e.g., ad bid price mismatch)', async () => {
    const cert = await verifyExternalWriteWithReadback({
      ...baseReq,
      channel: 'google_ads',
      expectedPayload: {
        targetAccountId: 'g-ads-01',
        bidAmtKRW: 1500,
      },
      readbackQuery: async () => ({
        isFound: true,
        authoritativeId: 'kw-100',
        liveUrl: 'https://google.com/ads/kw/100',
        actualPayload: {
          bidAmtKRW: 500, // mismatch!
        },
      }),
    });

    expect(cert.isVerified).toBe(false);
    expect(cert.verificationState).toBe('VERIFY_FAILED');
    expect(cert.failureReason).toContain('Bid amount mismatch: expected 1500, readback reported 500');
  });
});
