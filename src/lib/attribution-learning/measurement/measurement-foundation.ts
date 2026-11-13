/**
 * Measurement Foundation Engine (ANI-786)
 * 
 * Canonical Event Store & Measurement Health Monitor.
 * 
 * Invariants:
 * 1. Measurement failure must NEVER be reported as 0. Must preserve MISSING / STALE / UNKNOWN.
 * 2. All conversions must be stored append-only with revision tracking for cancellations/delays.
 * 3. Raw PII is never exposed as an attribution key.
 */

export type CanonicalEventType =
  | 'PAGE_VIEW'
  | 'LEAD'
  | 'FORM_SUBMIT'
  | 'CALL_CLICK'
  | 'MESSAGE_START'
  | 'RESERVATION_REQUEST'
  | 'RESERVATION_CONFIRMED'
  | 'PURCHASE'
  | 'REVENUE'
  | 'REFUND'
  | 'OFFLINE_CONVERSION';

export type MeasurementSourceStatus = 'HEALTHY' | 'STALE' | 'MISSING' | 'UNKNOWN';

export interface UtmSet {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface CanonicalEvent {
  eventId: string;
  workspaceId: string;
  anonymousId: string;
  customerId?: string; // Hashed or tokenized non-PII ID
  eventType: CanonicalEventType;
  valueKRW: number;
  occurredAt: string;
  receivedAt: string;
  source: 'GA4' | 'SEARCH_CONSOLE' | 'FIRST_PARTY_WEBHOOK' | 'META' | 'NAVER';
  campaignId?: string;
  actionId?: string;
  channel?: string;
  utmSet?: UtmSet;
  dedupeKey: string;
  isReconciliationRevision?: boolean;
  reconciliationRefEventId?: string;
}

export interface MeasurementSourceHealth {
  source: string;
  status: MeasurementSourceStatus;
  lastEventReceivedAt?: string;
  errorMessage?: string;
}

export class MeasurementFoundation {
  private events: CanonicalEvent[] = [];
  private seenDedupeKeys = new Set<string>();
  private sourceHealthMap = new Map<string, MeasurementSourceHealth>();

  constructor() {
    // Initial health state defaults to UNKNOWN until events arrive
    this.sourceHealthMap.set('GA4', { source: 'GA4', status: 'UNKNOWN' });
    this.sourceHealthMap.set('SEARCH_CONSOLE', { source: 'SEARCH_CONSOLE', status: 'UNKNOWN' });
    this.sourceHealthMap.set('FIRST_PARTY_WEBHOOK', { source: 'FIRST_PARTY_WEBHOOK', status: 'UNKNOWN' });
  }

  public getSourceHealth(source: string): MeasurementSourceHealth {
    return this.sourceHealthMap.get(source) ?? { source, status: 'UNKNOWN' };
  }

  public setSourceHealth(source: string, status: MeasurementSourceStatus, errorMessage?: string): void {
    const existing = this.getSourceHealth(source);
    this.sourceHealthMap.set(source, {
      ...existing,
      status,
      errorMessage,
    });
  }

  public ingestEvent(event: CanonicalEvent): { accepted: boolean; reason?: string } {
    // 1. Deduplication check
    if (this.seenDedupeKeys.has(event.dedupeKey)) {
      return { accepted: false, reason: 'DUPLICATE_EVENT_DROPPED' };
    }

    this.seenDedupeKeys.add(event.dedupeKey);
    this.events.push(event);

    // Update source health to HEALTHY
    this.sourceHealthMap.set(event.source, {
      source: event.source,
      status: 'HEALTHY',
      lastEventReceivedAt: event.receivedAt,
    });

    return { accepted: true };
  }

  /**
   * Append-only reconciliation: Instead of modifying past events,
   * append a revision event (e.g. cancellation or delayed refund).
   */
  public recordReconciliationRevision(
    originalEventId: string,
    revisionType: CanonicalEventType,
    deltaValueKRW: number,
    workspaceId: string
  ): CanonicalEvent {
    const revisionEvent: CanonicalEvent = {
      eventId: `rev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      workspaceId,
      anonymousId: 'system-reconciler',
      eventType: revisionType,
      valueKRW: deltaValueKRW,
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      source: 'FIRST_PARTY_WEBHOOK',
      dedupeKey: `dedupe-rev-${originalEventId}-${revisionType}`,
      isReconciliationRevision: true,
      reconciliationRefEventId: originalEventId,
    };

    this.events.push(revisionEvent);
    return revisionEvent;
  }

  public getEvents(workspaceId: string): readonly CanonicalEvent[] {
    return this.events.filter(e => e.workspaceId === workspaceId);
  }

  public getNetRevenueKRW(workspaceId: string): number {
    return this.events
      .filter(e => e.workspaceId === workspaceId)
      .reduce((acc, ev) => {
        if (ev.eventType === 'PURCHASE' || ev.eventType === 'REVENUE') {
          return acc + ev.valueKRW;
        }
        if (ev.eventType === 'REFUND') {
          return acc - ev.valueKRW;
        }
        return acc;
      }, 0);
  }
}
