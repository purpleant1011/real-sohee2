import { DataProvenance, ValueWithProvenance, RiskTier } from './types';

export interface OpportunityEvidence {
  id: string;
  source: string;
  provenance: DataProvenance;
  label: string;
  snippet: string;
  observedAt: string;
}

export interface OpportunityItem {
  id: string;
  title: string;
  type: 'empty_slot' | 'inquiry' | 'review' | 'content' | 'local' | 'channel_issue';
  urgency: 'high' | 'medium' | 'low';
  score: number;
  whyNow: string;
  evidence: OpportunityEvidence[];
  expectedImpact: ValueWithProvenance<string>;
  expectedCost: string;
  confidence: number;
  riskTier: RiskTier;
  linkedGoalId?: string;
  expiresAt: string;
  status: 'active' | 'ignored' | 'expired' | 'converted';
  ignoreReason?: string;
  alternatives: Array<{
    id: string;
    title: string;
    description: string;
    expectedOutcome: string;
  }>;
}

export interface OpportunityListReadModel {
  workspaceId: string;
  totalCount: number;
  filter: string;
  sortBy: string;
  items: OpportunityItem[];
  insufficientSampleWarning?: string;
  /** 예시 데이터로 채워졌을 때만 채운다. 실사용 화면은 이 값을 비운다. */
  demoNotice?: string;
  /** 필터 탭 카운트. 실제 반환된 항목에서만 센다. */
  counts: Record<'all' | OpportunityItem['type'], number>;
}

export interface GetOpportunitiesParams {
  workspaceId: string;
  isDemo?: boolean;
  filter?: string;
  sortBy?: string;
}

const EMPTY_COUNTS: Record<'all' | OpportunityItem['type'], number> = {
  all: 0, empty_slot: 0, inquiry: 0, review: 0, content: 0, local: 0, channel_issue: 0,
};

/** 실측 데이터가 없을 때 사장님께 보여줄 정직한 문구. 0건이나 낙관값으로 대체하지 않는다. */
export const NO_MEASURED_OPPORTUNITIES = '아직 측정된 기회가 없어요.'

