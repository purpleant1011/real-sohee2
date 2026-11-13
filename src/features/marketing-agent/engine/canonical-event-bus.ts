export type CanonicalEventType =
  | 'agent.control_requested'
  | 'agent.control_changed'
  | 'agent.mode_degraded'
  | 'agent.heartbeat'
  | 'capacity.snapshot_observed'
  | 'availability.changed'
  | 'capacity.gap_detected'
  | 'opportunity.detected'
  | 'opportunity.prioritized'
  | 'opportunity.acting'
  | 'opportunity.converted'
  | 'opportunity.expired'
  | 'action.candidate_created'
  | 'action.selected'
  | 'action.skipped'
  | 'action.cancelled_by_stop_condition'
  | 'customer.reachability_changed'
  | 'followup.due'
  | 'followup.suppressed'
  | 'reservation.slot_observed'
  | 'reservation.slot_proposed'
  | 'reservation.external_accepted'
  | 'reservation.verified'
  | 'reservation.confirmed'
  | 'reservation.cancelled'
  | 'revenue.booked_value_changed'
  | 'revenue.realized'
  | 'revenue.attributed'
  | 'decision.requested'
  | 'decision.resolved'
  | 'policy.version_created'
  | 'target.achieved';

export interface CanonicalEvent<T = Record<string, unknown>> {
  eventId: string;
  type: CanonicalEventType;
  workspaceId: string;
  occurredAt: string;
  source: string;
  sourceRef: string;
  traceId: string;
  schemaVersion: string;
  payload: T;
}

export class CanonicalEventBus {
  private static eventLog: CanonicalEvent[] = [];
  private static listeners: Array<(event: CanonicalEvent) => void> = [];

  static emit<T = Record<string, unknown>>(
    type: CanonicalEventType,
    workspaceId: string,
    payload: T,
    source: string = 'sohee-core',
    sourceRef: string = `ref-${Date.now()}`
  ): CanonicalEvent<T> {
    const event: CanonicalEvent<T> = {
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      workspaceId,
      occurredAt: new Date().toISOString(),
      source,
      sourceRef,
      traceId: `trace-${Date.now()}`,
      schemaVersion: 'v0.8.7-4',
      payload,
    };

    this.eventLog.push(event as unknown as CanonicalEvent);
    for (const listener of this.listeners) {
      try {
        listener(event as unknown as CanonicalEvent);
      } catch (err) {
        console.error('Event bus listener error:', err);
      }
    }

    return event;
  }

  static subscribe(listener: (event: CanonicalEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  static getEvents(workspaceId: string, type?: CanonicalEventType): CanonicalEvent[] {
    return this.eventLog.filter(e => e.workspaceId === workspaceId && (!type || e.type === type));
  }
}
