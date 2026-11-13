export interface WorkbenchSummary {
  workspaceId: string;
  generatedAt: string;
  weeklyCreditsRemaining: number;
  weeklyAllowance: number;
  todayStats: {
    inquiries: number;
    bookings: number;
    creditsBurned: number;
  };
  pendingApprovalsCount: number;
  opportunityCount: number;
  proofTimelineCount: number;
}

export class ChiefOfStaffWorkbenchEngine {
  /**
   * Aggregates live workspace state into a cohesive Chief-of-Staff briefing (ANI-792)
   */
  compileWorkbenchBriefing(params: {
    workspaceId: string;
    weeklyAllowance: number;
    weeklyRemaining: number;
    todayStats: { inquiries: number; bookings: number; creditsBurned: number };
    pendingApprovalsCount: number;
    opportunityCount: number;
    proofTimelineCount: number;
  }): WorkbenchSummary {
    return {
      workspaceId: params.workspaceId,
      generatedAt: new Date().toISOString(),
      weeklyCreditsRemaining: params.weeklyRemaining,
      weeklyAllowance: params.weeklyAllowance,
      todayStats: params.todayStats,
      pendingApprovalsCount: params.pendingApprovalsCount,
      opportunityCount: params.opportunityCount,
      proofTimelineCount: params.proofTimelineCount,
    };
  }
}
