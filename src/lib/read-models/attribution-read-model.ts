import { ValueWithProvenance } from './types';

export interface AttributionTouchpoint {
  id: string;
  customerNameMasked: string;
  channel: string;
  actionType: 'customer_message' | 'content_post' | 'review_reply' | 'local_map';
  actionTitle: string;
  timestamp: string;
  bookingId?: string;
  bookingStatus: 'confirmed' | 'completed' | 'cancelled' | 'pending';
  attributedRevenue: number;
  attributionType: 'direct' | 'assisted';
  confidence: number;
  evidenceNotes: string;
}

export interface ChannelContribution {
  channelKey: string;
  displayName: string;
  touchpointCount: number;
  directBookings: number;
  assistedBookings: number;
  attributedRevenue: number;
  sharePercentage: number;
}

export interface AttributionReadModel {
  workspaceId: string;
  isDemo: boolean;
  status: 'active' | 'data_insufficient';
  dataFreshness: string;
  confirmedRevenue: ValueWithProvenance<number>;
  estimatedRevenue: ValueWithProvenance<number>;
  totalDirectBookings: number;
  totalAssistedBookings: number;
  cancellationDeductions: number;
  touchpoints: AttributionTouchpoint[];
  channelContributions: ChannelContribution[];
}

export interface GetAttributionParams {
  workspaceId: string;
  isDemo?: boolean;
  hasLedger?: boolean;
}

export function getAttributionReadModel(params: GetAttributionParams): AttributionReadModel {
  const isDemo = params.isDemo ?? false;
  const hasLedger = params.hasLedger ?? (isDemo ? true : false);

  if (!hasLedger && !isDemo) {
    return {
      workspaceId: params.workspaceId,
      isDemo: false,
      status: 'data_insufficient',
      dataFreshness: '방금 전',
      confirmedRevenue: {
        value: 0,
        provenance: 'measured',
        sourceDescription: '결제/예약 연동 원장 부재',
      },
      estimatedRevenue: {
        value: 0,
        provenance: 'estimated',
        sourceDescription: '분석 대기 중',
      },
      totalDirectBookings: 0,
      totalAssistedBookings: 0,
      cancellationDeductions: 0,
      touchpoints: [],
      channelContributions: [],
    };
  }

  const touchpoints: AttributionTouchpoint[] = [
    {
      id: 'tp-101',
      customerNameMasked: '이*서 님',
      channel: 'KakaoTalk Channel',
      actionType: 'customer_message',
      actionTitle: '목요일 빈 슬롯 안내 제안',
      timestamp: '2026-08-29 14:22',
      bookingId: 'bk-20260829-01',
      bookingStatus: 'completed',
      attributedRevenue: 85000,
      attributionType: 'direct',
      confidence: 0.98,
      evidenceNotes: '카카오톡 슬롯 링크 클릭 후 12분 내 네이버 예약 완료',
    },
    {
      id: 'tp-102',
      customerNameMasked: '정*진 님',
      channel: 'Instagram',
      actionType: 'content_post',
      actionTitle: '스킨플래닝 3컷 비포애프터 카드뉴스',
      timestamp: '2026-08-28 11:15',
      bookingId: 'bk-20260828-04',
      bookingStatus: 'confirmed',
      attributedRevenue: 120000,
      attributionType: 'direct',
      confidence: 0.92,
      evidenceNotes: '인스타그램 프로필 링크(utm_source=instagram_post)를 통한 예약 유입',
    },
    {
      id: 'tp-103',
      customerNameMasked: '최*민 님',
      channel: 'Naver Place',
      actionType: 'review_reply',
      actionTitle: '네이버 플레이스 포토리뷰 진정성 답글',
      timestamp: '2026-08-27 18:30',
      bookingId: 'bk-20260828-02',
      bookingStatus: 'completed',
      attributedRevenue: 95000,
      attributionType: 'assisted',
      confidence: 0.85,
      evidenceNotes: '플레이스 검색 유입 후 리뷰 확인 뒤 네이버 예약 전환',
    },
  ];

  const channelContributions: ChannelContribution[] = [
    {
      channelKey: 'kakaotalk',
      displayName: '카카오톡 채널',
      touchpointCount: 14,
      directBookings: 3,
      assistedBookings: 1,
      attributedRevenue: 340000,
      sharePercentage: 42,
    },
    {
      channelKey: 'instagram',
      displayName: 'Instagram',
      touchpointCount: 22,
      directBookings: 2,
      assistedBookings: 3,
      attributedRevenue: 280000,
      sharePercentage: 35,
    },
    {
      channelKey: 'naver_place',
      displayName: '네이버 플레이스',
      touchpointCount: 38,
      directBookings: 1,
      assistedBookings: 4,
      attributedRevenue: 185000,
      sharePercentage: 23,
    },
  ];

  return {
    workspaceId: params.workspaceId,
    isDemo,
    status: 'active',
    dataFreshness: '20분 전 원장 집계',
    confirmedRevenue: {
      value: 805000,
      provenance: isDemo ? 'demo' : 'measured',
      sourceDescription: isDemo ? '데모 예약 확정 결제 데이터' : '네이버 예약/포스 확정 매출 원장',
    },
    estimatedRevenue: {
      value: 350000,
      provenance: 'estimated',
      sourceDescription: '현재 진행 중인 미션 기대 가치',
    },
    totalDirectBookings: 6,
    totalAssistedBookings: 8,
    cancellationDeductions: 0,
    touchpoints,
    channelContributions,
  };
}
