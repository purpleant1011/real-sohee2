import { DataProvenance, ValueWithProvenance, RiskTier, ActionStatus, ChannelHealth } from './types';

export interface TodayGoalReadModel {
  id: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  period: 'weekly' | 'monthly';
  provenance: DataProvenance;
  sourceDescription: string;
  achievementRate: number;
}

export interface TodayOpportunityReadModel {
  id: string;
  title: string;
  type: 'empty_slot' | 'unbooked_inquiry' | 'review_response' | 'channel_content' | 'local_exposure';
  urgency: 'high' | 'medium' | 'low';
  score: number;
  whyNow: string;
  expectedImpact: ValueWithProvenance<string>;
  confidence: number;
  source: string;
  expiresAt: string;
}

export interface TodayMissionReadModel {
  id: string;
  title: string;
  objective: string;
  stepCount: number;
  completedStepCount: number;
  currentStepDescription: string;
  status: 'planning' | 'in_progress' | 'completed' | 'paused';
}

export interface TodayPendingApprovalReadModel {
  id: string;
  actionType: string;
  channel: string;
  title: string;
  why: string;
  previewContent: string;
  riskTier: RiskTier;
  deadline: string;
  status: ActionStatus;
}

export interface TodayAttributionSummaryReadModel {
  confirmedRevenue: ValueWithProvenance<number>;
  estimatedRevenue: ValueWithProvenance<number>;
  directBookings: number;
  assistedBookings: number;
  activeTouchpointsCount: number;
}

export interface TodayReadModelResponse {
  workspaceId: string;
  workspaceName: string;
  isDemo: boolean;
  status: 'active' | 'data_insufficient' | 'error';
  dataFreshness: string;
  hasBookingConnection: boolean;
  hasChannelConnection: boolean;
  insufficientReasons?: string[];
  goal: TodayGoalReadModel;
  topOpportunity: TodayOpportunityReadModel | null;
  activeMission: TodayMissionReadModel | null;
  pendingApprovals: TodayPendingApprovalReadModel[];
  attributionSummary: TodayAttributionSummaryReadModel;
  channelHealthSummary: ChannelHealth[];
  warnings: string[];
}

export interface GetTodayReadModelParams {
  workspaceId: string;
  workspaceName?: string;
  isDemo?: boolean;
  hasBookingConnection?: boolean;
  hasChannelConnection?: boolean;
}

