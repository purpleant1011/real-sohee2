/**
 * Chief-of-Staff Home & Lifecycle Empty States
 * 
 * ANI-858: Chief-of-Staff Home (Today/Attention·Opportunities·Approvals·Proof·Outcomes·Credits·Health)
 * ANI-859: Lifecycle-aware Empty States
 */

export interface ChiefOfStaffHomeState {
  workspaceId: string;
  attentionItems: Array<{ id: string; title: string; severity: 'HIGH' | 'MEDIUM'; actionUrl: string }>;
  opportunities: Array<{ id: string; title: string; potentialGain: string; actionUrl: string }>;
  pendingApprovalsCount: number;
  recentProofCardsCount: number;
  weeklyOutcomeRevenueKrw: number;
  availableCredits: number;
  systemHealthScore: number;
}

export interface EmptyStateGuidance {
  domain: 'CONTENT' | 'CHANNELS' | 'CRM' | 'REPORTS' | 'ADS';
  headline: string;
  subtext: string;
  primaryCtaLabel: string;
  primaryCtaUrl: string;
}

export class ChiefOfStaffHomeService {
  /**
   * ANI-858: 사장님을 위한 7대 통합 관제 홈 상태 빌드
   */
  buildHomeState(params: {
    workspaceId: string;
    attentionItems?: ChiefOfStaffHomeState['attentionItems'];
    opportunities?: ChiefOfStaffHomeState['opportunities'];
    pendingApprovalsCount?: number;
    recentProofCardsCount?: number;
    weeklyOutcomeRevenueKrw?: number;
    availableCredits?: number;
    systemHealthScore?: number;
  }): ChiefOfStaffHomeState {
    const {
      workspaceId,
      attentionItems = [],
      opportunities = [],
      pendingApprovalsCount = 0,
      recentProofCardsCount = 0,
      weeklyOutcomeRevenueKrw = 0,
      availableCredits = 1500,
      systemHealthScore = 98,
    } = params;

    return {
      workspaceId,
      attentionItems,
      opportunities,
      pendingApprovalsCount,
      recentProofCardsCount,
      weeklyOutcomeRevenueKrw,
      availableCredits,
      systemHealthScore,
    };
  }

  /**
   * ANI-859: 라이프사이클 인지형 빈 화면 가이드 (원인별 단일 Next Action)
   */
  resolveEmptyState(params: {
    domain: EmptyStateGuidance['domain'];
    hasConnectedChannels: boolean;
    hasTaughtKnowledge: boolean;
    hasCredits: boolean;
  }): EmptyStateGuidance {
    const { domain, hasConnectedChannels, hasTaughtKnowledge, hasCredits } = params;

    if (!hasTaughtKnowledge) {
      return {
        domain,
        headline: '소희에게 사장님의 매장 비법을 먼저 알려주세요',
        subtext: '서비스 노하우, 대표 상품/메뉴, 가격 정책을 등록하면 소희가 우리 매장 맞춤으로 일합니다.',
        primaryCtaLabel: '비법 교육하러 가기',
        primaryCtaUrl: '/app/settings/brand',
      };
    }

    if (!hasConnectedChannels) {
      return {
        domain,
        headline: '발행할 SNS 채널을 연결해주세요',
        subtext: '인스타그램이나 네이버 블로그를 연동하면 콘텐츠를 즉시 게시할 수 있습니다.',
        primaryCtaLabel: '채널 연동하기',
        primaryCtaUrl: '/app/channels',
      };
    }

    if (!hasCredits) {
      return {
        domain,
        headline: '사용 가능한 소희 크레딧이 소진되었습니다',
        subtext: '크레딧을 충전하여 24시간 자율 마케팅 루틴을 계속 가동하세요.',
        primaryCtaLabel: '소희 크레딧 충전하기',
        primaryCtaUrl: '/app/account/credits',
      };
    }

    return {
      domain,
      headline: '아직 등록된 작업 내역이 없습니다',
      subtext: '소희와 대화하거나 첫 번째 마케팅 캠페인을 시작해보세요.',
      primaryCtaLabel: '첫 마케팅 시작하기',
      primaryCtaUrl: '/app/command',
    };
  }
}
