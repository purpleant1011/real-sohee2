export type MarketingAsset = Readonly<{
  src: string
  width: number
  height: number
  alt: string
  priority: boolean
}>

/**
 * [ANI-1741] 표시용 자산은 WebP 변형을 가리킨다.
 *
 * next.config.ts 의 `images.unoptimized: true` 때문에 next/image 가 포맷 변환을 하지 않아,
 * PNG 원본(1.7~2.5MB)이 모바일에도 그대로 내려갔다. 같은 그림의 WebP(q82)는 81~97% 작다.
 * PNG 원본은 public/images/marketing/v085/ 에 그대로 남아 있고, OG(소셜 미리보기)는 PNG 를 쓴다.
 * 변형 재생성: `node scripts/perf/generate-marketing-webp.mjs --force`
 */
export const MARKETING_ASSETS = Object.freeze({
  characterSheet: { src: '/images/marketing/v085/sohee-character-sheet-v1.webp', width: 1254, height: 1254, alt: '키 163cm의 현실적인 비율로 정리한 소희 캐릭터의 얼굴, 전신, 표정과 의상 기준', priority: false },
  soheeNeutral: { src: '/images/marketing/v085/sohee-fullbody-neutral-v1.webp', width: 887, height: 1774, alt: '키 163cm의 현실적인 비율로 차분하게 서 있는 소희', priority: false },
  soheeGuide: { src: '/images/marketing/v085/sohee-fullbody-guide-v1.webp', width: 926, height: 1698, alt: '키 163cm의 현실적인 비율로 마케팅 흐름을 안내하는 소희', priority: false },
  soheeApproval: { src: '/images/marketing/v085/sohee-fullbody-approval-v1.webp', width: 887, height: 1774, alt: '키 163cm의 현실적인 비율로 실행 전 승인 내용을 확인하는 소희', priority: false },
  hero: { src: '/images/marketing/v085/hero-unified-operations-v1.webp', width: 1536, height: 1024, alt: '여러 채널의 고객 신호를 하나의 운영실에서 정리하는 소희', priority: true },
  fragmentedDay: { src: '/images/marketing/v085/owner-fragmented-day-v1.webp', width: 1536, height: 1024, alt: '여러 채널과 메모 사이에서 마케팅 업무를 놓치는 매장 운영자', priority: false },
  organizedDay: { src: '/images/marketing/v085/owner-organized-day-v1.webp', width: 1536, height: 1024, alt: '소희와 함께 오늘의 마케팅 우선순위를 확인하는 매장 운영자', priority: false },
  customerSignal: { src: '/images/marketing/v085/story-customer-signal-v1.webp', width: 1536, height: 1024, alt: '예약 가능 시간을 묻는 고객 문의를 발견한 소희', priority: false },
  replyBooking: { src: '/images/marketing/v085/story-reply-booking-v1.webp', width: 1536, height: 1024, alt: '고객 답변을 상담과 예약 제안으로 이어가는 소희와 사장님', priority: false },
  questionToContent: { src: '/images/marketing/v085/story-question-to-content-v1.webp', width: 1536, height: 1024, alt: '반복되는 고객 질문을 다음 콘텐츠 소재로 만드는 소희', priority: false },
  growthBriefing: { src: '/images/marketing/v085/story-growth-briefing-v1.webp', width: 1536, height: 1024, alt: '문의, 예약과 재방문 결과를 다음 실험으로 정리하는 소희', priority: false },
  beauty: { src: '/images/marketing/v085/industry-beauty-v1.webp', width: 1536, height: 1024, alt: '미용실 상담과 빈 예약 시간을 함께 정리하는 소희', priority: false },
  food: { src: '/images/marketing/v085/industry-food-v1.webp', width: 1536, height: 1024, alt: '식당의 메뉴 문의와 리뷰를 방문으로 연결하는 소희', priority: false },
  education: { src: '/images/marketing/v085/industry-education-v1.webp', width: 1536, height: 1024, alt: '교육 과정 문의를 체험 상담과 등록으로 연결하는 소희', priority: false },
  localService: { src: '/images/marketing/v085/industry-local-service-v1.webp', width: 1536, height: 1024, alt: '지역 생활 서비스 문의를 견적과 예약으로 연결하는 소희', priority: false },
  delegationReceipt: { src: '/images/marketing/v085/delegation-receipt-v1.webp', width: 1536, height: 1024, alt: '정확한 대상과 버전, 외부 실행 결과를 확인하는 소희', priority: false },
  finalPlan: { src: '/images/marketing/v085/final-weekly-plan-v1.webp', width: 1536, height: 1024, alt: '이번 주 마케팅 계획을 함께 완성한 소희와 사장님', priority: false },
  // OG 미리보기는 소셜 크롤러 호환을 위해 PNG 를 유지한다.
  openGraph: { src: '/images/marketing/v085/sohee-marketing-og-v1.png', width: 1731, height: 909, alt: '여러 마케팅 채널을 한곳에서 고객 대화, 예약과 성장으로 연결하는 흐름', priority: false },
} satisfies Record<string, MarketingAsset>)
