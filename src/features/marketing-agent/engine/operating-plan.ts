import { ChannelKey } from '../types';

export type AutonomyPreset = 'safety_first' | 'balanced' | 'aggressive_growth';
export type PlanStatus = 'proposed' | 'approved' | 'active' | 'superseded' | 'paused';
export type RiskProfile = 'conservative' | 'balanced' | 'assertive';

export interface WorkHoursConfig {
  start: string; // "09:00"
  end: string;   // "21:00"
  workDays: number[]; // [1, 2, 3, 4, 5, 6] (1=월 ~ 7=일)
  quietHours: {
    start: string; // "22:00"
    end: string;   // "08:00"
  };
}

export interface ProposedCadence {
  instagramWeeklyCount: number;
  threadsWeeklyCount: number;
  blogWeeklyCount: number;
  patrolIntervalMinutes: number;
  alwaysOnMonitoring: string[];
}

export interface OperatingPlanProposal {
  proposalId: string;
  workspaceId: string;
  autonomyPreset: AutonomyPreset;
  title: string;
  summary: string;
  strategy: string;
  rationale: string;
  isRecommended: boolean;
  riskProfile: RiskProfile;
  proposedCadence: ProposedCadence;
  weeklyBudget: number;
  monthlyBudget: number;
  dailyBudget: number;
  workHours: WorkHoursConfig;
  channels: ChannelKey[];
  objectives: string[];
  requiresOwnerApprovalFor: string[];
  autonomousActionsAllowed: string[];
  expectedImpact: {
    inquiries: string;
    reservations: string;
    roi: string;
  };
  nextReviewDate: string;
}

