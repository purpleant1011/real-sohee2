import type { DiagnosisInput, DiagnosisResult } from './diagnosis-schema'

const byIndustry = {
  beauty: { questions: ['주말 예약이 가능한가요?', '시술 시간과 가격은 어떻게 되나요?'], topics: ['시술 전 상담에서 자주 묻는 질문', '이번 주 빈 예약 시간', '방문 뒤 관리와 재방문 시기'], missed: '가능 시간을 바로 안내하지 못해 예약 의도가 식을 수 있어요.' },
  food: { questions: ['아이와 함께 먹을 수 있는 메뉴가 있나요?', '오늘 영업 시간과 위치를 알려주세요.'], topics: ['오늘의 메뉴와 재료 이야기', '방문 전에 확인할 정보', '좋은 리뷰에서 발견한 선택 이유'], missed: '방문 결정을 돕는 메뉴와 위치 답변이 늦어질 수 있어요.' },
  education: { questions: ['이번 달 체험 수업이 가능한가요?', '과정과 비용은 어떻게 되나요?'], topics: ['과정 선택 기준', '체험 수업에서 확인할 점', '학부모가 자주 묻는 일정과 비용'], missed: '과정 설명 뒤 상담 일정으로 이어지지 않을 수 있어요.' },
  'local-service': { questions: ['오늘 방문 견적이 가능한가요?', '이 지역도 서비스가 가능한가요?'], topics: ['서비스 가능 지역', '견적 전에 필요한 정보', '완료 후기와 관리 방법'], missed: '지역과 가능 여부 확인이 늦어 다른 업체로 이동할 수 있어요.' },
} as const

export function buildPreliminaryDiagnosis(input: DiagnosisInput): DiagnosisResult {
  const source = byIndustry[input.industry]
  return { evidenceState: 'input_based_preliminary', customerQuestions: source.questions, missedAction: source.missed, recommendedTopics: source.topics, firstAction: input.problem === 'content' ? '이번 주 콘텐츠 계획을 소희와 만들기' : '가장 중요한 고객 문의부터 소희와 답하기' }
}
