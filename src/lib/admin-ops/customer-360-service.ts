/**
 * Admin Customer 360 Service
 * 
 * ANI-874: Customer 360 Commercial Timeline
 * ANI-875: Customer Activation State
 * ANI-876: Customer Canonical ID Chain
 */

export type ActivationState =
  | 'BUSINESS_UNVERIFIED'
  | 'TRIAL_ACTIVE'
  | 'PAID_HEALTHY'
  | 'AT_RISK'
  | 'CHURNED'
  | 'REVIVED';

export type CommercialTimelineStage =
  | 'IDENTITY_CREATED'
  | 'BUSINESS_VERIFIED'
  | 'ENTITLEMENT_GRANTED'
  | 'PLUGIN_INSTALLED'
  | 'PROOF_GENERATED'
  | 'PAYMENT_COMPLETED'
  | 'SUPPORT_TICKET_OPENED';

export interface CommercialTimelineEvent {
  eventId: string;
  workspaceId: string;
  stage: CommercialTimelineStage;
  title: string;
  detail: string;
  referenceId?: string;
  occurredAt: string;
}

export interface CanonicalIdChain {
  userId: string;
  businessId: string;
  workspaceId: string;
  subscriptionId?: string;
  creditLedgerId?: string;
  installedPluginIds: string[];
  channelAccountIds: string[];
  recentActionRunIds: string[];
  recentOutcomeIds: string[];
}

export class Customer360Service {
  private timelines: Map<string, CommercialTimelineEvent[]> = new Map();
  private activationStates: Map<string, ActivationState> = new Map();
  private idChains: Map<string, CanonicalIdChain> = new Map();

  /**
   * 상업 타임라인 이벤트 추가 (ANI-874)
   */
  recordTimelineEvent(event: Omit<CommercialTimelineEvent, 'eventId' | 'occurredAt'>): CommercialTimelineEvent {
    const eventId = `timeline_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const fullEvent: CommercialTimelineEvent = {
      ...event,
      eventId,
      occurredAt: new Date().toISOString(),
    };

    const list = this.timelines.get(event.workspaceId) || [];
    list.push(fullEvent);
    this.timelines.set(event.workspaceId, list);

    return fullEvent;
  }

  getTimeline(workspaceId: string): CommercialTimelineEvent[] {
    return this.timelines.get(workspaceId) || [];
  }

  /**
   * 활성화 상태 전이 및 평가 (ANI-875)
   */
  transitionActivationState(
    workspaceId: string,
    targetState: ActivationState,
    reason: string
  ): { previousState: ActivationState; newState: ActivationState; transitionedAt: string } {
    const previousState = this.activationStates.get(workspaceId) || 'BUSINESS_UNVERIFIED';
    this.activationStates.set(workspaceId, targetState);

    this.recordTimelineEvent({
      workspaceId,
      stage: 'ENTITLEMENT_GRANTED',
      title: `고객 상태 전이: ${previousState} -> ${targetState}`,
      detail: reason,
    });

    return {
      previousState,
      newState: targetState,
      transitionedAt: new Date().toISOString(),
    };
  }

  getActivationState(workspaceId: string): ActivationState {
    return this.activationStates.get(workspaceId) || 'BUSINESS_UNVERIFIED';
  }

  /**
   * 9대 정본 ID 체인 등록 및 무결성 검증 (ANI-876)
   */
  registerIdChain(chain: CanonicalIdChain): {
    isValid: boolean;
    missingRequiredKeys: string[];
  } {
    const missing: string[] = [];

    if (!chain.userId) missing.push('userId');
    if (!chain.businessId) missing.push('businessId');
    if (!chain.workspaceId) missing.push('workspaceId');

    const isValid = missing.length === 0;

    if (isValid) {
      this.idChains.set(chain.workspaceId, chain);
    }

    return { isValid, missingRequiredKeys: missing };
  }

  getIdChain(workspaceId: string): CanonicalIdChain | undefined {
    return this.idChains.get(workspaceId);
  }
}
