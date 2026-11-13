import type { ChannelDraftResult, ChannelDraftVariant } from '../types'

/**
 * 고정 샘플 초안 1: 카페 (성수동 카페 온)
 * - 4개 채널 variant 포함
 * - 인스타그램/스레드/블로그: 준비 완료
 * - 당근 비즈프로필: 확인 필요 (등록된 가게 정보에 가격 근거 없는 특가 이벤트)
 */
export const SAMPLE_CAFE_DRAFT: ChannelDraftResult = {
  requestKey: 'sample-cafe',
  topic: '봄맞이 딸기 신메뉴 출시 소식',
  createdAt: '2025-03-20T10:00:00.000Z',
  basisNotes: ['지식 v1 기준', '매장 위치 및 영업시간 반영', '가격 정보가 없어 가격 문구는 포함하지 않았어요'],
  imageNotice: '매장 대표 딸기 라떼 이미지 1장이 첨부되었습니다.',
  variants: [
    {
      channel: 'instagram',
      status: 'READY',
      statusLabel: '준비 완료',
      issues: [],
      contentId: null,
      versionId: null,
      vaultSavable: true,
      blockedReason: null,
      payload: {
        handle: '@cafe_on_seongsu',
        caption: '봄을 알리는 생딸기 라떼가 돌아왔습니다! 🍓\n신선한 생딸기를 듬뿍 담아 달콤하고 부드러운 봄의 맛을 전합니다.\n따스한 봄날, 성수동 카페 온에서 달콤한 여유를 즐겨보세요.',
        hashtags: ['성수카페', '생딸기라떼', '신메뉴', '디저트카페', '성수동카페'],
        imageUrls: ['/images/marketing/v085/industry-food-v1.png'],
      },
    },
    {
      channel: 'threads',
      status: 'READY',
      statusLabel: '준비 완료',
      issues: [],
      contentId: null,
      versionId: null,
      vaultSavable: true,
      blockedReason: null,
      payload: {
        handle: '@cafe_on_seongsu',
        caption: '오늘 날씨가 정말 따뜻하네요. 많은 분들이 기다려주신 생딸기 라떼, 오늘부터 정식 시작합니다 🍓 성수동 산책길에 편하게 들러주세요!',
        hashtags: ['카페일상', '성수동카페'],
        imageUrl: '/images/marketing/v085/industry-food-v1.png',
      },
    },
    {
      channel: 'naver_blog',
      status: 'READY',
      statusLabel: '준비 완료',
      issues: [],
      contentId: null,
      versionId: null,
      vaultSavable: true,
      blockedReason: null,
      payload: {
        title: '성수동 카페 온 | 2025 봄맞이 생딸기 라떼와 디저트 신메뉴 안내',
        text: '안녕하세요, 성수동 골목길 작은 쉼터 카페 온입니다.\n\n어느덧 바람 끝이 따스해지는 3월, 많은 단골손님들이 손꼽아 기다리시던 생딸기 라떼가 다시 찾아왔습니다.\n\n매일 아침 산지 직송으로 공수하는 신선한 생딸기와 진한 우유 크림이 어우러져 한 모금마다 봄의 생동감을 느끼실 수 있어요.\n\n성수동 나들이 오실 때 편안하게 들러 봄의 향기를 만끽해 보세요.',
        hashtags: ['성수카페', '생딸기라떼', '디저트카페', '성수동나들이'],
      },
    },
    {
      channel: 'daangn_business',
      status: 'NEEDS_CHECK',
      statusLabel: '확인 필요',
      issues: ['등록된 가게 정보에 가격 근거가 없어서 확인이 필요해요'],
      contentId: null,
      versionId: null,
      vaultSavable: false,
      blockedReason: '가격 정보 근거 확인 필요',
      payload: {
        businessName: '카페 온',
        firstLineHighlight: '🍓 봄맞이 생딸기 라떼 3,500원 특가 이벤트!',
        text: '성수동 이웃 여러분 안녕하세요! 카페 온입니다.\n동네 이웃분들을 위해 봄맞이 생딸기 라떼를 특가 3,500원에 준비했어요.\n오후 2시부터 5시까지 방문하시면 달콤한 디저트와 함께 즐기실 수 있습니다.',
      },
    },
  ],
}

