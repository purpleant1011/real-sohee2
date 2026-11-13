/**
 * Home 30-Second Command Center Service (ANI-1237)
 * 
 * Provides the 6 core Information Architecture (IA) sections for the owner's daily view:
 * 1. Today's Key Goal & Progress
 * 2. Current Sohee Active Work (in Business Language)
 * 3. Pending Decisions (5-Second Approval Card)
 * 4. Customer / Booking Real-Time Changes
 * 5. Recent Verified Outcomes (Anti-fabrication Null Safety)
 * 6. Next Best Action Recommendation
 */

import { toBusinessLanguage } from '@/lib/ux-copy/business-language-dictionary';

export type ActionItemPriority =
  | 'EMERGENCY_CUSTOMER'
  | 'PENDING_APPROVAL'
  | 'FAILURE_RECOVERY'
  | 'TODAY_MARKETING'
  | 'INFORMATIONAL';

export interface OwnerActionItem {
  id: string;
  priorityTier: ActionItemPriority;
  title: string;
  metadata?: Record<string, unknown>;
}

export interface RawOwnerCenterInput {
  workspaceId: string;
  businessName: string;
  dailyGoal: {
    targetRevenueKrw: number;
    currentRevenueKrw: number;
    progressPercent: number;
  };
  activeMission: {
    missionId: string;
    title: string;
    canonicalStatus: string;
    updatedAt: string;
  } | null;
  pendingApproval: {
    approvalId: string;
    title: string;
    actionType: string;
    deadline: string;
  } | null;
  customerChange: {
    newInquiriesCount: number;
    pendingBookingsCount: number;
    latestCustomerName?: string;
  };
  recentOutcome: {
    verifiedRevenueKrw?: number;
    verifiedBookingsCount?: number;
    evidenceClass: string;
  } | null;
  nextBestAction: {
    actionId: string;
    title: string;
    confidence: number;
  } | null;
}

export interface OwnerCommandCenterSnapshot {
  workspaceId: string;
  businessName: string;
  todayGoal: {
    targetRevenueKrw: number;
    currentRevenueKrw: number;
    progressPercent: number;
  };
  currentMission: {
    missionId: string;
    title: string;
    canonicalStatus: string;
    businessStatusText: string;
  } | null;
  pendingDecision: {
    approvalId: string;
    title: string;
    actionType: string;
    deadline: string;
  } | null;
  customerChanges: {
    newInquiriesCount: number;
    pendingBookingsCount: number;
    latestCustomerName?: string;
  };
  recentOutcome: {
    formattedRevenue: string;
    bookingsCount: number;
    evidenceClass: string;
  } | null;
  outcomeStatusText: string;
  nextBestAction: {
    actionId: string;
    title: string;
    confidence: number;
  } | null;
  generatedAt: string;
}

const PRIORITY_ORDER: Record<ActionItemPriority, number> = {
  EMERGENCY_CUSTOMER: 1,
  PENDING_APPROVAL: 2,
  FAILURE_RECOVERY: 3,
  TODAY_MARKETING: 4,
  INFORMATIONAL: 5,
};

export class HomeCommandCenterService {
  /**
   * Builds the 30-second unified command center snapshot with Same-Truth projection.
   */
  buildSnapshot(input: RawOwnerCenterInput): OwnerCommandCenterSnapshot {
    const {
      workspaceId,
      businessName,
      dailyGoal,
      activeMission,
      pendingApproval,
      customerChange,
      recentOutcome,
      nextBestAction,
    } = input;

    // 1. Current mission in human-readable business language
    let currentMission = null;
    if (activeMission) {
      currentMission = {
        missionId: activeMission.missionId,
        title: activeMission.title,
        canonicalStatus: activeMission.canonicalStatus,
        businessStatusText: toBusinessLanguage(activeMission.canonicalStatus),
      };
    }

    // 2. Recent outcome formatting with zero fabrication
    let formattedOutcome = null;
    let outcomeStatusText = '성과 확인 대기 중';

    if (recentOutcome && recentOutcome.verifiedRevenueKrw !== undefined) {
      formattedOutcome = {
        formattedRevenue: `₩${recentOutcome.verifiedRevenueKrw.toLocaleString()}`,
        bookingsCount: recentOutcome.verifiedBookingsCount || 0,
        evidenceClass: recentOutcome.evidenceClass,
      };
      outcomeStatusText = `검증된 매출 ${formattedOutcome.formattedRevenue}`;
    }

    return {
      workspaceId,
      businessName,
      todayGoal: dailyGoal,
      currentMission,
      pendingDecision: pendingApproval,
      customerChanges: customerChange,
      recentOutcome: formattedOutcome,
      outcomeStatusText,
      nextBestAction,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Sorts actionable items by strict owner operational priority:
   * Emergency Customer > Approval > Failure Recovery > Marketing > Informational
   */
  prioritizeActionItems(items: OwnerActionItem[]): OwnerActionItem[] {
    return [...items].sort((a, b) => {
      const orderA = PRIORITY_ORDER[a.priorityTier] ?? 99;
      const orderB = PRIORITY_ORDER[b.priorityTier] ?? 99;
      return orderA - orderB;
    });
  }
}