export function getOpportunitiesReadModel(params: GetOpportunitiesParams): OpportunityListReadModel {
  const isDemo = params.isDemo ?? false;
  const filter = params.filter || 'all';
  const sortBy = params.sortBy || 'impact';

  const demoItems: OpportunityItem[] = [
    {
      id: 'opp-001',
      title: '목요일 오후 잔여 슬롯 긴급 리커버리',
      type: 'empty_slot',
      urgency: 'high',
      score: 92,
      whyNow: '목요일 14:00, 16:30 2개 슬롯이 비어있으며 최근 7일 내 해당 시간대를 문의했던 리드 3명이 재접촉 가능 상태입니다.',
      evidence: [
        {
          id: 'ev-1',
          source: '예시 · 네이버 예약 캘린더',
          provenance: 'demo',
          label: '예약 현황 (예시)',
          snippet: '9월 3일 목요일 14:00, 16:30 잔여 2슬롯 미배정',
          observedAt: '15분 전',
        },
        {
          id: 'ev-2',
          source: '예시 · 카카오톡 채널 대화로그',
          provenance: 'demo',
          label: '미예약 문의 고객',
          snippet: '고객 3명(김*아, 이*진, 박*영)이 목요일 시술 문의 후 일정 미확정',
          observedAt: '2시간 전',
        },
      ],
      expectedImpact: {
        value: '예약 1~2건 회복 (매출 350,000 ~ 700,000원)',
        provenance: 'demo',
        sourceDescription: '과거 유사 안부 제안 전환율 35% 기준',
        confidence: 0.88,
      },
      expectedCost: '카카오톡 알림톡 비용 약 45원',
      confidence: 0.88,
      riskTier: 'low',
      linkedGoalId: 'goal-001',
      expiresAt: '2026-09-03T18:00:00Z',
      status: 'active',
      alternatives: [
        {
          id: 'alt-1',
          title: '카카오톡 1:1 맞춤 안부 제안 (추천)',
          description: '문의 이력이 있는 3명에게 개인화된 슬롯 안내 발송',
          expectedOutcome: '전환 확률 88%, 리스크 매우 낮음',
        },
        {
          id: 'alt-2',
          title: '인스타그램 스토리 긴급 당일/익일 타임세일',
          description: '팔로워 대상 10% 타임할인 스토리 게재',
          expectedOutcome: '전환 확률 50%, 브랜드 할인 이미지 노출 우려',
        },
      ],
    },
    {
      id: 'opp-002',
      title: '네이버 플레이스 5점 포토리뷰 답글 및 키워드 최적화',
      type: 'review',
      urgency: 'medium',
      score: 84,
      whyNow: '어제 등록된 5점 포토리뷰(청라 속눈썹펌)에 24시간 내 답글을 작성하면 지역 탐색 랭킹이 상승합니다.',
      evidence: [
        {
          id: 'ev-3',
          source: '예시 · 네이버 스마트플레이스',
          provenance: 'demo',
          label: '새 리뷰 알림',
          snippet: '“원장님 손이 너무 빠르고 자연스러워요!” 5점 포토리뷰 1건 등록',
          observedAt: '어제 19:40',
        },
      ],
      expectedImpact: {
        value: '플레이스 검색 노출 12% 향상 및 신뢰도 증대',
        provenance: 'demo',
        sourceDescription: '네이버 플레이스 24시간 내 리뷰 답글 알고리즘 가중치',
        confidence: 0.95,
      },
      expectedCost: '0원 (순수 오가닉)',
      confidence: 0.95,
      riskTier: 'low',
      expiresAt: '2026-09-01T12:00:00Z',
      status: 'active',
      alternatives: [
        {
          id: 'alt-review-1',
          title: '브랜드 메모리 페르소나 반영 감사 답글 작성',
          description: '시술 특징과 원장님의 따뜻한 톤을 담아 답글 게시',
          expectedOutcome: '고객 재방문 유도 및 신규 검색자 신뢰 획득',
        },
      ],
    },
    {
      id: 'opp-003',
      title: '가을 신규 케어 인스타그램 릴스/카드뉴스 콘텐츠 발행',
      type: 'content',
      urgency: 'low',
      score: 76,
      whyNow: '환절기 보습 케어 검색량이 전주 대비 32% 상승하여 선제적 시술 소개가 필요한 시점입니다.',
      evidence: [
        {
          id: 'ev-4',
          source: '예시 · 네이버 데이터랩 & 인스타그램 트렌드',
          provenance: 'demo',
          label: '키워드 검색 트렌드',
          snippet: '청라 환절기 스킨플래닝/보습 케어 검색량 +32%',
          observedAt: '오늘 09:00',
        },
      ],
      expectedImpact: {
        value: '신규 문의 3~5건 유입 기대',
        provenance: 'demo',
        sourceDescription: '지난 시즌 동기 콘텐츠 반응 분석',
        confidence: 0.75,
      },
      expectedCost: '0원',
      confidence: 0.75,
      riskTier: 'low',
      expiresAt: '2026-09-05T23:59:59Z',
      status: 'active',
      alternatives: [
        {
          id: 'alt-content-1',
          title: '인스타그램 3컷 비포애프터 카드뉴스',
          description: '기존 보유 시술 사진 3장을 활용한 큐레이션 포스팅',
          expectedOutcome: '즉시 승인 및 예약 링크 포함 발행 가능',
        },
      ],
    },
  ];

  // 실측 기회 조회가 붙기 전까지 실사용 화면은 빈 목록이다.
  // 예시 데이터를 실측처럼 내보내지 않는다 (가짜 값 금지).
  if (!isDemo) {
    return {
      workspaceId: params.workspaceId,
      totalCount: 0,
      filter,
      sortBy,
      items: [],
      insufficientSampleWarning: NO_MEASURED_OPPORTUNITIES,
      counts: { ...EMPTY_COUNTS },
    };
  }

  let filtered = demoItems;
  if (filter !== 'all') {
    filtered = filtered.filter(item => item.type === filter);
  }

  if (sortBy === 'urgency') {
    const urgencyWeight = { high: 3, medium: 2, low: 1 };
    filtered.sort((a, b) => urgencyWeight[b.urgency] - urgencyWeight[a.urgency]);
  } else if (sortBy === 'confidence') {
    filtered.sort((a, b) => b.confidence - a.confidence);
  } else {
    filtered.sort((a, b) => b.score - a.score);
  }

  const counts: Record<'all' | OpportunityItem['type'], number> = {
    ...EMPTY_COUNTS,
    all: demoItems.length,
  };
  for (const item of demoItems) counts[item.type] += 1;

  return {
    workspaceId: params.workspaceId,
    totalCount: filtered.length,
    filter,
    sortBy,
    items: filtered,
    demoNotice: '아래는 화면 확인용 예시예요. 사장님 매장에서 측정된 값이 아니에요.',
    counts,
  };
}
