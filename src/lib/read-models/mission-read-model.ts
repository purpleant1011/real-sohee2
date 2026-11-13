import { RiskTier, ActionStatus, ValueWithProvenance } from './types';

export interface MissionStep {
  id: string;
  order: number;
  channel: string;
  actionType: string;
  title: string;
  description: string;
  capability: string;
  riskTier: RiskTier;
  approvalRequired: boolean;
  status: ActionStatus;
  executedAt?: string;
  resultSummary?: string;
}

export interface MissionStatusLog {
  timestamp: string;
  actor: 'agent' | 'user' | 'system' | 'provider';
  message: string;
  type: 'info' | 'action' | 'approval' | 'verification' | 'warning' | 'error';
}

export interface MissionDetailReadModel {
  id: string;
  workspaceId: string;
  title: string;
  objective: string;
  linkedGoalId?: string;
  sourceOpportunityId?: string;
  successCriteria: string[];
  status: 'planning' | 'in_progress' | 'completed' | 'paused' | 'canceled';
  steps: MissionStep[];
  expectedEffect: ValueWithProvenance<string>;
  budgetLimit: string;
  stopCondition: string;
  cooldownPeriod: string;
  rollbackPlan: string;
  statusLogs: MissionStatusLog[];
  resultSummary?: {
    totalSent: number;
    repliedCount: number;
    confirmedBookings: number;
    attributedRevenue: number;
  };
}

export interface GetMissionParams {
  missionId: string;
  workspaceId: string;
}

export function getMissionDetailReadModel(params: GetMissionParams): MissionDetailReadModel {
  return {
    id: params.missionId || 'ms-001',
    workspaceId: params.workspaceId,
    title: '목요일 빈 슬롯 타겟 카카오톡 안부 제안',
    objective: '목요일 잔여 슬롯 2개 중 최소 1개 이상 정식 예약 확정',
    linkedGoalId: 'goal-001',
    sourceOpportunityId: 'opp-001',
    successCriteria: [
      '미예약 상담 고객 3명에게 맞춤 슬롯 안내 발송 완료',
      '고객 응답 수신 후 실시간 예약 링크 전달',
      '목요일 18:00 전까지 최소 1건 예약 확정',
    ],
    status: 'in_progress',
    steps: [
      {
        id: 'step-1',
        order: 1,
        channel: 'KakaoTalk Channel',
        actionType: 'customer_message_draft',
        title: '대상 리드 선별 및 맞춤 제안 초안 생성',
        description: '최근 7일 내 목요일 문의 고객 중 마케팅 수신 동의가 유효한 3명 선별',
        capability: 'KakaoTalk Channel 1:1 메시지 API',
        riskTier: 'low',
        approvalRequired: false,
        status: 'succeeded',
        executedAt: '2026-08-30 21:00:00',
        resultSummary: '대상 3인(김*아, 이*진, 박*영) 선정 완료',
      },
      {
        id: 'step-2',
        order: 2,
        channel: 'KakaoTalk Channel',
        actionType: 'approval_request',
        title: '메시지 발송 원문 사장님 승인',
        description: '사장님이 발송 문구와 혜택 내용을 확인하고 승인',
        capability: 'Sohee Approval Gate',
        riskTier: 'medium',
        approvalRequired: true,
        status: 'approval_pending',
      },
      {
        id: 'step-3',
        order: 3,
        channel: 'KakaoTalk Channel',
        actionType: 'message_send_and_verify',
        title: '카카오톡 비즈니스 메시지 전송 및 회신 감지',
        description: '승인 즉시 멱등키를 포함하여 카카오톡 채널로 전송하고 배송 상태 확인',
        capability: 'KakaoTalk Channel API + Webhook Delivery Check',
        riskTier: 'medium',
        approvalRequired: false,
        status: 'draft',
      },
    ],
    expectedEffect: {
      value: '예상 예약 1~2건 회복 (매출 350,000 ~ 700,000원)',
      provenance: 'estimated',
      sourceDescription: '과거 유사 안부 제안 전환율 35% 기준',
      confidence: 0.88,
    },
    budgetLimit: '최대 발송 비용 1,000원 이하 (발송당 15원)',
    stopCondition: '슬롯 2개가 모두 마감되거나 고객이 수신 거부 의사를 밝힐 경우 즉시 중단',
    cooldownPeriod: '동일 고객 대상 14일간 재접촉 금지',
    rollbackPlan: '슬롯 조기 마감 시 즉시 대기 메시지로 전환하여 예약 혼선 방지',
    statusLogs: [
      {
        timestamp: '21:00:15',
        actor: 'agent',
        message: '네이버 예약 캘린더에서 목요일 14:00/16:30 잔여 슬롯 2건 감지',
        type: 'info',
      },
      {
        timestamp: '21:01:20',
        actor: 'agent',
        message: '카카오톡 상담 고객 4명 중 수신 동의 유효 리드 3인 선별 완료',
        type: 'info',
      },
      {
        timestamp: '21:02:00',
        actor: 'agent',
        message: '미션 생성 및 승인 센터 결재 요청 발송 완료',
        type: 'approval',
      },
    ],
    resultSummary: {
      totalSent: 0,
      repliedCount: 0,
      confirmedBookings: 0,
      attributedRevenue: 0,
    },
  };
}
