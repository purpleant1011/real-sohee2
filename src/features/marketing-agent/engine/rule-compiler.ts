import { AgentOperatingPlan } from './operating-plan';
import { ChannelKey } from '../types';

export type TriggerType = 
  | 'scheduled'         // 지정된 요일/시간
  | 'interval_patrol'   // 주기적 감시 (영업시간 내)
  | 'event'             // 인바운드 이벤트 (dm.received 등)
  | 'conditional'       // 조건 충족 시 (빈 슬롯 발생 등)
  | 'performance';      // 성과 지표 트리거

export type ActionRiskLevel = 'GREEN' | 'YELLOW' | 'RED';
export type ApprovalPolicy = 'always_auto' | 'conditional_auto' | 'approval_required' | 'blocked';

export interface CompiledAutomationRule {
  id: string;
  workspaceId: string;
  planId: string;
  name: string;
  goal: string;
  triggerType: TriggerType;
  triggerConfig: {
    cronExpression?: string;
    intervalMinutes?: number;
    eventName?: string;
    conditionExpression?: string;
    performanceMetric?: string;
  };
  schedule?: {
    daysOfWeek: number[]; // 1=월 ~ 7=일
    targetTime: string;   // "18:00"
    timezone: string;     // "Asia/Seoul"
  };
  workHours?: {
    start: string;
    end: string;
    quietHours: {
      start: string;
      end: string;
    };
  };
  channelScopes: ChannelKey[];
  actionTypes: string[];
  requiredCapabilities: string[];
  approvalPolicy: ApprovalPolicy;
  riskLevel: ActionRiskLevel;
  conditions?: string[];
  maxActionsPerRun: number;
  maxActionsPerDay: number;
  perRunCreditCap: number;
  active: boolean;
  version: number;
  nextRunAt?: string;
  lastRunAt?: string;
  createdBy: 'sohee' | 'user';
  createdAt: string;
}

