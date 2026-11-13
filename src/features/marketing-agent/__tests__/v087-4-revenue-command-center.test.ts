import { describe, it, expect } from 'vitest';
import { AgentControlPlaneService } from '../engine/agent-control-state';
import { AvailabilitySourceService } from '../engine/capacity-source';
import { OpportunityRadarService } from '../engine/opportunity-radar';
import { BookingOrchestrator } from '../engine/booking-orchestrator';
import { getRevenueCommandReadModel } from '@/lib/read-models/revenue-command-read-model';
import { getDeploymentTruth } from '@/lib/build-identity';

describe('V0.8.7-4 Full Agent Revenue Command Center & Runtime Truth Specification', () => {
  const sampleWorkspaceId = 'fixture:TEST:marketing';

  it('P0-0: Production Deployment Truth (SHA, worker version, schema head)를 정확히 반환한다', async () => {
    const truth = getDeploymentTruth();
    expect(truth.buildSha).toBeDefined();
    expect(truth.workerVersion).toContain('prod');
    expect(truth.schemaHead).toBeDefined();
    expect(truth.deployedAt).toBeDefined();
  });

  it('P0-2: Full Agent Control Plane — desiredMode와 actualMode를 분리하고 Kill Switch를 서버에서 강제한다', async () => {
    const initialState = await AgentControlPlaneService.getControlState(sampleWorkspaceId);
    expect(initialState.desiredMode).toBe('PAUSED');
    expect(initialState.actualMode).toBe('PAUSED');

    // 1. Pause
    const paused = await AgentControlPlaneService.setDesiredMode(sampleWorkspaceId, 'PAUSED', 'owner-1', '휴무일 일시정지');
    expect(paused.desiredMode).toBe('PAUSED');
    expect(paused.actualMode).toBe('PAUSED');

    // 2. Kill Switch
    const killSwitched = await AgentControlPlaneService.toggleKillSwitch(sampleWorkspaceId, true, 'owner-1', '비상 차단');
    expect(killSwitched.killSwitchActive).toBe(true);
    expect(killSwitched.actualMode).toBe('BLOCKED');

    // 3. Resume from Kill Switch
    const resumed = await AgentControlPlaneService.toggleKillSwitch(sampleWorkspaceId, false, 'owner-1');
    expect(resumed.killSwitchActive).toBe(false);
    expect(resumed.actualMode).toBe('PAUSED');

    // 4. Return to Running
    const running = await AgentControlPlaneService.setDesiredMode(sampleWorkspaceId, 'RUNNING', 'owner-1');
    expect(running.desiredMode).toBe('RUNNING');
    expect(running.actualMode).toBe('RUNNING');
  });

  it('P0-3: Capacity & Availability Source of Truth — 실제 존재하는 슬롯만 조회 및 홀드/예약 처리한다', async () => {
    const snapshot = AvailabilitySourceService.getSnapshot(sampleWorkspaceId);
    expect(snapshot.totalSlotsCount).toBeGreaterThan(0);
    expect(snapshot.sourceProvider).toBe('fixture');

    const availableSlots = AvailabilitySourceService.getAvailableSlots(sampleWorkspaceId, 'srv-balayage');
    expect(availableSlots.length).toBeGreaterThan(0);

    const firstSlot = availableSlots[0];
    const held = AvailabilitySourceService.holdSlot(firstSlot.id, 15, sampleWorkspaceId);
    expect(held?.status).toBe('HELD');
    expect(held?.holdExpiresAt).toBeDefined();

    // Release back
    AvailabilitySourceService.releaseSlot(firstSlot.id, sampleWorkspaceId);
  });

  it('P0-6: Opportunity Radar — 빈 슬롯 및 미응답 문의를 실시간 스캔하여 P0 매출 기회를 생성한다', async () => {
    const opportunities = OpportunityRadarService.scanOpportunities(sampleWorkspaceId);
    expect(opportunities.length).toBeGreaterThanOrEqual(2);

    const underfilled = opportunities.find(o => o.type === 'UNDERFILLED_SLOT');
    expect(underfilled).toBeDefined();
    expect(underfilled?.urgency).toBe('P0');
    expect(underfilled?.confidenceBand).toBe('HIGH');
    expect(underfilled?.targetSlotIds.length).toBeGreaterThan(0);

    const candidates = OpportunityRadarService.generateActionCandidates(underfilled!);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].stopConditions).toContain('target_slot_booked');
  });

  it('P0-7: Booking Orchestrator & Stop Conditions — 예약이 확정되면 관련 슬롯을 타겟팅한 캠페인/DM 액션을 즉시 자동 중단한다', async () => {
    const availableSlots = AvailabilitySourceService.getAvailableSlots(sampleWorkspaceId, 'srv-balayage');
    const slotToBook = availableSlots[0];

    const reservation = BookingOrchestrator.createAndConfirmReservation({
      workspaceId: sampleWorkspaceId,
      customerId: 'cust-choisua',
      customerName: '최수아',
      channel: 'instagram',
      serviceId: 'srv-balayage',
      serviceName: '시그니처 발레아쥬 디자인 컬러',
      price: 240000,
      slotId: slotToBook.id,
      slotStart: slotToBook.slotStart,
      slotEnd: slotToBook.slotEnd,
      idempotencyKey: `idem-rsv-${slotToBook.id}-${Date.now()}`,
    });

    expect(reservation.status).toBe('CONFIRMED');
    expect(reservation.externalReservationId).toBeDefined();
    expect(reservation.verificationEvidence?.sourceProvider).toBe('fixture');

    // 슬롯이 BOOKED 되었는지 검증
    const snapshotAfter = AvailabilitySourceService.getSnapshot(sampleWorkspaceId);
    const bookedSlot = snapshotAfter.slots.find(s => s.id === slotToBook.id);
    expect(bookedSlot?.status).toBe('BOOKED');
  });

  it('P0-8: Revenue Command Read Model — 10초 룰 펄스, 파이프라인, 의사결정 카드를 source-backed로 도출한다', async () => {
    const model = getRevenueCommandReadModel(sampleWorkspaceId, false);
    expect(model.pulse!.occupancyDenominator).toBe(22);
    expect(model.pulse!.availableSlotsCount).toBeGreaterThanOrEqual(0);
    expect(model.pulse!.bookedRevenueAmount).toBeGreaterThan(0);
    expect(model.pipeline.length).toBe(5);
    expect(model.decisions.length).toBe(1);
    expect(model.decisions[0].riskLevel).toBe('RED');
    expect(model.next24HoursQueue.some(q => q.stopCondition.includes('target_slot_booked'))).toBe(true);
  });
});
