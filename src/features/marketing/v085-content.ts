import { subscriptionOffers } from '@/features/billing/subscription-offers'

export const MARKETING_COPY = Object.freeze({
  heroTitle: '여러 마케팅 채널을 돌아다니지 마세요.',
  heroDescription: '소희가 고객 문의, 예약, 콘텐츠, 게시 일정과 성과를 한곳에 모아 오늘 해야 할 일부터 정리합니다.',
  heroSupport: '소희와 대화하면 고객 답변에서 예약, 다음 콘텐츠와 성장 행동까지 한 흐름으로 이어집니다.',
  primaryCta: '내 매장으로 무료 진단하기',
  secondaryCta: '실제 운영 화면 보기',
  signupCta: '소희로 마케팅 시작하기',
  trustPoints: [
    '카드 없이 시작',
    '실제 게시 전 사장님 확인',
    '채널 비밀번호를 소희에 저장하지 않음',
    '공개 정보만으로 첫 진단 가능',
  ],
} as const)

export const PRODUCT_STEPS = Object.freeze([
  {
    id: 'signal',
    title: '예약 문의가 들어와요',
    description: '여러 채널에서 들어온 고객 반응 가운데 지금 놓치면 안 되는 문의를 먼저 찾습니다.',
    action: '중요 고객 확인',
  },
  {
    id: 'intent',
    title: '소희가 고객 의도를 설명해요',
    description: '예약 가능 시간, 가격 또는 상담이 필요한 질문인지 근거와 함께 정리합니다.',
    action: '의도와 근거 보기',
  },
  {
    id: 'drafts',
    title: '답변 초안 세 가지를 비교해요',
    description: '빠르고 짧게, 따뜻하고 친절하게, 상담으로 이어지게 중에서 목적에 맞는 답변을 고릅니다.',
    action: '답변 초안 비교',
  },
  {
    id: 'revise',
    title: '대화로 말투와 내용을 고쳐요',
    description: '사장님이 평소 쓰는 표현과 매장 기준에 맞게 소희와 대화하며 수정합니다.',
    action: '소희와 수정',
  },
  {
    id: 'booking',
    title: '상담 질문과 시간을 제안해요',
    description: '필요한 정보를 한 번 더 확인하고 실제 가능한 시간으로 예약을 이어갑니다.',
    action: '예약 제안 준비',
  },
  {
    id: 'content',
    title: '고객 질문을 다음 콘텐츠로 만들어요',
    description: '반복되는 좋은 질문을 고객이 찾을 다음 게시물과 검색형 콘텐츠로 돌립니다.',
    action: '콘텐츠 소재 저장',
  },
  {
    id: 'growth',
    title: '문의와 예약 기여를 확인해요',
    description: '좋아요 수보다 어떤 반응이 문의, 예약과 재방문으로 이어졌는지 살펴봅니다.',
    action: '다음 실험 선택',
  },
] as const)

export type IndustrySlug = 'beauty' | 'food' | 'education' | 'local-service'

export const INDUSTRIES = Object.freeze([
  {
    slug: 'beauty',
    label: '미용',
    headline: '상담 질문에서 예약과 재방문까지',
    customerQuestion: '이번 주말에 커트와 염색을 함께 예약할 수 있을까요?',
    missedAction: '가능 시간을 바로 안내하지 못해 예약 의도가 식는 순간',
    soheeAction: '시술 시간과 상담 기준을 확인하고 가능한 시간을 제안합니다.',
    recommendedTopics: ['시술 전 상담에서 자주 묻는 질문', '이번 주 빈 예약 시간', '방문 뒤 관리와 재방문 시기'],
    outcome: '상담 시작, 예약, 재방문',
  },
  {
    slug: 'food',
    label: '외식',
    headline: '메뉴, 리뷰와 방문 반응을 한 흐름으로',
    customerQuestion: '오늘 저녁에 아이와 함께 먹을 수 있는 메뉴가 있나요?',
    missedAction: '리뷰와 문의를 따로 보느라 방문 결정을 돕지 못하는 순간',
    soheeAction: '메뉴, 영업 시간과 방문 정보를 확인해 빠르게 답합니다.',
    recommendedTopics: ['오늘의 메뉴와 재료 이야기', '가족 방문 전 확인할 정보', '좋은 리뷰에서 발견한 선택 이유'],
    outcome: '방문, 주문, 리뷰, 재방문',
  },
  {
    slug: 'education',
    label: '교육',
    headline: '과정 문의에서 체험과 등록까지',
    customerQuestion: '초등 4학년도 이번 달 체험 수업을 신청할 수 있나요?',
    missedAction: '과정 설명은 했지만 상담 일정으로 이어지지 않는 순간',
    soheeAction: '대상, 과정과 가능한 체험 일정을 확인해 상담을 제안합니다.',
    recommendedTopics: ['학년별 과정 선택 기준', '체험 수업에서 확인할 점', '학부모가 자주 묻는 일정과 비용'],
    outcome: '상담, 체험, 등록',
  },
  {
    slug: 'local-service',
    label: '생활 서비스',
    headline: '가능 여부, 견적과 지역 문의를 놓치지 않게',
    customerQuestion: '오늘 오후에 이 지역으로 방문 견적이 가능할까요?',
    missedAction: '지역과 가능 여부를 늦게 확인해 다른 업체로 이동하는 순간',
    soheeAction: '작업 지역과 필요한 정보를 확인하고 견적 상담을 예약합니다.',
    recommendedTopics: ['서비스 가능 지역 안내', '견적 전에 필요한 사진과 정보', '완료 후기와 관리 방법'],
    outcome: '문의, 견적, 예약, 후기',
  },
] as const)

