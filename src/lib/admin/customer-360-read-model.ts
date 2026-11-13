/**
 * Sohee Admin V0.3 Customer 360 Unified Read Model
 * 
 * Invariants:
 * 1. Single unified source of truth across Service V0.8.9 and Admin V0.3.
 * 2. Realtime aggregation of:
 *    - Business Verification status & documents
 *    - 14-day Trial & Credit balances (Activation, Agent, Protected WOW)
 *    - 4-Channel connection health & external evidence receipts
 *    - AI Help escalation tickets & audit trace
 */

import { MembershipLifecycleState } from '../auth/membership-lifecycle';
import { BusinessVerificationStatus } from '../auth/business-verification';
import { ChannelConnectionStatus, ChannelId } from '../channels/channel-registry';

export interface Customer360WorkspaceView {
  workspaceId: string;
  companyName: string;
  representativeName: string;
  businessNumber: string;
  lifecycleState: MembershipLifecycleState;
  businessVerificationStatus: BusinessVerificationStatus;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  creditBalance: {
    activation: number;
    agent: number;
    protectedWow: number;
    purchased: number;
    total: number;
  };
  channels: Array<{
    channelId: ChannelId;
    status: ChannelConnectionStatus;
    accountName?: string;
    healthScore: number;
    lastVerifiedAt?: string;
  }>;
  recentAuditEventsCount: number;
  openSupportTicketsCount: number;
  riskScore: number; // 0 (healthy) ~ 100 (critical)
  createdAt: string;
}

export function buildCustomer360Summary(view: Customer360WorkspaceView): {
  isHealthy: boolean;
  statusBadgeText: string;
  recommendedAction?: string;
} {
  if (view.businessVerificationStatus === 'PENDING') {
    return {
      isHealthy: false,
      statusBadgeText: '사업자 심사 대기',
      recommendedAction: '사업자등록 정보 및 국세청 진위 확인 후 승인 처리'
    };
  }

  if (view.riskScore > 70) {
    return {
      isHealthy: false,
      statusBadgeText: '고위험 경보',
      recommendedAction: '비정상 액션 속도 또는 결제 실패 이력 점검'
    };
  }

  return {
    isHealthy: true,
    statusBadgeText: '정상 운영',
    recommendedAction: '자율 마케팅 성과 및 크레딧 소진 추이 관찰'
  };
}