export function compilePlanToRules(plan: AgentOperatingPlan): CompiledAutomationRule[] {
  const rules: CompiledAutomationRule[] = [];
  const now = new Date();

  // Helper: 다음 실행 시각 계산 (단순 시간 offset)
  const getNextScheduledIso = (dayOffset: number, timeStr: string): string => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
  };

  // 1. Scheduled Content Rules (Instagram, Threads, Blog)
  // 1-1. Instagram 정기 게시
  rules.push({
    id: `rule-${plan.id}-ig-scheduled`,
    workspaceId: plan.workspaceId,
    planId: plan.id,
    name: '인스타그램 정기 브랜딩 & 예약 유도 콘텐츠 발행',
    goal: '월/수/금 황금 시간대 시술 전후/노하우 콘텐츠 자동 배포',
    triggerType: 'scheduled',
    triggerConfig: {
      cronExpression: '0 18 * * 1,3,5',
    },
    schedule: {
      daysOfWeek: [1, 3, 5],
      targetTime: '18:00',
      timezone: 'Asia/Seoul',
    },
    workHours: plan.workHours,
    channelScopes: ['instagram'],
    actionTypes: ['content.generate_image', 'content.generate_text', 'instagram.publish'],
    requiredCapabilities: ['instagram.publish_photo', 'openai.generate_image'],
    approvalPolicy: plan.autonomyPreset === 'safety_first' ? 'approval_required' : 'always_auto',
    riskLevel: 'YELLOW',
    maxActionsPerRun: 1,
    maxActionsPerDay: 1,
    perRunCreditCap: 15,
    active: true,
    version: 1,
    nextRunAt: getNextScheduledIso(1, '18:00'),
    createdBy: 'sohee',
    createdAt: now.toISOString(),
  });

  // 1-2. Threads 정기 게시
  rules.push({
    id: `rule-${plan.id}-threads-scheduled`,
    workspaceId: plan.workspaceId,
    planId: plan.id,
    name: '스레드 실시간 트렌드 및 대화형 숏텍스트 발행',
    goal: '화/목/토 점심 시간대 친근한 원장님 일상 및 뷰티 팁 공유',
    triggerType: 'scheduled',
    triggerConfig: {
      cronExpression: '0 12 * * 2,4,6',
    },
    schedule: {
      daysOfWeek: [2, 4, 6],
      targetTime: '12:00',
      timezone: 'Asia/Seoul',
    },
    workHours: plan.workHours,
    channelScopes: ['threads'],
    actionTypes: ['content.generate_text', 'threads.publish'],
    requiredCapabilities: ['threads.publish_post'],
    approvalPolicy: 'always_auto',
    riskLevel: 'GREEN',
    maxActionsPerRun: 1,
    maxActionsPerDay: 1,
    perRunCreditCap: 8,
    active: true,
    version: 1,
    nextRunAt: getNextScheduledIso(2, '12:00'),
    createdBy: 'sohee',
    createdAt: now.toISOString(),
  });

  // 1-3. Naver Blog 주간 심층 칼럼 게시 (주 1회)
  if (plan.proposedCadence.blogWeeklyCount > 0) {
    rules.push({
      id: `rule-${plan.id}-blog-scheduled`,
      workspaceId: plan.workspaceId,
      planId: plan.id,
      name: '네이버 블로그 시술 후기·칼럼 원고 준비',
      goal: '매주 수요일 로컬 검색 최적화(SEO) 심층 블로그 칼럼 발행',
      triggerType: 'scheduled',
      triggerConfig: {
        cronExpression: '0 14 * * 3',
      },
      schedule: {
        daysOfWeek: [3],
        targetTime: '14:00',
        timezone: 'Asia/Seoul',
      },
      workHours: plan.workHours,
      channelScopes: ['naver_blog'],
      actionTypes: ['content.generate_text', 'naver_blog.publish'],
      requiredCapabilities: ['naver_blog.local_connector'],
      approvalPolicy: plan.autonomyPreset === 'safety_first' ? 'approval_required' : 'conditional_auto',
      riskLevel: 'YELLOW',
      maxActionsPerRun: 1,
      maxActionsPerDay: 1,
      perRunCreditCap: 25,
      active: true,
      version: 1,
      nextRunAt: getNextScheduledIso(3, '14:00'),
      createdBy: 'sohee',
      createdAt: now.toISOString(),
    });
  }

  // 2. Interval / Patrol Trigger (영업시간 중 상시 순찰)
  rules.push({
    id: `rule-${plan.id}-patrol-inquiries`,
    workspaceId: plan.workspaceId,
    planId: plan.id,
    name: '영업시간 실시간 DM & 댓글 순찰 엔진',
    goal: `${plan.proposedCadence.patrolIntervalMinutes}분마다 인스타그램/스레드 신규 문의 및 댓글 확인`,
    triggerType: 'interval_patrol',
    triggerConfig: {
      intervalMinutes: plan.proposedCadence.patrolIntervalMinutes,
    },
    workHours: plan.workHours,
    channelScopes: ['instagram', 'threads'],
    actionTypes: ['instagram.read_dm', 'instagram.read_comments', 'threads.read_replies'],
    requiredCapabilities: ['instagram.read_messages', 'threads.read_replies'],
    approvalPolicy: 'always_auto',
    riskLevel: 'GREEN',
    maxActionsPerRun: 10,
    maxActionsPerDay: 100,
    perRunCreditCap: 2,
    active: true,
    version: 1,
    nextRunAt: new Date(Date.now() + plan.proposedCadence.patrolIntervalMinutes * 60 * 1000).toISOString(),
    createdBy: 'sohee',
    createdAt: now.toISOString(),
  });

  // 3. Event Trigger (실시간 인바운드 대응)
  rules.push({
    id: `rule-${plan.id}-event-dm-reply`,
    workspaceId: plan.workspaceId,
    planId: plan.id,
    name: '신규 고객 문의 실시간 인텐트 분석 및 안전 답변',
    goal: 'dm.received 발생 시 영업시간/위치/서비스 정보 즉시 회신 및 예약 의도 포착',
    triggerType: 'event',
    triggerConfig: {
      eventName: 'dm.received',
    },
    workHours: plan.workHours,
    channelScopes: ['instagram', 'threads'],
    actionTypes: ['customer.classify', 'customer.follow_up', 'instagram.reply_dm'],
    requiredCapabilities: ['instagram.send_message'],
    approvalPolicy: plan.autonomyPreset === 'safety_first' ? 'approval_required' : 'conditional_auto',
    riskLevel: 'YELLOW',
    maxActionsPerRun: 1,
    maxActionsPerDay: 50,
    perRunCreditCap: 5,
    active: true,
    version: 1,
    createdBy: 'sohee',
    createdAt: now.toISOString(),
  });

  // 4. Conditional Trigger (빈 슬롯 발생 시 예약 유도)
  rules.push({
    id: `rule-${plan.id}-cond-empty-slot`,
    workspaceId: plan.workspaceId,
    planId: plan.id,
    name: '익일 예약률 60% 미만 시 타겟 캠페인 제안/실행',
    goal: '빈 예약 슬롯 2개 이상 감지 시 인스타 스토리/피드 긴급 슬롯 공지',
    triggerType: 'conditional',
    triggerConfig: {
      conditionExpression: 'tomorrow_booking_rate < 0.6 && empty_slots_count >= 2',
    },
    channelScopes: ['instagram', 'threads'],
    actionTypes: ['content.generate_text', 'instagram.publish'],
    requiredCapabilities: ['reservation.read_slots', 'instagram.publish_photo'],
    approvalPolicy: 'conditional_auto',
    riskLevel: 'YELLOW',
    conditions: ['tomorrow_booking_rate < 0.6', 'empty_slots_count >= 2'],
    maxActionsPerRun: 1,
    maxActionsPerDay: 2,
    perRunCreditCap: 15,
    active: true,
    version: 1,
    createdBy: 'sohee',
    createdAt: now.toISOString(),
  });

  // 5. Performance Trigger (성과 지표 기반 자율 전략 피드백)
  rules.push({
    id: `rule-${plan.id}-perf-feedback`,
    workspaceId: plan.workspaceId,
    planId: plan.id,
    name: '주간 채널 반응률 및 예약 전환 분석 리포트',
    goal: '매주 일요일 채널별 반응률/전환율 분석 및 차주 운영안 최적화 제안',
    triggerType: 'performance',
    triggerConfig: {
      performanceMetric: 'weekly_conversion_rate',
    },
    channelScopes: ['instagram', 'threads', 'naver_blog'],
    actionTypes: ['performance.collect', 'report.generate'],
    requiredCapabilities: ['analytics.read'],
    approvalPolicy: 'always_auto',
    riskLevel: 'GREEN',
    maxActionsPerRun: 1,
    maxActionsPerDay: 1,
    perRunCreditCap: 5,
    active: true,
    version: 1,
    createdBy: 'sohee',
    createdAt: now.toISOString(),
  });

  return rules;
}
