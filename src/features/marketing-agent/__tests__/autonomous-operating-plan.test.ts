import { describe, it, expect } from 'vitest';
import { 
  generateOperatingPlanProposals, 
  OperatingPlanRepository,
  type AgentOperatingPlan
} from '../engine/operating-plan';
import { compilePlanToRules } from '../engine/rule-compiler';

describe('Autonomous Operating Plan & Rule Compiler (V0.8.7 Spec)', () => {
  const sampleWorkspaceId = 'ws-byreum-cheongdam';
  const sampleGoal = '이번 주 화요일이랑 목요일 예약이 많이 비었어. 예약을 채워줘.';
  const sampleContext = {
    workspaceName: '바이름 청라점',
    industry: '헤어/뷰티살롱',
    targetAudience: '2030 직장인 및 웨딩 고객',
    currentChannels: ['instagram', 'threads', 'naver_blog'] as const,
    emptySlots: [
      { date: '2026-09-01', day: '화', time: '14:00', duration: 120 },
      { date: '2026-09-03', day: '목', time: '16:00', duration: 90 },
    ],
  };

  it('사용자 목표를 기반으로 최소 3가지 운영안(안전 / 균형 / 적극 성장)을 제안한다', () => {
    const proposals = generateOperatingPlanProposals({
      workspaceId: sampleWorkspaceId,
      goal: sampleGoal,
      context: sampleContext,
    });

    expect(proposals).toHaveLength(3);

    const [safety, balanced, aggressive] = proposals;

    // 1. 안전 운영
    expect(safety.autonomyPreset).toBe('safety_first');
    expect(safety.title).toContain('안전');
    expect(safety.weeklyBudget).toBeLessThan(balanced.weeklyBudget);
    expect(safety.riskProfile).toBe('conservative');

    // 2. 균형 운영 (기본 권장)
    expect(balanced.autonomyPreset).toBe('balanced');
    expect(balanced.title).toContain('균형');
    expect(balanced.isRecommended).toBe(true);
    expect(balanced.proposedCadence.instagramWeeklyCount).toBe(3);
    expect(balanced.proposedCadence.threadsWeeklyCount).toBeGreaterThanOrEqual(2);
    expect(balanced.proposedCadence.blogWeeklyCount).toBe(1);

    // 3. 적극 성장 운영
    expect(aggressive.autonomyPreset).toBe('aggressive_growth');
    expect(aggressive.title).toContain('적극');
    expect(aggressive.weeklyBudget).toBeGreaterThan(balanced.weeklyBudget);
    expect(aggressive.proposedCadence.instagramWeeklyCount).toBeGreaterThanOrEqual(4);
  });

  it('운영안을 승인하면 AgentOperatingPlan이 DB 리포지토리에 저장되고 상태가 active로 전이된다', () => {
    const repo = new OperatingPlanRepository();
    const proposals = generateOperatingPlanProposals({
      workspaceId: sampleWorkspaceId,
      goal: sampleGoal,
      context: sampleContext,
    });

    const selectedProposal = proposals.find(p => p.autonomyPreset === 'balanced')!;
    const createdPlan = repo.createFromProposal(selectedProposal, 'owner-user-123');

    expect(createdPlan.status).toBe('proposed');
    expect(createdPlan.planVersion).toBe(1);

    const activatedPlan = repo.approvePlan(createdPlan.id, 'owner-user-123');
    expect(activatedPlan.status).toBe('active');
    expect(activatedPlan.approvedBy).toBe('owner-user-123');
    expect(activatedPlan.approvedAt).toBeDefined();

    const currentActive = repo.getActivePlan(sampleWorkspaceId);
    expect(currentActive?.id).toBe(activatedPlan.id);
  });

  it('RuleCompiler는 활성화된 운영계획을 5대 트리거(스케줄, 패트롤, 이벤트, 조건부, 성과) 규칙으로 자동 변환한다', () => {
    const proposals = generateOperatingPlanProposals({
      workspaceId: sampleWorkspaceId,
      goal: sampleGoal,
      context: sampleContext,
    });

    const balanced = proposals.find(p => p.autonomyPreset === 'balanced')!;
    const plan: AgentOperatingPlan = {
      ...balanced,
      id: 'plan-101',
      workspaceId: sampleWorkspaceId,
      planVersion: 1,
      status: 'active',
      createdBy: 'sohee',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const rules = compilePlanToRules(plan);

    // 규칙들이 생성되었는지 검증
    expect(rules.length).toBeGreaterThanOrEqual(5);

    // 1. Scheduled Trigger (월/수/금 등 콘텐츠 게시)
    const scheduledRules = rules.filter(r => r.triggerType === 'scheduled');
    expect(scheduledRules.length).toBeGreaterThanOrEqual(3);
    expect(scheduledRules.some(r => r.channelScopes.includes('instagram'))).toBe(true);
    expect(scheduledRules.some(r => r.channelScopes.includes('threads'))).toBe(true);

    // V1.2 정책: 네이버 블로그는 자동 포스팅이 아닌 원고 준비로 명명
    const naverBlogRule = scheduledRules.find(r => r.channelScopes.includes('naver_blog'));
    expect(naverBlogRule).toBeDefined();
    expect(naverBlogRule?.name).toBe('네이버 블로그 시술 후기·칼럼 원고 준비');
    expect(naverBlogRule?.name).not.toContain('자동 포스팅');

    // 2. Interval / Patrol Trigger (영업시간 내 주기적 미응답/댓글/DM 감시)
    const patrolRules = rules.filter(r => r.triggerType === 'interval_patrol');
    expect(patrolRules.length).toBeGreaterThanOrEqual(1);
    expect(patrolRules[0].actionTypes).toContain('instagram.read_dm');

    // 3. Event Trigger (dm.received, comment.received 등 실시간 응답)
    const eventRules = rules.filter(r => r.triggerType === 'event');
    expect(eventRules.length).toBeGreaterThanOrEqual(1);
    expect(eventRules[0].actionTypes).toContain('customer.classify');

    // 4. Conditional Trigger (빈 슬롯 발생 시 예약 유도 캠페인)
    const conditionalRules = rules.filter(r => r.triggerType === 'conditional');
    expect(conditionalRules.length).toBeGreaterThanOrEqual(1);
    expect(conditionalRules[0].conditions?.length).toBeGreaterThan(0);

    // 5. Performance Trigger (성과 분석 및 전략 피드백)
    const performanceRules = rules.filter(r => r.triggerType === 'performance');
    expect(performanceRules.length).toBeGreaterThanOrEqual(1);
  });
});
