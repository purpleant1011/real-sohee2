import { ChannelKey } from "../types";

export interface MarketingLoopDefinition {
  id: string;
  name: string;
  cadence: "realtime" | "daily" | "weekly";
  purpose: string;
  triggerCondition: string;
  cooldownHours: number;
  channels: ChannelKey[];
  stopCondition: string;
}

export const SEVEN_MARKETING_LOOPS: MarketingLoopDefinition[] = [
  {
    id: "loop-empty-slot",
    name: "1. 예약 빈자리 채우기 루프",
    cadence: "daily",
    purpose: "비어있는 당일/주간 예약 슬롯을 감지하고 미예약 관심 고객에게 최우선 제안",
    triggerCondition: "당일 또는 특정 요일 빈 슬롯 >= 1개 발생",
    cooldownHours: 24,
    channels: ["kakaotalk_channel", "instagram"],
    stopCondition: "슬롯 예약 완료 또는 고객 거절 시 중단",
  },
  {
    id: "loop-inquiry-conversion",
    name: "2. 문의 전환 루프",
    cadence: "realtime",
    purpose: "신규 문의 발생 시 5분 내 맞춤 답변 초안 및 예약 링크 제안",
    triggerCondition: "신규 DM/채널톡 문의 인입",
    cooldownHours: 0,
    channels: ["kakaotalk_channel", "instagram", "daangn"],
    stopCondition: "예약 완료 또는 대화 종료 시",
  },
  {
    id: "loop-reviews-reputation",
    name: "3. 리뷰·평판 관리 루프",
    cadence: "daily",
    purpose: "네이버 플레이스/구글 리뷰 발생 시 24시간 내 감사 답글 및 만족도 관리",
    triggerCondition: "신규 리뷰 등록 시",
    cooldownHours: 12,
    channels: ["naver_place", "google_business"],
    stopCondition: "답글 등록 완료 시",
  },
  {
    id: "loop-content-performance",
    name: "4. 콘텐츠 성과 루프",
    cadence: "daily",
    purpose: "발행된 피드/릴스 반응을 추적하여 고성과 소재를 블로그/스레드로 2차 확산",
    triggerCondition: "평균 반응률 대비 +50% 이상 인기 콘텐츠 감지",
    cooldownHours: 48,
    channels: ["instagram", "threads", "naver_blog"],
    stopCondition: "2차 콘텐츠 변환 완료 시",
  },
  {
    id: "loop-local-seo-health",
    name: "5. 지역 노출 건강검진 루프",
    cadence: "weekly",
    purpose: "청라 지역 플레이스 키워드 순위 및 채널 연결 권한 점검",
    triggerCondition: "매주 월요일 정기 실행",
    cooldownHours: 168,
    channels: ["naver_place", "google_business", "daangn"],
    stopCondition: "진단 리포트 생성 완료 시",
  },
  {
    id: "loop-customer-reactivation",
    name: "6. 기존고객 재활성화 루프",
    cadence: "weekly",
    purpose: "시술 후 6개월 경과 고객 대상 리터치/안부 메시지 준비",
    triggerCondition: "리터치 주기 도래 고객군 존재 시",
    cooldownHours: 168,
    channels: ["kakaotalk_channel"],
    stopCondition: "주간 발송 한도 도달 또는 미동의 시",
  },
  {
    id: "loop-weekly-strategy",
    name: "7. 주간 마케팅 전략 루프",
    cadence: "weekly",
    purpose: "한 주간의 기여도와 학습된 메모리를 바탕으로 다음 주 핵심 목표 및 미션 수립",
    triggerCondition: "매주 일요일 저녁 20:00",
    cooldownHours: 168,
    channels: ["instagram", "threads", "naver_blog", "naver_place", "kakaotalk_channel", "google_business", "daangn"],
    stopCondition: "주간 브리핑 승인 시",
  },
];
