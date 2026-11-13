import type { MarketingMemoryItem } from "../../types";

export const INITIAL_MEMORIES_SEED: MarketingMemoryItem[] = [
  {
    id: "mem-1",
    workspaceId: "ws-seed-default",
    category: "winning_hook",
    title: "민낯 자신감 & 자연스러운 결",
    content: "바이름 고객은 과도하게 진한 시술보다 본래 눈썹 결을 살린 자연스러운 스타일을 가장 선호함.",
    confidence: "verified_fact",
    sourceContext: "최근 3개월 인스타그램 피드 반응률 상위 10% 콘텐츠 공통 키워드 분석",
    positiveImpactCount: 18,
    negativeFeedbackCount: 0,
    createdAt: "2026-08-01T00:00:00Z",
    lastReinforcedAt: "2026-08-01T00:00:00Z",
    decayScore: 0.98,
    isUserEditable: true,
  },
  {
    id: "mem-2",
    workspaceId: "ws-seed-default",
    category: "high_conversion_timing",
    title: "목/금 퇴근 전 16:00 ~ 18:00 문의",
    content: "주말 전 직장인 고객의 당일/익일 문의가 가장 집중되며, 빠른 10분 내 답변 시 예약 전환율이 60% 이상으로 급상승함.",
    confidence: "verified_fact",
    sourceContext: "카카오톡 채널 문의 인입 시간대 및 예약 전환 상관관계 분석",
    positiveImpactCount: 12,
    negativeFeedbackCount: 1,
    createdAt: "2026-08-10T00:00:00Z",
    lastReinforcedAt: "2026-08-01T00:00:00Z",
    decayScore: 0.94,
    isUserEditable: true,
  },
  {
    id: "mem-3",
    workspaceId: "ws-seed-default",
    category: "owner_preference",
    title: "정중하고 편안한 존댓말 톤앤매너",
    content: "사장님은 지나치게 자극적인 광고 문구(예: 무료, 파격할인)를 지양하고 차분하고 전문성 있는 화법을 요구함.",
    confidence: "verified_fact",
    sourceContext: "사장님 대화 및 피드백 수정 이력 반영",
    positiveImpactCount: 24,
    negativeFeedbackCount: 0,
    createdAt: "2026-07-20T00:00:00Z",
    lastReinforcedAt: "2026-08-01T00:00:00Z",
    decayScore: 1.0,
    isUserEditable: true,
  },
];

export const INITIAL_BYREUM_MEMORIES: MarketingMemoryItem[] = INITIAL_MEMORIES_SEED;

