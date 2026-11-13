import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilitySourceService, BYREUM_WORKSPACE_ID } from '../capacity-source';
import { getMarketingMemories } from '../marketing-memory';
import { OpportunityRadarService, detectOpportunities } from '../opportunity-radar';
import { BookingOrchestrator } from '../booking-orchestrator';
import { CustomerReservationRevenueEngine } from '../customer-reservation-revenue';
import { getRevenueCommandReadModel } from '@/lib/read-models/revenue-command-read-model';

const realWorkspaces = [BYREUM_WORKSPACE_ID, 'ws-byreum', 'ws-seed-default', 'tenant-b'];
const fixtureWorkspace = 'fixture:TEST:marketing';

describe('ANI-1954 runtime source truth', () => {
  beforeEach(() => AvailabilitySourceService.resetStateForTesting());
  afterEach(() => vi.unstubAllEnvs());

  it.each(realWorkspaces)('%s never inherits sample slots, memories or outcomes', workspaceId => {
    expect(getMarketingMemories(workspaceId)).toEqual([]);
    expect(() => AvailabilitySourceService.getSnapshot(workspaceId)).toThrow(/NOT_OBSERVED/);
    expect(() => AvailabilitySourceService.getAvailableSlots(workspaceId)).toThrow(/NOT_OBSERVED/);
    expect(OpportunityRadarService.scanOpportunities(workspaceId)).toEqual([]);
    expect(detectOpportunities(workspaceId)).toEqual([]);
    expect(detectOpportunities({ workspaceId, emptySlotsCount: 0, unbookedInquiriesCount: 0, recontactEligibleCount: 0, pendingReviewsCount: 0, disconnectedChannelsCount: 0, expiringChannelsCount: 0 })).toEqual([]);
    const model = getRevenueCommandReadModel(workspaceId, true);
    expect(model).toMatchObject({ observationStatus: 'NOT_OBSERVED', pulse: null, pipeline: [], decisions: [], topOpportunities: [], next24HoursQueue: [], verifiedOutcomes: [] });
    expect(model.briefingText).not.toMatch(/18|3명|확정되어/);
  });

  it('explicit TEST/SHOWCASE fixtures are labelled and disabled in production even after cache warming', () => {
    for (const workspaceId of [fixtureWorkspace, 'fixture:SHOWCASE:marketing']) {
      const snapshot = AvailabilitySourceService.getSnapshot(workspaceId);
      expect(snapshot.sourceProvider).toBe('fixture');
      expect(snapshot.slots.length).toBeGreaterThan(0);
      expect(getMarketingMemories(workspaceId).every(m => m.workspaceId === workspaceId)).toBe(true);
    }
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => AvailabilitySourceService.getSnapshot(fixtureWorkspace)).toThrow(/NOT_OBSERVED/);
    expect(getMarketingMemories(fixtureWorkspace)).toEqual([]);
    expect(OpportunityRadarService.scanOpportunities(fixtureWorkspace)).toEqual([]);
  });

  it.each(realWorkspaces)('production also fails closed for %s', workspaceId => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => AvailabilitySourceService.getSnapshot(workspaceId)).toThrow(/NOT_OBSERVED/);
    expect(getMarketingMemories(workspaceId)).toEqual([]);
    expect(getRevenueCommandReadModel(workspaceId, true).pulse).toBeNull();
  });

  it('fixture booking idempotency cannot return another context reservation', () => {
    const slot = AvailabilitySourceService.getAvailableSlots(fixtureWorkspace)[0];
    const input = { workspaceId: fixtureWorkspace, customerId: 'sample-c', customerName: '샘플', channel: 'instagram', serviceId: slot.serviceId, serviceName: '샘플', price: 100, slotId: slot.id, slotStart: slot.slotStart, slotEnd: slot.slotEnd, idempotencyKey: 'fixture-shared-key' };
    const reservation = BookingOrchestrator.createAndConfirmReservation(input);
    expect(reservation.externalReservationId).toMatch(/^fixture_/);
    expect(reservation.verificationEvidence?.sourceProvider).toBe('fixture');
    expect(BookingOrchestrator.createAndConfirmReservation(input).id).toBe(reservation.id);
    expect(() => BookingOrchestrator.createAndConfirmReservation({ ...input, workspaceId: 'fixture:SHOWCASE:marketing' })).toThrow(/SLOT_NOT_AVAILABLE/);
    expect(() => BookingOrchestrator.createAndConfirmReservation({ ...input, workspaceId: 'tenant-b' })).toThrow(/NOT_OBSERVED/);
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => BookingOrchestrator.createAndConfirmReservation(input)).toThrow(/NOT_OBSERVED/);
    expect(BookingOrchestrator.getReservations(fixtureWorkspace)).toEqual([]);
  });

  it('booking cannot fabricate external confirmation or cross tenant idempotency', () => {
    const input = { workspaceId: BYREUM_WORKSPACE_ID, customerId: 'c', customerName: '고객', channel: 'instagram', serviceId: 'srv-natural-eyebrow', serviceName: '눈썹', price: 220000, slotId: 'slot-byreum-1400', slotStart: '2026-09-12T14:00:00+09:00', slotEnd: '2026-09-12T15:30:00+09:00', idempotencyKey: 'shared-key' };
    expect(() => BookingOrchestrator.createAndConfirmReservation(input)).toThrow(/NOT_OBSERVED/);
    expect(() => BookingOrchestrator.searchAndProposeSlot(input.workspaceId, 'c', input.serviceId)).toThrow(/NOT_OBSERVED/);
    expect(BookingOrchestrator.getReservations(input.workspaceId)).toEqual([]);
    expect(() => BookingOrchestrator.createAndConfirmReservation({ ...input, workspaceId: 'tenant-b' })).toThrow(/NOT_OBSERVED/);
  });

  it('customer engine cannot confirm a real reservation without a provider', () => {
    const engine = new CustomerReservationRevenueEngine();
    const reservation = engine.createReservationProposal({ workspaceId: 'tenant-b', customerId: 'c', serviceId: 'service', proposedSlots: [], sourceChannel: 'instagram' });
    expect(() => engine.confirmReservation(reservation.id, 'requested-time')).toThrow(/NOT_OBSERVED/);
    expect(engine.getReservations('tenant-b')[0].status).toBe('SLOT_PROPOSED');
    expect(engine.getRevenueTraces('tenant-b')).toEqual([]);
  });

  it('does not record an unobserved payment as zero revenue', () => {
    const engine = new CustomerReservationRevenueEngine();
    const reservation = engine.createReservationProposal({ workspaceId: fixtureWorkspace, customerId: 'c', serviceId: 'service', proposedSlots: [], sourceChannel: 'instagram' });
    engine.confirmReservation(reservation.id, 'requested-time');
    expect(engine.getRevenueTraces(fixtureWorkspace)[0].realizedRevenue).toBeNull();
  });

  it('fixture mutations cannot address a slot belonging to another context', () => {
    const own = AvailabilitySourceService.getAvailableSlots(fixtureWorkspace)[0];
    expect(AvailabilitySourceService.markSlotBooked(own.id, 'fixture:SHOWCASE:marketing')).toBeNull();
    expect(AvailabilitySourceService.markSlotBooked(own.id)).toBeNull();
    expect(AvailabilitySourceService.getAvailableSlots(fixtureWorkspace)[0].status).toBe('AVAILABLE');
    const snapshot = AvailabilitySourceService.getSnapshot(fixtureWorkspace);
    snapshot.slots[0].status = 'BOOKED';
    expect(AvailabilitySourceService.getAvailableSlots(fixtureWorkspace)[0].status).toBe('AVAILABLE');
  });

  it('proposal prices and shop identity do not come from another tenant catalog', () => {
    const engine = new CustomerReservationRevenueEngine();
    const reservation = engine.createReservationProposal({ workspaceId: 'tenant-b', customerId: 'c', serviceId: 'srv-natural-eyebrow', serviceName: '입력 서비스', proposedSlots: [], sourceChannel: 'instagram' });
    expect(reservation.totalAmount).toBeUndefined();
    expect(reservation.serviceName).toBe('입력 서비스');
    const reply = engine.processInboundMessage({ workspaceId: 'tenant-b', customerId: 'c', channel: 'instagram', externalThreadId: 'thread', text: '영업시간과 위치 알려주세요' });
    expect(reply.autoReplyText).not.toMatch(/바이름|청라|10:00|20:00/);
    const booking = engine.processInboundMessage({ workspaceId: 'tenant-b', customerId: 'c', channel: 'instagram', externalThreadId: 'thread', text: '예약 가능한가요' });
    expect(booking.autoReplyText).toMatch(/확인/);
    expect(booking.autoReplyText).not.toMatch(/가장 빠른 가능 시간/);
  });
});