/**
 * 고정 샘플 초안 2: 미용실 (루미에르 헤어)
 * - 4개 채널 variant 포함
 * - 인스타그램/스레드/당근: 준비 완료
 * - 네이버 블로그: 확인 필요 (등록된 지식에 첫 방문 50% 할인 근거 없음)
 */
export const SAMPLE_SALON_DRAFT: ChannelDraftResult = {
  requestKey: 'sample-salon',
  topic: '첫 방문 고객 맞춤 헤어 클리닉 소개',
  createdAt: '2025-03-20T11:00:00.000Z',
  basisNotes: ['지식 v2 기준', '디자이너 전문 이력 및 시술 정보 반영'],
  imageNotice: null,
  variants: [
    {
      channel: 'instagram',
      status: 'READY',
      statusLabel: '준비 완료',
      issues: [],
      contentId: null,
      versionId: null,
      vaultSavable: true,
      blockedReason: null,
      payload: {
        handle: '@salon_de_lumiere',
        caption: '건조한 봄철, 푸석해진 모발에 깊은 영양을 채워보세요 🌿\n1:1 정밀 모발 진단을 통해 모질에 딱 맞는 프리미엄 수분 클리닉을 선물합니다.\n네이버 예약으로 프라이빗하게 경험해보세요.',
        hashtags: ['헤어클리닉', '손상모케어', '봄맞이헤어', '헤어살롱'],
        imageUrls: ['/images/marketing/v085/industry-food-v1.png'],
      },
    },
    {
      channel: 'threads',
      status: 'READY',
      statusLabel: '준비 완료',
      issues: [],
      contentId: null,
      versionId: null,
      vaultSavable: true,
      blockedReason: null,
      payload: {
        handle: '@salon_de_lumiere',
        caption: '환절기 모발 관리는 유수분 밸런스가 핵심이에요. 상담 오시면 홈케어 방법도 꼼꼼히 알려드려요!',
        hashtags: ['모발관리', '헤어케어팁'],
      },
    },
    {
      channel: 'naver_blog',
      status: 'NEEDS_CHECK',
      statusLabel: '확인 필요',
      issues: ['등록된 지식에 첫 방문 50% 할인에 대한 근거가 없어요'],
      contentId: null,
      versionId: null,
      vaultSavable: false,
      blockedReason: '할인율 근거 확인 필요',
      payload: {
        title: '루미에르 헤어 | 첫 방문 고객 50% 반값 할인 프리미엄 클리닉 코스',
        text: '안녕하세요. 프리미엄 헤어살롱 루미에르입니다.\n\n이번 달 처음 방문해주시는 고객님들을 위해 시술비 전액 50% 할인 혜택을 준비했습니다.\n\n손상된 큐티클을 집중 케어하는 5단계 수분 단백질 코스로 찰랑이는 머릿결을 되찾아드립니다.\n\n지금 예약하시고 반값 혜택을 놓치지 마세요!',
        hashtags: ['헤어살롱', '첫방문할인', '헤어클리닉', '손상모케어'],
      },
    },
    {
      channel: 'daangn_business',
      status: 'READY',
      statusLabel: '준비 완료',
      issues: [],
      contentId: null,
      versionId: null,
      vaultSavable: true,
      blockedReason: null,
      payload: {
        businessName: '루미에르 헤어',
        firstLineHighlight: '🌿 우리 동네 1:1 맞춤 모발 케어',
        text: '이웃 여러분 안녕하세요! 루미에르 헤어입니다.\n봄 환절기 건조해진 모발 고민, 1:1 맞춤 케어로 건강하게 가꿔보세요.\n가벼운 마음으로 들러 따뜻한 차 한 잔과 함께 두피·모발 상담 받아보세요.',
      },
    },
  ],
}

/**
 * 고정 샘플 초안 3: 학원 (엘리트 수학학원)
 * - 4개 채널 variant 포함
 * - 인스타그램/블로그/당근: 준비 완료
 * - 스레드: 확인 필요 (등록된 지식에 수강료 월 15만원 및 교재비 무료 혜택 근거 없음)
 */
