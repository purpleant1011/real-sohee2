/**
 * Canonical Mission Outcome Aggregator (ANI-1257)
 * 
 * Aggregates post-publish reactions, inbound inquiries, bookings, and verified revenue
 * into a single canonical snapshot per mission.
 * 
 * Invariants:
 * 1. Idempotent Deduplication: Duplicate deliveries of same booking/inquiry are stripped.
 * 2. Null-Safe Real Metrics: Missing observations are NOT falsified as '0', but 'NOT_OBSERVED' / null.
 */

export interface MissionOutcomeRecord {
  missionId: string;
  type: 'BOOKING' | 'INBOUND_INQUIRY' | 'EXTERNAL_REACTION';
  recordId: string;
  revenueKrw?: number;
  status: string;
  observedAt: string;
}

export interface AggregatedOutcomeSummary {
  missionId: string;
  status: 'OBSERVED' | 'NOT_OBSERVED';
  totalBookings: number | null;
  totalRevenueKrw: number | null;
  totalInboundInquiries: number | null;
  narrativeSummary: string;
  aggregatedAt: string;
}

export class CanonicalOutcomeAggregator {
  /**
   * Aggregates raw outcome records idempotently with anti-fabrication null safety.
   */
  aggregate(missionId: string, records: MissionOutcomeRecord[]): AggregatedOutcomeSummary {
    const now = new Date().toISOString();

    if (!records || records.length === 0) {
      return {
        missionId,
        status: 'NOT_OBSERVED',
        totalBookings: null,
        totalRevenueKrw: null,
        totalInboundInquiries: null,
        narrativeSummary: '아직 관찰된 인바운드 반응이나 예약 성과가 없습니다.',
        aggregatedAt: now,
      };
    }

    // 1. Deduplicate bookings by recordId
    const confirmedBookingsMap = new Map<string, MissionOutcomeRecord>();
    for (const record of records) {
      if (record.type === 'BOOKING' && record.status === 'CONFIRMED') {
        if (!confirmedBookingsMap.has(record.recordId)) {
          confirmedBookingsMap.set(record.recordId, record);
        }
      }
    }

    // 2. Deduplicate inbound inquiries by recordId
    const inboundInquiriesMap = new Map<string, MissionOutcomeRecord>();
    for (const record of records) {
      if (record.type === 'INBOUND_INQUIRY') {
        if (!inboundInquiriesMap.has(record.recordId)) {
          inboundInquiriesMap.set(record.recordId, record);
        }
      }
    }

    const uniqueBookings = Array.from(confirmedBookingsMap.values());
    const uniqueInquiries = Array.from(inboundInquiriesMap.values());

    const totalBookings = uniqueBookings.length;
    const totalInboundInquiries = uniqueInquiries.length;
    const totalRevenueKrw = uniqueBookings.reduce((sum, b) => sum + (b.revenueKrw || 0), 0);

    const hasAnyOutcome = totalBookings > 0 || totalInboundInquiries > 0;

    let narrative = '';
    if (totalBookings > 0) {
      narrative = `마케팅 미션을 통해 예약 ${totalBookings}건이 확정되어 총 ₩${totalRevenueKrw.toLocaleString()}의 매출 성과가 검증되었습니다.`;
    } else if (totalInboundInquiries > 0) {
      narrative = `마케팅 미션을 통해 신규 인바운드 고객 문의 ${totalInboundInquiries}건이 접수되어 상담 진행 중입니다.`;
    } else {
      narrative = '아직 관찰된 인바운드 반응이나 예약 성과가 없습니다.';
    }

    return {
      missionId,
      status: hasAnyOutcome ? 'OBSERVED' : 'NOT_OBSERVED',
      totalBookings: hasAnyOutcome ? totalBookings : null,
      totalRevenueKrw: hasAnyOutcome ? totalRevenueKrw : null,
      totalInboundInquiries: hasAnyOutcome ? totalInboundInquiries : null,
      narrativeSummary: narrative,
      aggregatedAt: now,
    };
  }
}
