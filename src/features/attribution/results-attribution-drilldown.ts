import { AttributionDrilldownPath, MarketingSourceEvent } from './types';

export interface CreateAttributionPathParams {
  workspaceId: string;
  sourceEvent: MarketingSourceEvent;
  lead: {
    customerId: string;
    channel: string;
    acquiredAt: string;
  };
  booking: {
    bookingId: string;
    serviceName: string;
    slotStartTime: string;
    status: string;
  };
  revenue: {
    revenueKrw: number;
    settledAt: string;
  };
}

export class ResultsAttributionDrilldownService {
  private paths: Map<string, AttributionDrilldownPath> = new Map();
  private workspacePaths: Map<string, string[]> = new Map();

  /**
   * 단일 매출 건에 대한 엔드투엔드 성과 계보 생성 (ANI-854)
   * Source Event -> Lead -> Booking -> Revenue -> Next Best Action
   */
  createDrilldownPath(params: CreateAttributionPathParams): AttributionDrilldownPath {
    const { workspaceId, sourceEvent, lead, booking, revenue } = params;

    const attributionId = `attr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Next Best Action 도출 (예: 인스타그램 피드로 예약 성공 시, 리뷰 유도 또는 유사 시간대 추가 게시 추천)
    const nextBestAction = {
      actionType: 'SIMILAR_CONTENT_SCALE_UP',
      recommendedTarget: `${sourceEvent.channel} 유사 스타일 콘텐츠 추가 발행`,
      reasoning: `${sourceEvent.headline} 게시물이 리드 획득 및 ₩${revenue.revenueKrw.toLocaleString()} 매출로 직접 전환되었습니다.`,
      expectedImpact: '동일 시간대 발행 시 주간 예약 15~20% 추가 유입 예상',
    };

    const path: AttributionDrilldownPath = {
      attributionId,
      sourceEvent,
      lead,
      booking,
      revenue,
      nextBestAction,
    };

    this.paths.set(attributionId, path);

    const list = this.workspacePaths.get(workspaceId) || [];
    list.push(attributionId);
    this.workspacePaths.set(workspaceId, list);

    return path;
  }

  getDrilldown(attributionId: string): AttributionDrilldownPath | undefined {
    return this.paths.get(attributionId);
  }

  listByWorkspace(workspaceId: string): AttributionDrilldownPath[] {
    const ids = this.workspacePaths.get(workspaceId) || [];
    return ids.map((id) => this.paths.get(id)!).filter(Boolean);
  }
}