export type ChannelMode =
  | '공식 연결 검증 완료'
  | '감독형 실행 검증 완료'
  | '사용자 최종 게시 흐름 검증 완료'
  | '읽기 전용 분석 검증 완료'
  | '프로토타입만 구현'
  | '계획 단계'

export const CHANNEL_CAPABILITIES = Object.freeze([
  {
    id: 'instagram',
    name: '인스타그램',
    customerAction: '댓글, 메시지, 게시와 반응',
    soheeWork: '고객 문의 우선순위, 답변 초안, 콘텐츠와 성과를 준비합니다.',
    ownerFinish: '승인 정책 밖의 답변과 게시 전 최종 내용을 확인합니다.',
    mode: '공식 연결 검증 완료' as ChannelMode,
  },
  {
    id: 'threads',
    name: '스레드',
    customerAction: '게시, 답글과 반응',
    soheeWork: '짧은 의견형 문안과 대화로 이어질 질문을 준비합니다.',
    ownerFinish: '정확한 계정과 게시 버전을 승인합니다.',
    mode: '공식 연결 검증 완료' as ChannelMode,
  },
  {
    id: 'naver-blog',
    name: '네이버 블로그',
    customerAction: '검색, 상세 정보와 이미지',
    soheeWork: '검색형 제목, 본문, 이미지 순서와 최종 확인 묶음을 준비합니다.',
    ownerFinish: '공식 글쓰기 화면에서 최종 게시를 마칩니다.',
    mode: '사용자 최종 게시 흐름 검증 완료' as ChannelMode,
  },
  {
    id: 'naver-place',
    name: '네이버 플레이스',
    customerAction: '업체 정보, 리뷰와 새소식',
    soheeWork: '리뷰 답변과 새소식 초안, 확인 항목과 제출 묶음을 준비합니다.',
    ownerFinish: '보호된 공식 화면에서 대상과 반영 결과를 확인합니다.',
    mode: '감독형 실행 검증 완료' as ChannelMode,
  },
  {
    id: 'daangn-business',
    name: '당근 비즈프로필',
    customerAction: '지역 소식, 문의와 프로필',
    soheeWork: '지역 문맥에 맞는 소식과 프로필 점검 묶음을 준비합니다.',
    ownerFinish: '보호된 공식 화면에서 지역 대상과 제출을 마칩니다.',
    mode: '감독형 실행 검증 완료' as ChannelMode,
  },
] as const)

export const PLAN_COMPARISON = Object.freeze([
  { id: 'diagnosis', name: '무료 진단', price: '0원', channels: '공개 채널 1개', customer: '예비 진단', content: '추천 주제 3개', report: '첫 상태 정리' },
  ...subscriptionOffers.map((plan) => ({
    id: plan.code,
    name: plan.name,
    price: `월 ${plan.monthlyTotalPriceKrw.toLocaleString('ko-KR')}원 · VAT 포함 · 판매 준비 중`,
    channels: '이용 범위 확정 후 안내',
    customer: '기능 범위 확정 후 안내',
    content: '크레딧 지급 없음',
    report: '세부 조건 준비 중',
  })),
] as const)
