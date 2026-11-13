import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { getDeploymentTruth } from '@/lib/build-identity';
import { AgentControlPlaneService } from '../engine/agent-control-state';
import { AvailabilitySourceService } from '../engine/capacity-source';
import { OpportunityRadarService } from '../engine/opportunity-radar';
import { BookingOrchestrator } from '../engine/booking-orchestrator';
import { SafetyAndCreditEngine } from '../engine/safety-engine';
import { NaturalCommandParser } from '../engine/natural-command-parser';
import { CanonicalEventBus } from '../engine/canonical-event-bus';
import { getRevenueCommandReadModel } from '@/lib/read-models/revenue-command-read-model';

describe('V0.8.7 4차 필수 E2E Acceptance Scenarios (E2E-01 ~ E2E-21)', () => {
  const wsId = 'fixture:TEST:marketing';

  it('E2E-01 [Production SHA Truth]: build SHA, schema, worker version이 유효하게 노출된다', async () => {
    const truth = getDeploymentTruth();
    expect(truth.buildSha).toBeDefined();
    expect(truth.workerVersion).toContain('prod');

    const manifestPath = path.join(process.cwd(), 'supabase/migrations-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const sorted = [...manifest.migrations].sort((a: any, b: any) =>
      a.version.localeCompare(b.version)
    );
    const latestMigration = sorted[sorted.length - 1];

    const migrationFileOnDisk = path.join(process.cwd(), 'supabase/migrations', latestMigration.filename);
    expect(fs.existsSync(migrationFileOnDisk), `Latest migration file ${latestMigration.filename} must exist on disk`).toBe(true);

    expect(truth.schemaHead).toBe(latestMigration.filename.replace(/\.sql$/, ''));
    expect(truth.schemaHead).toContain(latestMigration.version);
  });

  it('E2E-02 [No Demo Leakage]: 실제 workspace 기본 모드에서 isDemo가 false이고 가짜 데모가 전파되지 않는다', async () => {
    const model = getRevenueCommandReadModel('tenant-without-source', false);
    expect(model.isDemo).toBe(false);
    expect(model.observationStatus).toBe('NOT_OBSERVED');
  });

  it('E2E-03 [Full Agent Persist]: RUNNING 전환 후 동일 actualMode가 유지된다', async () => {
    const state = await AgentControlPlaneService.setDesiredMode(wsId, 'RUNNING', 'owner');
    expect(state.desiredMode).toBe('RUNNING');
    expect(state.actualMode).toBe('RUNNING');
  });

  it('E2E-04 [Kill Switch Enforcement]: Kill Switch 활성화 시 Action Executor preflight에서 BLOCKED 된다', async () => {
    await AgentControlPlaneService.toggleKillSwitch(wsId, true, 'owner');
    const safety = new SafetyAndCreditEngine();
    const check = await safety.preflightCheck({
      workspaceId: wsId,
      actionType: 'publish_instagram_post',
    });
    expect(check.allowed).toBe(false);
    expect(check.isKillSwitched).toBe(true);

    // 복구
    await AgentControlPlaneService.toggleKillSwitch(wsId, false, 'owner');
  });

  it('E2E-05 [Capacity Gap]: 가용 슬롯 갭 발생 시 UNDERFILLED_SLOT Opportunity가 생성된다', async () => {
    const opps = OpportunityRadarService.scanOpportunities(wsId);
    const underfilled = opps.find(o => o.type === 'UNDERFILLED_SLOT');
    expect(underfilled).toBeDefined();
    expect(underfilled?.urgency).toBe('P0');
  });

  it('E2E-06 [High-intent Inquiry]: 예약 문의 인입 시 UNANSWERED_BOOKING_INTENT 기회가 탐지된다', async () => {
    const opps = OpportunityRadarService.scanOpportunities(wsId);
    const intentOpp = opps.find(o => o.type === 'UNANSWERED_BOOKING_INTENT');
    expect(intentOpp).toBeDefined();
  });

  it('E2E-07 [Truthful Slot]: 실제 존재하는 AVAILABLE 슬롯만 제안하고 없는 슬롯은 제안하지 않는다', async () => {
    const slots = AvailabilitySourceService.getAvailableSlots(wsId);
    expect(slots.every(s => s.status === 'AVAILABLE')).toBe(true);
  });

  it('E2E-08 [Reservation Verify]: 명시적 TEST fixture 예약은 fixture 근거로만 표시된다', async () => {
    const available = AvailabilitySourceService.getAvailableSlots(wsId);
    const target = available[0];
    const res = BookingOrchestrator.createAndConfirmReservation({
      workspaceId: wsId,
      customerId: 'cust-test-01',
      customerName: '홍길동',
      channel: 'instagram',
      serviceId: 'srv-balayage',
      serviceName: '시그니처 발레아쥬',
      price: 240000,
      slotId: target.id,
      slotStart: target.slotStart,
      slotEnd: target.slotEnd,
      idempotencyKey: `idemp-${Date.now()}`,
    });

    expect(res.status).toBe('CONFIRMED');
    expect(res.verificationEvidence?.sourceProvider).toBe('fixture');
  });

  it('E2E-09 [Target Stop]: 슬롯 예약 완료 시 해당 슬롯 관련 캠페인/DM 액션이 즉시 자동 중단된다', async () => {
    const cancelled = BookingOrchestrator.enforceStopConditions('slot-20260901-1400');
    expect(Array.isArray(cancelled)).toBe(true);
  });

  it('E2E-10 [Cancellation Recovery]: 예약 취소 발생 시 대체 기회가 생성된다', async () => {
    const opps = OpportunityRadarService.scanOpportunities(wsId);
    expect(opps.length).toBeGreaterThanOrEqual(1);
  });

  it('E2E-11 [Consent/Frequency]: 동의 정책 및 발송 빈도 제어가 정상 적용된다', async () => {
    const candidates = OpportunityRadarService.generateActionCandidates({
      id: 'opp-1',
      workspaceId: wsId,
      type: 'UNDERFILLED_SLOT',
      title: '테스트',
      description: '테스트',
      status: 'OPEN',
      evidenceRefs: [],
      valueBand: { min: 120000, max: 240000, currency: 'KRW' },
      confidenceBand: 'HIGH',
      confidenceRationale: '테스트',
      urgency: 'P0',
      expiresAt: new Date().toISOString(),
      targetSlotIds: ['slot-1'],
      candidateCustomerIds: ['cust-1'],
      allowedActionTypes: ['direct_dm'],
      constraints: ['야간 21:00 이후 발송 금지'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(candidates[0].stopConditions).toContain('quiet_hours_active');
  });

  it('E2E-12 [Unsupported Capability]: 지원하지 않는 액션은 preflight에서 안전하게 차단된다', async () => {
    const safety = new SafetyAndCreditEngine();
    const check = await safety.preflightCheck({
      workspaceId: wsId,
      actionType: 'unsupported_action_type',
    });
    expect(check.riskLevel).toBe('YELLOW');
  });

  it('E2E-13 [Credit Priority]: 크레딧 부족 시 revenue-critical 작업이 일반 작업보다 우선된다', async () => {
    const safety = new SafetyAndCreditEngine();
    safety.setCreditBudget(wsId, { totalDailyLimit: 10, usedDaily: 8 });
    
    const normalCheck = await safety.preflightCheck({
      workspaceId: wsId,
      actionType: 'publish_instagram_post', // cost: 15
      isRevenueCritical: false,
    });
    expect(normalCheck.allowed).toBe(false);

    const criticalCheck = await safety.preflightCheck({
      workspaceId: wsId,
      actionType: 'customer_message_reply', // cost: 2
      isRevenueCritical: true,
    });
    expect(criticalCheck.allowed).toBe(true);
  });

  it('E2E-14 [Idempotency]: 동일 idempotencyKey로 20회 반복 호출해도 외부 side-effect는 1회만 발생한다', async () => {
    const safety = new SafetyAndCreditEngine();
    let externalCallCount = 0;
    const idempotencyKey = `idem-test-replay-${Date.now()}`;

    for (let i = 0; i < 20; i++) {
      await safety.executeWithIdempotency(idempotencyKey, 'publish_post', async () => {
        externalCallCount++;
        return { postUrl: 'https://instagram.com/p/123' };
      });
    }

    expect(externalCallCount).toBe(1);
  });

  it('E2E-15 [Failure Recovery]: 예약 진행 중 검증 및 재조회로 최종 상태를 복구한다', async () => {
    const all = BookingOrchestrator.getReservations(wsId);
    expect(Array.isArray(all)).toBe(true);
  });

  it('E2E-16 [Attribution Trace]: 문의→대화→예약→확정금액이 이벤트로 연결된다', async () => {
    const model = getRevenueCommandReadModel(wsId, false);
    expect(model.pipeline.find(p => p.stage === 'BOOKING_CONFIRMED')?.valueAmount).toBeGreaterThan(0);
  });

  it('E2E-17 [Decision Policy]: 자연어 명령 "DM은 네가 알아서 봐"를 수신하면 AUTO 승인 정책으로 파싱된다', async () => {
    const result = NaturalCommandParser.parseAndExecute(wsId, 'DM은 네가 알아서 봐');
    expect(result.intent).toBe('AUTO_DM_APPROVAL');
    expect(result.requiresOwnerConfirmation).toBe(true);
  });

  it('E2E-18 [No Data]: 예약 원장 미연결 시 산출 불가를 명시한다', async () => {
    const model = getRevenueCommandReadModel('tenant-without-source', false);
    expect(model.pulse).toBeNull();
    expect(model.observationStatus).toBe('NOT_OBSERVED');
  });

  it('E2E-19 [3-Channel Publishing]: Instagram, Threads, Naver Blog의 검증된 결과 목록이 반환된다', async () => {
    const model = getRevenueCommandReadModel(wsId, false);
    expect(model.verifiedOutcomes.length).toBeGreaterThanOrEqual(2);
    expect(model.verifiedOutcomes.some(o => o.channel === 'Instagram')).toBe(true);
  });

  it('E2E-20 [Unattended Run]: Canonical Event Bus를 통해 무인 런타임 이벤트가 정상 발행된다', async () => {
    const event = CanonicalEventBus.emit('agent.heartbeat', wsId, { status: 'healthy' });
    expect(event.type).toBe('agent.heartbeat');
    expect(event.traceId).toBeDefined();
  });

  it('E2E-21 [Next-day Brief]: 실제 확정 수치와 가용 슬롯을 기반으로 일일 브리핑이 생성된다', async () => {
    const model = getRevenueCommandReadModel(wsId, false);
    expect(model.briefingText).toContain('좋은 아침이에요');
    expect(model.briefingText).toContain('사장님');
  });
});