export const SAMPLE_ACADEMY_DRAFT: ChannelDraftResult = {
  requestKey: 'sample-academy',
  topic: '중등 내신 대비 수학 집중반 개강',
  createdAt: '2025-03-20T14:00:00.000Z',
  basisNotes: ['지식 v1 기준', '원장 직강 커리큘럼 및 교재 정보 반영'],
  imageNotice: null,
  variants: [
    {
      channel: 'instagram',
      status: 'READY',
      statusLabel: '준비 완료',
      issues: [],
      contentId: null,
      versionId: null,
      vaultSavable: true,
      blockedReason: null,
      payload: {
        handle: '@elite_math_academy',
        caption: '중간고사 대비, 원리부터 기출까지 완벽하게 잡는 수학 집중반이 개강합니다 📐\n소수정예 6인 반으로 학생 한 명 한 명의 취약점을 집중 보완합니다.\n체계적인 오답노트 관리로 성적 향상을 이끌어냅니다.',
        hashtags: ['중등수학', '내신대비', '중간고사', '수학학원', '소수정예'],
        imageUrls: ['/images/marketing/v085/industry-education-v1.png'],
      },
    },
    {
      channel: 'threads',
      status: 'NEEDS_CHECK',
      statusLabel: '확인 필요',
      issues: ['등록된 지식에 수강료 월 15만원 및 교재비 무료 혜택 근거가 없어요'],
      contentId: null,
      versionId: null,
      vaultSavable: false,
      blockedReason: '수강료 및 무료 혜택 근거 확인 필요',
      payload: {
        handle: '@elite_math_academy',
        caption: '이번 달 신규 등록 시 월 15만원 특가와 교재비 무료 혜택! 선착순으로 마감됩니다.',
        hashtags: ['중등수학', '수학학원'],
      },
    },
    {
      channel: 'naver_blog',
      status: 'READY',
      statusLabel: '준비 완료',
      issues: [],
      contentId: null,
      versionId: null,
      vaultSavable: true,
      blockedReason: null,
      payload: {
        title: '엘리트 수학학원 | 2025 1학기 중간고사 완벽 대비 중등부 수학 집중반',
        text: '안녕하세요. 개념과 풀이의 균형을 중시하는 엘리트 수학학원입니다.\n\n다가오는 중간고사를 앞두고 많은 학부모님과 학생들이 내신 준비 방향에 대해 고민하고 계십니다.\n\n저희 학원에서는 학교별 최근 3개년 기출문제를 완벽 분석하여 핵심 유형을 마스터하는 4주 완성 집중반을 운영합니다.\n\n취약 단원 일대일 밀착 피드백과 서술형 대비 클리닉으로 확실한 자신감을 심어드리겠습니다.',
        hashtags: ['중등수학', '중간고사대비', '내신수학', '기출문제분석'],
      },
    },
    {
      channel: 'daangn_business',
      status: 'READY',
      statusLabel: '준비 완료',
      issues: [],
      contentId: null,
      versionId: null,
      vaultSavable: true,
      blockedReason: null,
      payload: {
        businessName: '엘리트 수학학원',
        firstLineHighlight: '📐 1학기 중간고사 대비 중등 수학 집중반',
        text: '학부모 이웃 여러분 안녕하세요! 엘리트 수학학원입니다.\n1학기 중간고사를 앞두고 우리 아이 수학 자신감을 키워줄 소수정예 집중반을 개강합니다.\n학습 성향 진단 테스트와 1:1 학습 상담은 언제든 편하게 문의주세요.',
      },
    },
  ],
}

export const SAMPLE_CHANNEL_DRAFTS = [
  SAMPLE_CAFE_DRAFT,
  SAMPLE_SALON_DRAFT,
  SAMPLE_ACADEMY_DRAFT,
] as const

export const SAMPLE_DRAFTS_BY_INDUSTRY: Record<'cafe' | 'salon' | 'academy', { label: string; draft: ChannelDraftResult }> = {
  cafe: { label: '카페 (성수동 카페 온)', draft: SAMPLE_CAFE_DRAFT },
  salon: { label: '미용실 (루미에르 헤어)', draft: SAMPLE_SALON_DRAFT },
  academy: { label: '학원 (엘리트 수학학원)', draft: SAMPLE_ACADEMY_DRAFT },
}
