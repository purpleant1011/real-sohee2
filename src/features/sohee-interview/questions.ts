import type { InterviewQuestion } from './types'

export const INTERVIEW_QUESTIONS: readonly InterviewQuestion[] = [
  {
    id: 'q_menu',
    category: 'MENU',
    key: 'menu',
    prompt: '우리 가게에서 가장 인기 있거나 대표적인 메뉴/서비스는 무엇인가요?',
    chips: ['시그니처 시술/메뉴', '맞춤 케어/세트', '인기 추천'],
    placeholder: '예: 1:1 맞춤 속눈썹 펌, 시그니처 바닐라 라떼, 수제 구움과자',
  },
  {
    id: 'q_price',
    category: 'PRICE',
    key: 'price',
    prompt: '주력 메뉴나 서비스의 가격대는 대략 어떻게 되나요?',
    chips: ['3만원 이하', '3~7만원대', '10만원 이상 프리미엄'],
    placeholder: '예: 기본 시술 35,000원, 시그니처 세트 18,000원선',
  },
  {
    id: 'q_hours',
    category: 'HOURS',
    key: 'hours',
    prompt: '영업시간과 정기 휴무일은 어떻게 되나요?',
    chips: ['연중무휴', '매주 월요일 휴무', '주말 예약제'],
    placeholder: '예: 매일 10:00 - 21:00 (매주 화요일 정기휴무)',
  },
  {
    id: 'q_differentiator',
    category: 'DIFFERENTIATOR',
    key: 'differentiator',
    prompt: '주변 다른 가게와 비교했을 때 우리 매장만의 특별한 점이 있다면요?',
    chips: ['직접 제작/로스팅', '1:1 맞춤 서비스', '유기농/친환경 재료'],
    placeholder: '예: 매일 아침 직접 구워 당일 생산 당일 소진 원칙',
  },
  {
    id: 'q_faq_booking',
    category: 'FAQ',
    key: 'faq_booking',
    prompt: '손님들이 오시기 전에 가장 자주 묻는 예약/방문 관련 질문 1가지를 알려주세요?',
    chips: ['당일 예약 가능 여부', '웨이팅 방법', '단체석 예약'],
    placeholder: '예: 주말 단체석은 네이버 예약으로 최소 1일 전 예약 필수',
  },
  {
    id: 'q_faq_parking',
    category: 'FAQ',
    key: 'faq_parking',
    prompt: '주차 공간이나 찾아오시는 길에 대해 손님들이 자주 묻나요?',
    chips: ['건물 무료 주차', '공영주차장 지원', '대중교통 안내'],
    placeholder: '예: 매장 앞 2대 주차 가능, 만차 시 인근 공영주차장 1시간 지원',
  },
  {
    id: 'q_faq_tip',
    category: 'FAQ',
    key: 'faq_tip',
    prompt: '결제 혜택이나 매장 이용할 때 알아두면 좋은 꿀팁이 있나요?',
    chips: ['지역화폐/포인트', '첫 방문 할인', '리뷰 이벤트'],
    placeholder: '예: 영수증 리뷰 작성 시 아메리카노 1잔 무료 쿠폰 증정',
  },
  {
    id: 'q_prohibited',
    category: 'PROHIBITED',
    key: 'prohibited',
    prompt: '마케팅 글이나 고객 응대할 때 절대 쓰지 말아야 할 단어나 주의사항이 있나요?',
    chips: ['과대 광고 표현', '최저가/무조건 보장', '타사 비교'],
    placeholder: '예: 최고, 최저가, 무조건 등 과장된 수식어 지양',
  },
] as const

/**
 * 이미 답변한 질문 ID를 제외하고 순서대로 다음 질문을 반환한다.
 * 모든 질문에 답변했으면 null을 반환한다.
 */
export function getNextInterviewQuestion(
  answeredQuestionIds: readonly string[],
): InterviewQuestion | null {
  const answeredSet = new Set(answeredQuestionIds)
  return INTERVIEW_QUESTIONS.find((q) => !answeredSet.has(q.id)) ?? null
}

/**
 * 사장님의 인터뷰 답변을 정중하고 자연스러운 한국어 요약문으로 변환한다.
 */
export function summarizeAnswer(
  question: InterviewQuestion,
  rawAnswer: string,
): string {
  const trimmed = rawAnswer.trim()
  switch (question.id) {
    case 'q_menu':
      return `대표 메뉴는 [${trimmed}]입니다.`
    case 'q_price':
      return `가격대는 [${trimmed}]입니다.`
    case 'q_hours':
      return `영업시간 및 휴무일은 [${trimmed}]입니다.`
    case 'q_differentiator':
      return `매장만의 특별한 점은 [${trimmed}]입니다.`
    case 'q_faq_booking':
      return `방문/예약 안내: [${trimmed}]`
    case 'q_faq_parking':
      return `주차 및 오시는 길 안내: [${trimmed}]`
    case 'q_faq_tip':
      return `매장 이용 팁 및 혜택: [${trimmed}]`
    case 'q_prohibited':
      return `마케팅 주의사항 및 금지표현: [${trimmed}]`
    default:
      return `[${question.category}] ${trimmed}`
  }
}