export interface AgentOperatingPlan extends OperatingPlanProposal {
  id: string;
  planVersion: number;
  status: PlanStatus;
  createdBy: 'sohee' | 'user';
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateProposalsInput {
  workspaceId: string;
  goal: string;
  context: {
    workspaceName: string;
    industry: string;
    targetAudience: string;
    currentChannels: readonly ChannelKey[];
    emptySlots?: Array<{
      date: string;
      day: string;
      time: string;
      duration: number;
    }>;
  };
}

export function generateOperatingPlanProposals(input: GenerateProposalsInput): OperatingPlanProposal[] {
  const { workspaceId, goal, context } = input;
  const channels = [...context.currentChannels] as ChannelKey[];

  const defaultWorkHours: WorkHoursConfig = {
    start: '09:00',
    end: '21:00',
    workDays: [1, 2, 3, 4, 5, 6],
    quietHours: {
      start: '21:30',
      end: '08:30',
    },
  };

  const emptySlotsText = context.emptySlots && context.emptySlots.length > 0
    ? `${context.emptySlots.map(s => `${s.day}(${s.time})`).join(', ')} 빈 슬롯 집중 공략`
    : '신규 고객 예약 유입 극대화';

  // 1. 안전 운영 (Safety-First)
  const safetyProposal: OperatingPlanProposal = {
    proposalId: `prop-${workspaceId}-safety`,
    workspaceId,
    autonomyPreset: 'safety_first',
    title: '안전 운영 (초안 검토 및 승인 중심)',
    summary: '소희가 콘텐츠 초안과 고객 응대 제안을 준비하고, 사장님의 최종 확인을 받아 안전하게 실행합니다.',
    strategy: '브랜드 톤앤매너 검증 및 핵심 시간대 위주 최소 안전 발행',
    rationale: `${context.workspaceName}의 안전한 첫걸음을 위해 외부 게시 전 사장님 승인을 필수로 적용하며 불필요한 크레딧 소모를 최소화합니다.`,
    isRecommended: false,
    riskProfile: 'conservative',
    proposedCadence: {
      instagramWeeklyCount: 2,
      threadsWeeklyCount: 1,
      blogWeeklyCount: 0,
      patrolIntervalMinutes: 60,
      alwaysOnMonitoring: ['신규 DM 알림', '부정 리뷰 감지', '예약 문의 수집'],
    },
    weeklyBudget: 90,
    monthlyBudget: 360,
    dailyBudget: 20,
    workHours: defaultWorkHours,
    channels,
    objectives: [
      '모든 외부 발행 전 사장님 사전 승인',
      '고객 문의 발생 시 답변 초안 작성 후 승인 요청',
      emptySlotsText,
    ],
    requiresOwnerApprovalFor: ['모든 SNS 게시물', '고객 DM 및 댓글 발송', '예약 확정'],
    autonomousActionsAllowed: ['콘텐츠 기획 및 초안 생성', '고객 인텐트 분류', '슬롯 가능 여부 확인'],
    expectedImpact: {
      inquiries: '주간 5~8건',
      reservations: '주간 2~4건',
      roi: '안정적 기본 노출 유지',
    },
    nextReviewDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  // 2. 균형 운영 (Balanced Growth - 기본 권장)
  const balancedProposal: OperatingPlanProposal = {
    proposalId: `prop-${workspaceId}-balanced`,
    workspaceId,
    autonomyPreset: 'balanced',
    title: '균형 운영 (자율 마케팅 표준 - 기본 권장)',
    summary: '인스타그램 주 3회, 스레드 주 3회, 블로그 주 1회를 자율 발행하고 일반 고객 문의와 예약 안내를 실시간 처리합니다.',
    strategy: '황금 시간대 멀티채널 자동 노출 + 빠른 DM/댓글 응대로 예약 전환 극대화',
    rationale: `현재 ${goal} 목표를 달성하기 위해 검증된 채널별 주기(인스타 3회, 스레드 3회, 블로그 1회)로 활동하고, 안전한 일반 문의는 24/7 즉시 응답하여 고객 이탈을 방지합니다.`,
    isRecommended: true,
    riskProfile: 'balanced',
    proposedCadence: {
      instagramWeeklyCount: 3,
      threadsWeeklyCount: 3,
      blogWeeklyCount: 1,
      patrolIntervalMinutes: 20,
      alwaysOnMonitoring: ['실시간 DM 순찰', '댓글 자동응대', '빈 슬롯 감지', '예약 확정 안내'],
    },
    weeklyBudget: 180,
    monthlyBudget: 720,
    dailyBudget: 35,
    workHours: defaultWorkHours,
    channels,
    objectives: [
      '화/목 빈 슬롯 집중 타겟팅 콘텐츠 발행',
      '영업시간 내 신규 DM 5분 내 응답',
      '인스타그램/스레드 주간 6회 무인 게시',
      '예약 의도 고객 발견 즉시 슬롯 제안',
    ],
    requiresOwnerApprovalFor: ['환불/컴플레인 응대 (RED)', '가격 할인 요청 (RED)', '새 채널 권한 변경'],
    autonomousActionsAllowed: [
      '일반 문의/영업시간 안내 (GREEN)',
      '표준 SNS 콘텐츠 발행 (YELLOW - 승인 면제)',
      '예약 슬롯 제안 및 상담 (YELLOW)',
      '정기 리뷰 감사 답글 (GREEN)',
    ],
    expectedImpact: {
      inquiries: '주간 15~25건',
      reservations: '주간 8~14건',
      roi: '예약 슬롯 85% 이상 점유',
    },
    nextReviewDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  // 3. 적극 성장 운영 (Aggressive Growth)
  const aggressiveProposal: OperatingPlanProposal = {
    proposalId: `prop-${workspaceId}-aggressive`,
    workspaceId,
    autonomyPreset: 'aggressive_growth',
    title: '적극 성장 운영 (최대 도달 및 빈 슬롯 완전 점유)',
    summary: '주간 10회 이상 공격적 멀티채널 콘텐츠 발행, 빈 슬롯 발생 즉시 플래시 캠페인, 기존 고객 재방문 유도를 전담합니다.',
    strategy: '빈 슬롯 실시간 공략 + 재방문 주기 고객 리액티베이션 + 숏폼/블로그 대량 유입',
    rationale: `빠른 예약 마감과 매출 확대를 위해 빈 슬롯 감지 시 즉시 타겟 콘텐츠를 발행하고, 60일 이상 미방문 고객에게 재방문 제안을 실행합니다.`,
    isRecommended: false,
    riskProfile: 'assertive',
    proposedCadence: {
      instagramWeeklyCount: 5,
      threadsWeeklyCount: 5,
      blogWeeklyCount: 2,
      patrolIntervalMinutes: 10,
      alwaysOnMonitoring: ['5분 단위 DM/댓글 순찰', '실시간 빈 슬롯 탐지', '재방문 타이밍 포착', '경쟁 키워드 모니터링'],
    },
    weeklyBudget: 320,
    monthlyBudget: 1280,
    dailyBudget: 60,
    workHours: defaultWorkHours,
    channels,
    objectives: [
      '모든 빈 슬롯 24시간 내 채우기',
      '주간 총 12건의 멀티채널 바이럴 콘텐츠 배포',
      '시술 주기 도래 고객 자동 리액티베이션',
    ],
    requiresOwnerApprovalFor: ['환불/컴플레인 응대 (RED)', '월간 예산 초과 변경'],
    autonomousActionsAllowed: [
      '모든 SNS 채널 자율 발행',
      '빈 슬롯 실시간 예약 캠페인 실행',
      '고객 DM/댓글 즉시 답변',
      '예약 확정 및 리마인더 발송',
    ],
    expectedImpact: {
      inquiries: '주간 30~50건',
      reservations: '주간 18~28건',
      roi: '당월 예약 100% 매진 목표',
    },
    nextReviewDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  };

  return [safetyProposal, balancedProposal, aggressiveProposal];
}

// In-Memory & Supabase Integrated Plan Repository
export class OperatingPlanRepository {
  private plans = new Map<string, AgentOperatingPlan>();

  createFromProposal(proposal: OperatingPlanProposal, createdByUserId: string): AgentOperatingPlan {
    const id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const plan: AgentOperatingPlan = {
      ...proposal,
      id,
      planVersion: 1,
      status: 'proposed',
      createdBy: createdByUserId ? 'user' : 'sohee',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(id, plan);
    return plan;
  }

  approvePlan(planId: string, approvedBy: string): AgentOperatingPlan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    // 기존 해당 workspace의 active plan들을 superseded로 변경
    for (const [id, existing] of this.plans.entries()) {
      if (existing.workspaceId === plan.workspaceId && existing.status === 'active' && id !== planId) {
        this.plans.set(id, {
          ...existing,
          status: 'superseded',
          updatedAt: new Date().toISOString(),
        });
      }
    }

    const approvedPlan: AgentOperatingPlan = {
      ...plan,
      status: 'active',
      approvedBy,
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(planId, approvedPlan);
    return approvedPlan;
  }

  getActivePlan(workspaceId: string): AgentOperatingPlan | undefined {
    for (const plan of this.plans.values()) {
      if (plan.workspaceId === workspaceId && plan.status === 'active') {
        return plan;
      }
    }
    return undefined;
  }

  getPlan(planId: string): AgentOperatingPlan | undefined {
    return this.plans.get(planId);
  }

  listPlans(workspaceId: string): AgentOperatingPlan[] {
    return Array.from(this.plans.values()).filter(p => p.workspaceId === workspaceId);
  }
}
