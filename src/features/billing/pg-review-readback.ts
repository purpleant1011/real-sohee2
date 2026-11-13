import { PortOneClient } from '@portone/server-sdk';
import type { BillingKeyInfo } from '@portone/server-sdk/payment/billingKey';
import type { SelectedChannel } from '@portone/server-sdk/common';
import {
  REVIEW_STORE_ID,
  REVIEW_CHANNEL_KEY,
  REVIEW_COOKIE_NAME,
  store,
  channel,
  resolveReviewConfig,
  openReviewSession,
  sealReviewSession,
  type ReviewConfig,
  type ReviewSession,
} from './pg-review-session';

export {
  REVIEW_STORE_ID,
  REVIEW_CHANNEL_KEY,
  REVIEW_COOKIE_NAME,
  store,
  channel,
  resolveReviewConfig,
  openReviewSession,
  sealReviewSession,
  type ReviewConfig,
  type ReviewSession,
};

export type VerifyReadbackSuccess = {
  ok: true;
  status: 'verified_test_billing_key';
  paymentCharged: false;
  subscriptionActivated: false;
};

export type VerifyReadbackFailure = {
  ok: false;
  reason:
    | 'STATUS_NOT_ISSUED'
    | 'STORE_ID_MISMATCH'
    | 'CHANNEL_NOT_FOUND'
    | 'CHANNEL_TYPE_NOT_TEST'
    | 'CUSTOMER_ID_MISMATCH'
    | 'ISSUE_ID_MISSING'
    | 'ISSUE_ID_MISMATCH'
    | 'READBACK_API_ERROR'
    | 'UNRECOGNIZED_RESPONSE';
  message: string;
};

export type VerifyReadbackResult = VerifyReadbackSuccess | VerifyReadbackFailure;

export function verifyBillingKeyReadback(
  info: BillingKeyInfo,
  session: ReviewSession,
): VerifyReadbackResult {
  if (info.status !== 'ISSUED') {
    return {
      ok: false,
      reason: 'STATUS_NOT_ISSUED',
      message: '발급 완료 상태가 아닙니다.',
    };
  }

  if (info.storeId !== REVIEW_STORE_ID) {
    return {
      ok: false,
      reason: 'STORE_ID_MISMATCH',
      message: '상점 식별자가 일치하지 않습니다.',
    };
  }

  if (!Array.isArray(info.channels) || info.channels.length === 0) {
    return {
      ok: false,
      reason: 'CHANNEL_NOT_FOUND',
      message: '채널 정보를 찾을 수 없습니다.',
    };
  }

  const matchedChannel = info.channels.find(
    (c: SelectedChannel) => c.key === REVIEW_CHANNEL_KEY,
  );
  if (!matchedChannel) {
    return {
      ok: false,
      reason: 'CHANNEL_NOT_FOUND',
      message: '지정된 테스트 채널이 결제 정보에 없습니다.',
    };
  }

  if (matchedChannel.type !== 'TEST') {
    return {
      ok: false,
      reason: 'CHANNEL_TYPE_NOT_TEST',
      message: '테스트 채널이 아닌 환경의 빌링키는 허용되지 않습니다.',
    };
  }

  if (info.customer?.id !== session.userId) {
    return {
      ok: false,
      reason: 'CUSTOMER_ID_MISMATCH',
      message: '고객 식별자가 세션 사용자와 일치하지 않습니다.',
    };
  }

  // 공식 SDK IssuedBillingKeyInfo의 issueId 필드 지원 여부 검사
  if (!info.issueId) {
    return {
      ok: false,
      reason: 'ISSUE_ID_MISSING',
      message: '빌링키 발급 건 고유 식별자가 누락되었습니다.',
    };
  }

  if (info.issueId !== session.issueId) {
    return {
      ok: false,
      reason: 'ISSUE_ID_MISMATCH',
      message: '발급 식별자가 세션과 일치하지 않습니다.',
    };
  }

  return {
    ok: true,
    status: 'verified_test_billing_key',
    paymentCharged: false,
    subscriptionActivated: false,
  };
}

export async function readbackBillingKey(params: {
  billingKey: string;
  session: ReviewSession;
  apiSecret: string;
  storeId?: string;
  portOneClient?: PortOneClient;
}): Promise<VerifyReadbackResult> {
  const { billingKey, session, apiSecret, storeId = REVIEW_STORE_ID, portOneClient } = params;

  const client =
    portOneClient ??
    PortOneClient({
      secret: apiSecret,
      storeId,
    });

  let info: BillingKeyInfo;
  try {
    info = await client.payment.billingKey.getBillingKeyInfo({
      billingKey,
      storeId,
    });
  } catch {
    // 민감한 raw PG error 및 스택 트레이스 노출 방지
    return {
      ok: false,
      reason: 'READBACK_API_ERROR',
      message: '포트원 서버로부터 빌링키 정보를 조회할 수 없습니다.',
    };
  }

  return verifyBillingKeyReadback(info, session);
}