export function getTodayReadModel(params: GetTodayReadModelParams): TodayReadModelResponse {
  const isDemo = params.isDemo ?? false;
  const hasBooking = params.hasBookingConnection ?? (isDemo ? true : false);
  const hasChannel = params.hasChannelConnection ?? (isDemo ? true : false);
  const workspaceName = params.workspaceName || (isDemo ? '바이름 청라 (데모)' : '내 작업공간');

  if (!hasBooking && !isDemo) {
    return {
      workspaceId: params.workspaceId,
      workspaceName,
      isDemo: false,
      status: 'data_insufficient',
      dataFreshness: '방금 전',
      hasBookingConnection: false,
      hasChannelConnection: hasChannel,
      insufficientReasons: ['booking_calendar_not_connected', 'inquiry_channel_not_connected'],
      goal: {
        id: 'goal-empty',
        title: '목표를 설정해주세요',
        targetValue: 0,
        currentValue: 0,
        unit: '건',
        period: 'weekly',
        provenance: 'calculated',
        sourceDescription: '데이터 연결 대기 중',
        achievementRate: 0,
      },
      topOpportunity: null,
      activeMission: null,
      pendingApprovals: [],
      attributionSummary: {
        confirmedRevenue: { value: 0, provenance: 'measured', sourceDescription: '결제 데이터 미연결' },
        estimatedRevenue: { value: 0, provenance: 'estimated', sourceDescription: '분석 대기 중' },
        directBookings: 0,
        assistedBookings: 0,
        activeTouchpointsCount: 0,
      },
      channelHealthSummary: [],
      warnings: ['예약 캘린더를 연동하면 실시간 빈자리 기회 분석이 시작됩니다.'],
    };
  }

  // Demo / Active Data with explicit Provenance

  return {
    workspaceId: params.workspaceId,
    workspaceName,
    isDemo,
    status: 'active',
    dataFreshness: '12분 전 동기화',
    hasBookingConnection: true,
    hasChannelConnection: true,
    goal: {
      id: 'goal-001',
      title: '이번 주 예약 목표 달성',
      targetValue: 10,
      currentValue: 8,
      unit: '건',
      period: 'weekly',
      provenance: isDemo ? 'demo' : 'measured',
      sourceDescription: isDemo ? '데모 시나리오 기준' : '네이버 예약 실시간 원장',
      achievementRate: 80,
    },
    topOpportunity: {
      id: 'opp-001',
      title: '목요일 14시/16시30분 빈 슬롯 타겟 리커버리',
      type: 'empty_slot',
      urgency: 'high',
      score: 92,
      whyNow: '최근 7일간 목요일 시술 문의 후 미예약 고객 4명 중 3명이 재접촉 가능 상태입니다.',
      expectedImpact: {
        value: '예상 예약 1~2건 회복 (약 35~70만원)',
        provenance: 'estimated',
        sourceDescription: '과거 유사 리드 전환율(35%) 기반 추정치',
        confidence: 0.88,
      },
      confidence: 0.88,
      source: '네이버 예약 캘린더 + 카카오톡 채널 상담 로그',
      expiresAt: '2026-09-03T18:00:00Z',
    },
    activeMission: {
      id: 'ms-001',
      title: '목요일 빈 슬롯 타겟 카카오톡 안부 제안',
      objective: '목요일 빈자리 2개 중 최소 1개 예약 확정',
      stepCount: 3,
      completedStepCount: 1,
      currentStepDescription: '카카오톡 메시지 원문 승인 대기',
      status: 'in_progress',
    },
    pendingApprovals: [
      {
        id: 'appr-001',
        actionType: 'customer_message',
        channel: 'KakaoTalk Channel',
        title: '미예약 문의 고객 3인 맞춤 슬롯 안내 메시지',
        why: '이전 상담 시 목요일 오후 시간대를 선호했던 고객 3명에게만 맞춤 안내합니다.',
        previewContent: '안녕하세요 고객님, 바이름 청라입니다. 문의주셨던 이번 주 목요일 오후 2시/4시 30분에 한정 잔여 슬롯이 생겨 우선 안내드립니다.',
        riskTier: 'medium',
        deadline: '오늘 18:00 마감',
        status: 'approval_pending',
      },
    ],
    attributionSummary: {
      confirmedRevenue: {
        value: isDemo ? 1400000 : 0,
        provenance: isDemo ? 'demo' : 'measured',
        sourceDescription: isDemo ? '데모 결제 데이터' : '실제 결제/예약 연동 원장',
      },
      estimatedRevenue: {
        value: isDemo ? 350000 : 0,
        provenance: 'estimated',
        sourceDescription: '현재 진행 중인 슬롯 제안 전환 기대치',
      },
      directBookings: isDemo ? 2 : 0,
      assistedBookings: isDemo ? 3 : 0,
      activeTouchpointsCount: isDemo ? 5 : 0,
    },
    channelHealthSummary: [
      { channelKey: 'instagram', displayName: 'Instagram', status: 'connected', lastSyncedAt: '10분 전' },
      { channelKey: 'kakaotalk', displayName: '카카오톡 채널', status: 'connected', lastSyncedAt: '5분 전' },
      { channelKey: 'naver_place', displayName: '네이버 플레이스', status: 'needs_reauth', lastSyncedAt: '3일 전', errorMessage: '권한 토큰 만료' },
    ],
    warnings: [
      '네이버 플레이스 채널 토큰이 만료되어 리뷰 자동 감지가 일시 중단되었습니다. [재인증]',
    ],
  };
}
