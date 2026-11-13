export interface VisualKnowledgeHarness {
  id: string
  title: string
  platform: 'Instagram' | 'Naver Blog' | 'Threads' | 'Daangn'
  version: string
  sourceUrl: string
  sourceHandle: string
  status: 'READY (가동 가능)' | 'ANALYZING (수집 중)' | 'DRAFT (초안)'
  badgeColor: string
  lookbookImages: string[]
  coreDna: string[]
  moduleReadiness: {
    text: 'READY' | 'PARTIAL' | 'NOT_STARTED'
    visual: 'READY' | 'PARTIAL' | 'NOT_STARTED'
    operations: 'READY' | 'PARTIAL' | 'NOT_STARTED'
    community: 'READY' | 'PARTIAL' | 'NOT_STARTED'
    platform: 'READY' | 'PARTIAL' | 'NOT_STARTED'
  }
  dailyEstimatedSc: number
  toneVector: {
    professional: number
    empathy: number
    directness: number
    urgency: number
  }
  paragraphRhythm: string
  sentenceLengthProfile: string
  rules: {
    title: string
    content: string
    type: 'OBSERVED' | 'RECOMMENDED_DEFAULT'
    confidence: string
    evidence: string
  }[]
}

export const SIX_REGISTERED_HARNESSES: VisualKnowledgeHarness[] = [
  {
    id: 'harness_byreum_001',
    title: '바이름(studio_by.reum) 퍼스널 뷰티 진단 하네스',
    platform: 'Instagram',
    version: 'v1.0 (Immutable)',
    sourceUrl: 'https://www.instagram.com/studio_by.reum',
    sourceHandle: 'studio_by.reum',
    status: 'READY (가동 가능)',
    badgeColor: 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
    lookbookImages: [
      'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=800&auto=format&fit=crop'
    ],
    coreDna: [
      '1:1 퍼스널 골격 & 모류 정밀 진단',
      '시술 당일 일상 복귀 무통·무붉은기 기법',
      '화/수 첫 방문 15% 한정 프로모션 & 100% 예약제'
    ],
    moduleReadiness: {
      text: 'READY',
      visual: 'READY',
      operations: 'READY',
      community: 'PARTIAL',
      platform: 'READY'
    },
    dailyEstimatedSc: 120,
    toneVector: { professional: 85, empathy: 90, directness: 70, urgency: 65 },
    paragraphRhythm: '3~4문장 단위 여백 분리, 깔끔한 구분선(■) 적용',
    sentenceLengthProfile: '간결하고 명확한 어조 (평균 35자)',
    rules: [
      {
        title: '공감형 질문 훅 패턴',
        content: '아침 출근길 눈썹 그리기 씨름, 짱구 눈썹 불안감 등 일상 고충 직접 언급',
        type: 'OBSERVED',
        confidence: '95% 신뢰',
        evidence: '인스타그램 피드 최근 20개 게시물 중 14개 게시물 훅 구조 일치'
      },
      {
        title: 'FDA 안전 인증 유기농 피그먼트 강조',
        content: '붉은 잔흔 없는 변색 방지 최고급 천연 색소 맞춤 배합',
        type: 'OBSERVED',
        confidence: '90% 신뢰',
        evidence: '피드 및 스토리 하이라이트 내 반복 노출 사실 확인'
      }
    ]
  },
  {
    id: 'harness_noorbrow_002',
    title: '누르브로우(noor.brow) 메이크업 전공 1:1 디자인 하네스',
    platform: 'Instagram',
    version: 'v1.0 (Immutable)',
    sourceUrl: 'https://www.instagram.com/noor.brow',
    sourceHandle: 'noor.brow',
    status: 'READY (가동 가능)',
    badgeColor: 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
    lookbookImages: [
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1526045612212-70caf35c14df?w=800&auto=format&fit=crop'
    ],
    coreDna: [
      '미대/메이크업 전공자의 황금 비율 윤곽 드로잉',
      '비대칭 눈썹 100% 균형 교정 솔루션',
      '시술 후 1년 무상 터치업 멤버십'
    ],
    moduleReadiness: {
      text: 'READY',
      visual: 'READY',
      operations: 'READY',
      community: 'READY',
      platform: 'READY'
    },
    dailyEstimatedSc: 140,
    toneVector: { professional: 95, empathy: 80, directness: 85, urgency: 50 },
    paragraphRhythm: '디자인 철학 -> 골격 분석 -> 솔루션 제시의 정돈된 칼럼형 전개',
    sentenceLengthProfile: '전문적이고 신뢰감 있는 어조 (평균 42자)',
    rules: [
      {
        title: '비대칭 교정 비포애프터 팩트 검증',
        content: '각도별 무보정 초고화질 사진 3장 필수 구성 및 대칭선 가이드 표시',
        type: 'OBSERVED',
        confidence: '98% 신뢰',
        evidence: '최근 릴스 10건 전수 분석 결과 10건 모두 가이드 라인 표기'
      }
    ]
  },
  {
    id: 'harness_brow_fit_003',
    title: '브로우핏(brow_fit) 2030 남성 전문 그루밍 하네스',
    platform: 'Instagram',
    version: 'v1.0 (Immutable)',
    sourceUrl: 'https://www.instagram.com/brow_fit_men',
    sourceHandle: 'brow_fit_men',
    status: 'READY (가동 가능)',
    badgeColor: 'border-zinc-500 bg-zinc-50 text-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300',
    lookbookImages: [
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=800&auto=format&fit=crop'
    ],
    coreDna: [
      '티 안 나는 극자연주의 맨즈 섀도우 결 기법',
      '면접/웨딩/중요 미팅 전 D-3 쾌속 스타일링',
      '남성 전용 프라이빗 1인룸 운영'
    ],
    moduleReadiness: {
      text: 'READY',
      visual: 'READY',
      operations: 'PARTIAL',
      community: 'PARTIAL',
      platform: 'READY'
    },
    dailyEstimatedSc: 110,
    toneVector: { professional: 75, empathy: 70, directness: 95, urgency: 80 },
    paragraphRhythm: '불필요한 미사여구 배제, 체크리스트(✓) 및 불렛포인트 중심 직관적 전달',
    sentenceLengthProfile: '빠르고 명쾌한 단문 위주 (평균 28자)',
    rules: [
      {
        title: '티 안 남 극대화 키워드 필수 배치',
        content: '"부담스러운 짱구 NO", "시술 직후 약속 가능" 문구 본문 상단 배치',
        type: 'OBSERVED',
        confidence: '92% 신뢰',
        evidence: '피드 내 남성 고객 후기 30건 공통 강조 키워드'
      }
    ]
  },
  {
    id: 'harness_dan_brow_004',
    title: '단브로우(dan_brow) 하이엔드 섀도우 콤보 하네스',
    platform: 'Instagram',
    version: 'v1.0 (Immutable)',
    sourceUrl: 'https://www.instagram.com/dan_brow_studio',
    sourceHandle: 'dan_brow_studio',
    status: 'READY (가동 가능)',
    badgeColor: 'border-purple-500 bg-purple-50 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
    lookbookImages: [
      'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&auto=format&fit=crop'
    ],
    coreDna: [
      '자연결 + 수지 섀도우의 완벽한 조화(콤보 브로우)',
      '모질이 얇거나 숱이 적은 극건성 피부 맞춤 유지력 2년 보장',
      '프리미엄 살롱 인테리어 및 웰컴 티 서비스'
    ],
    moduleReadiness: {
      text: 'READY',
      visual: 'READY',
      operations: 'READY',
      community: 'READY',
      platform: 'READY'
    },
    dailyEstimatedSc: 150,
    toneVector: { professional: 90, empathy: 85, directness: 60, urgency: 40 },
    paragraphRhythm: '감성적 인트로 -> 디테일한 기법 설명 -> VIP 케어 안내의 우아한 호흡',
    sentenceLengthProfile: '부드럽고 품격 있는 정중한 경어체 (평균 45자)',
    rules: [
      {
        title: '피부 타입별 유지력 과학적 설명',
        content: '수분 부족형 지성 및 민감성 피부 대상 수지 기법의 안정성 강조',
        type: 'OBSERVED',
        confidence: '88% 신뢰',
        evidence: '블로그 연계 심층 칼럼 8건 분석'
      }
    ]
  },
  {
    id: 'harness_lash_art_005',
    title: '래쉬앤유(lash_and_u) 노글루 영양 펌 & 속눈썹 하네스',
    platform: 'Instagram',
    version: 'v1.0 (Immutable)',
    sourceUrl: 'https://www.instagram.com/lash_and_u',
    sourceHandle: 'lash_and_u',
    status: 'READY (가동 가능)',
    badgeColor: 'border-pink-500 bg-pink-50 text-pink-800 dark:bg-pink-950/60 dark:text-pink-300',
    lookbookImages: [
      'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1526045612212-70caf35c14df?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&auto=format&fit=crop'
    ],
    coreDna: [
      '손상모 제로 케라틴 밤 듬뿍 노글루 수분 펌',
      'C컬/U컬/L컬 15종 롯드 보유 눈매 맞춤 뷰러핏',
      '첫 방문 시 블랙 틴팅(₩10,000 상당) 무료 업그레이드'
    ],
    moduleReadiness: {
      text: 'READY',
      visual: 'READY',
      operations: 'READY',
      community: 'PARTIAL',
      platform: 'READY'
    },
    dailyEstimatedSc: 130,
    toneVector: { professional: 80, empathy: 95, directness: 80, urgency: 75 },
    paragraphRhythm: '생생한 감탄사(✨)와 이모지를 활용한 친근하고 트렌디한 인스타 감성',
    sentenceLengthProfile: '경쾌하고 통통 튀는 친근한 어조 (평균 30자)',
    rules: [
      {
        title: '또렷한 눈매 비포애프터 릴스 숏폼',
        content: '눈 깜빡임 클로즈업 영상 3초 훅으로 극적인 컬링 효과 입증',
        type: 'OBSERVED',
        confidence: '96% 신뢰',
        evidence: '평균 조회수 2.5만 회 릴스 12건 패턴 일치'
      }
    ]
  },
  {
    id: 'harness_cover_up_006',
    title: '리셋브로우(reset.brow) 붉은 잔흔 중화 & 복원 전문 하네스',
    platform: 'Instagram',
    version: 'v1.0 (Immutable)',
    sourceUrl: 'https://www.instagram.com/reset.brow',
    sourceHandle: 'reset.brow',
    status: 'READY (가동 가능)',
    badgeColor: 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    lookbookImages: [
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=800&auto=format&fit=crop'
    ],
    coreDna: [
      '오래된 붉은기/푸른 잔흔 레이저 없이 특수 색소 중화 커버업',
      '피부 표피층 손상 없는 저자극 복원 테크닉',
      '책임제 보증: 3차 리터치까지 완벽 커버 미달성 시 100% 환불'
    ],
    moduleReadiness: {
      text: 'READY',
      visual: 'READY',
      operations: 'READY',
      community: 'READY',
      platform: 'READY'
    },
    dailyEstimatedSc: 160,
    toneVector: { professional: 95, empathy: 95, directness: 85, urgency: 70 },
    paragraphRhythm: '원인 분석과 복원 프로세스 중심의 신뢰감 있는 전개',
    sentenceLengthProfile: '전문적이고 안정감 있는 솔루션 어조 (평균 36자)',
    rules: [
      {
        title: '붉은 잔흔 커버 비포애프터 팩트 훅',
        content: '타샵 잔흔으로 고민하던 고객의 무보정 1:1 중화 복원 스토리',
        type: 'OBSERVED',
        confidence: '97% 신뢰',
        evidence: '전후 릴스 15건'
      }
    ]
  }
]
