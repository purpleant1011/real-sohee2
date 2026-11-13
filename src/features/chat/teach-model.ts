import { INTERVIEW_QUESTIONS } from '@/features/sohee-interview/questions'

export interface TeachTopic {
  id: string
  label: string
  question: string
}

function findInterviewPrompt(id: string, fallback: string): string {
  const found = INTERVIEW_QUESTIONS.find((q) => q.id === id)
  return found?.prompt ?? fallback
}

/**
 * 소희 가르치기(지식 인터뷰) 7대 주제.
 * 기존 interview 질문 ID를 최대한 재사용하여 지식 인터뷰와 일관성을 유지한다.
 */
export const TEACH_TOPICS: readonly TeachTopic[] = [
  {
    id: 'q_intro',
    label: '가게 소개',
    question: '우리 매장은 어떤 곳인지, 어떤 손님들이 주로 찾아오시는지 편하게 소개해 주시겠어요?',
  },
  {
    id: 'q_menu',
    label: '대표 메뉴/서비스',
    question: findInterviewPrompt(
      'q_menu',
      '우리 가게에서 가장 인기 있거나 대표적인 메뉴/서비스는 무엇인가요?',
    ),
  },
  {
    id: 'q_price',
    label: '가격',
    question: findInterviewPrompt(
      'q_price',
      '주력 메뉴나 서비스의 가격대는 대략 어떻게 되나요?',
    ),
  },
  {
    id: 'q_hours',
    label: '영업시간·위치',
    question: findInterviewPrompt(
      'q_hours',
      '영업시간과 정기 휴무일, 매장 위치(찾아오시는 길)는 어떻게 되나요?',
    ),
  },
  {
    id: 'q_differentiator',
    label: '차별점',
    question: findInterviewPrompt(
      'q_differentiator',
      '주변 다른 가게와 비교했을 때 우리 매장만의 특별한 점이 있다면요?',
    ),
  },
  {
    id: 'q_faq_booking',
    label: '자주 받는 질문',
    question: findInterviewPrompt(
      'q_faq_booking',
      '손님들이 오시기 전에 가장 자주 묻는 예약/방문이나 편의시설 관련 질문이 있나요?',
    ),
  },
  {
    id: 'q_prohibited',
    label: '말투·금지어',
    question: findInterviewPrompt(
      'q_prohibited',
      '마케팅 글이나 고객 응대할 때 절대 쓰지 말아야 할 단어나 주의사항이 있나요?',
    ),
  },
] as const

const TOPIC_ALIASES: Record<string, readonly string[]> = {
  q_intro: ['q_intro', 'intro', 'businessType', 'q_business'],
  q_menu: ['q_menu', 'menu', 'primaryServices'],
  q_price: ['q_price', 'price', 'pricing'],
  q_hours: ['q_hours', 'hours', 'operatingHours', 'location'],
  q_differentiator: ['q_differentiator', 'differentiator'],
  q_faq_booking: ['q_faq_booking', 'q_faq', 'faq', 'faq_booking', 'q_faq_parking', 'q_faq_tip'],
  q_prohibited: ['q_prohibited', 'prohibited', 'cautions'],
}

function normalizeCoveredSet(
  covered?: readonly string[] | ReadonlySet<string> | null,
): ReadonlySet<string> {
  if (!covered) return new Set<string>()
  if (covered instanceof Set) return covered
  return new Set(covered)
}

/**
 * 특정 주제가 완료 목록에 포함되어 있는지 확인한다 (별칭 매핑 포함).
 */
export function isTopicCovered(
  topicId: string,
  covered: ReadonlySet<string>,
): boolean {
  if (covered.has(topicId)) return true
  const aliases = TOPIC_ALIASES[topicId]
  if (aliases) {
    for (const alias of aliases) {
      if (covered.has(alias)) return true
    }
  }
  return false
}

export interface TopicProgressResult {
  done: number
  total: number
}

/**
 * 가르친 주제 진행률({done, total})을 계산한다.
 */
export function topicProgress(
  covered?: readonly string[] | ReadonlySet<string> | null,
): TopicProgressResult {
  const coveredSet = normalizeCoveredSet(covered)
  const done = TEACH_TOPICS.filter((topic) => isTopicCovered(topic.id, coveredSet)).length
  return {
    done,
    total: TEACH_TOPICS.length,
  }
}

/**
 * 특정 주제에 대한 사장님 첫 사용자 메시지 프롬프트를 생성한다.
 * - 소희에게 한 번에 하나씩 질문 요청
 * - 사장님이 직접 확인/승인하기 전까지 저장하지 않는다는 원칙 명시
 * - 저장 전 사실 되물어 확인
 */
export function buildTeachTopicPrompt(topic: TeachTopic): string {
  return `우리 가게의 '${topic.label}'에 대해 가르쳐주고 싶어. 궁금한 점을 한 번에 하나씩 차근차근 질문해줘. 사장님이 직접 확인하고 승인하기 전까지는 어떤 정보도 저장되지 않으니, 저장하기 전에 확인한 사실을 먼저 되짚어서 확인해줘.`
}

/**
 * 아직 가르치지 않은 첫 번째 추천 주제를 반환한다. 모두 완료 시 null.
 */
export function getNextTeachTopic(
  covered?: readonly string[] | ReadonlySet<string> | null,
): TeachTopic | null {
  const coveredSet = normalizeCoveredSet(covered)
  return TEACH_TOPICS.find((topic) => !isTopicCovered(topic.id, coveredSet)) ?? null
}

/**
 * 첫 미완료 주제에 대한 사용자 시작 메시지 프롬프트를 반환한다. 모두 완료 시 null.
 */
export function nextTeachPrompt(
  coveredTopicIds?: readonly string[] | ReadonlySet<string> | null,
): string | null {
  const next = getNextTeachTopic(coveredTopicIds)
  if (!next) return null
  return buildTeachTopicPrompt(next)
}
