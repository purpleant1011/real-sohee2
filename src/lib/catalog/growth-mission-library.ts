/**
 * Sohee Marketing Work Catalog: 80 Professional Growth Missions (ANI-314)
 * 
 * 10 Outcome Categories x 8 Missions = 80 Production Missions
 * - Clear Business Objective
 * - Target Channels
 * - Step by Step Pipeline
 * - Estimated SC Cost & Expected Business Value
 */

export interface GrowthMissionTemplate {
  id: string
  category: 
    | 'SLOT_FILLING'
    | 'NEW_ACQUISITION'
    | 'RETENTION_REPEAT'
    | 'AOV_EXPANSION'
    | 'LOCAL_DOMINANCE'
    | 'INSTA_THREADS_VIRAL'
    | 'NAVER_SEARCH_COLUMN'
    | 'DAANGN_COMMUNITY'
    | 'COMPETITOR_DEFENSE'
    | 'SEASONAL_CAMPAIGN'
  categoryName: string
  title: string
  description: string
  expectedOutcome: string
  targetChannels: ('INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN' | 'NAVER_TALKTALK' | 'KAKAO')[]
  estimatedSC: number
  stepsCount: number
  recommendedWhen: string
}

export const GROWTH_MISSION_LIBRARY: GrowthMissionTemplate[] = [
  // Category 1: 긴급 유휴 슬롯 소진 (8건)
  {
    id: 'mission_slot_01',
    category: 'SLOT_FILLING',
    categoryName: '긴급 유휴 슬롯 소진',
    title: '화/수 유휴 시간대 15% 한정 오퍼 긴급 배포',
    description: '공실 위험이 높은 평일 낮 슬롯을 채우기 위해 4대 채널에 타임세일 원고와 시안을 동시 배포합니다.',
    expectedOutcome: '평일 낮 공실 2~3건 즉시 예약 전환',
    targetChannels: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'],
    estimatedSC: 420,
    stepsCount: 5,
    recommendedWhen: '주중 공실 슬롯이 4개 이상 남아있을 때'
  },
  {
    id: 'mission_slot_02',
    category: 'SLOT_FILLING',
    categoryName: '긴급 유휴 슬롯 소진',
    title: '당일 취소(노쇼) 슬롯 긴급 번개 공지',
    description: '갑작스러운 예약 취소 발생 시 인스타그램 스토리와 당근 동네소식으로 1시간 이내 당일 예약자를 유치합니다.',
    expectedOutcome: '당일 노쇼 손실(₩90,000) 100% 방어',
    targetChannels: ['INSTAGRAM', 'DAANGN'],
    estimatedSC: 180,
    stepsCount: 3,
    recommendedWhen: '당일 예약 취소 발생 시'
  },
  {
    id: 'mission_slot_03',
    category: 'SLOT_FILLING',
    categoryName: '긴급 유휴 슬롯 소진',
    title: '목요일 야간(19:00~21:00) 직장인 퇴근길 집중 공략',
    description: '퇴근 후 방문을 원하는 직장인 타깃으로 야간 시술 슬롯 안내 콘텐츠를 발행합니다.',
    expectedOutcome: '야간 프리미엄 슬롯 2건 마감',
    targetChannels: ['INSTAGRAM', 'THREADS'],
    estimatedSC: 220,
    stepsCount: 4,
    recommendedWhen: '목/금 야간 슬롯 잔여 시'
  },
  {
    id: 'mission_slot_04',
    category: 'SLOT_FILLING',
    categoryName: '긴급 유휴 슬롯 소진',
    title: '비 오는 날(우천) 당일 예약 10% 혜택 알림톡',
    description: '우천 시 방문 고객을 위해 따뜻한 차와 10% 리워드를 제공하는 감성 프로모션을 가동합니다.',
    expectedOutcome: '우천 공실 1~2건 방어',
    targetChannels: ['KAKAO', 'INSTAGRAM'],
    estimatedSC: 150,
    stepsCount: 3,
    recommendedWhen: '비 예보가 있는 날 아침'
  },
  {
    id: 'mission_slot_05',
    category: 'SLOT_FILLING',
    categoryName: '긴급 유휴 슬롯 소진',
    title: '주말 잔여 1자리 라스트 찬스 마감 공지',
    description: '토/일 마지막 남은 잔여 슬롯의 예약 마감을 촉진하는 긴급 공지 피드를 생성합니다.',
    expectedOutcome: '주말 100% 풀 부킹 완결',
    targetChannels: ['INSTAGRAM', 'THREADS'],
    estimatedSC: 160,
    stepsCount: 3,
    recommendedWhen: '주말 잔여 슬롯 1~2개 남았을 때'
  },
  {
    id: 'mission_slot_06',
    category: 'SLOT_FILLING',
    categoryName: '긴급 유휴 슬롯 소진',
    title: '월요일 오전 10시 얼리버드 뷰티 모닝',
    description: '주초 한가한 월요일 오전을 선호하는 주부/프리랜서 타깃 모닝 티타임 콤보 오퍼.',
    expectedOutcome: '월요일 오전 유휴 2건 전환',
    targetChannels: ['NAVER_BLOG', 'DAANGN'],
    estimatedSC: 250,
    stepsCount: 4,
    recommendedWhen: '월요일 오전 예약 비었을 때'
  },
  {
    id: 'mission_slot_07',
    category: 'SLOT_FILLING',
    categoryName: '긴급 유휴 슬롯 소진',
    title: '2인 동반 예약 1+1 타임 세이브 슬롯',
    description: '친구/모녀 동반 방문 시 시간대를 묶어 효율을 극대화하는 동반 예약 프로모션.',
    expectedOutcome: '단일 슬롯 대비 2배 매출 달성',
    targetChannels: ['INSTAGRAM', 'DAANGN'],
    estimatedSC: 290,
    stepsCount: 4,
    recommendedWhen: '연속 2개 슬롯이 비어있을 때'
  },
  {
    id: 'mission_slot_08',
    category: 'SLOT_FILLING',
    categoryName: '긴급 유휴 슬롯 소진',
    title: '월말 미마감 슬롯 결산 클리어런스',
    description: '월말 마지막 3일간 남은 공실을 정리하는 시즌 마감 혜택 안내.',
    expectedOutcome: '월말 매출 목표 100% 달성',
    targetChannels: ['INSTAGRAM', 'NAVER_BLOG', 'DAANGN'],
    estimatedSC: 340,
    stepsCount: 5,
    recommendedWhen: '매월 27~30일 잔여 슬롯 소진 시'
  },

  // Category 2: 신규 고객 첫 방문 유치 (8건)
  {
    id: 'mission_acq_01',
    category: 'NEW_ACQUISITION',
    categoryName: '신규 고객 첫 방문 유치',
    title: '1:1 골격&모류 맞춤 진단 첫방문 웰컴 가이드',
    description: '내 눈썹 골격에 맞는 1:1 맞춤 디자인 진단 프로세스를 상세히 소개하여 첫 방문 장벽을 낮춥니다.',
    expectedOutcome: '고관여 신규 문의 5건 이상 유치',
    targetChannels: ['NAVER_BLOG', 'INSTAGRAM'],
    estimatedSC: 380,
    stepsCount: 5,
    recommendedWhen: '신규 고객 문의가 정체되었을 때'
  },
  {
    id: 'mission_acq_02',
    category: 'NEW_ACQUISITION',
    categoryName: '신규 고객 첫 방문 유치',
    title: '짱구 눈썹 없는 당일 일상복귀 자연결 안심 안내',
    description: '시술 직후 짱구처럼 진해지지 않고 바로 일상 복귀 가능한 자연결 엠보 기법을 소개합니다.',
    expectedOutcome: '시술 망설임 고객 전환율 40% 증가',
    targetChannels: ['INSTAGRAM', 'THREADS', 'DAANGN'],
    estimatedSC: 320,
    stepsCount: 4,
    recommendedWhen: '자연스러운 눈썹 선호 고객 유치 시'
  },
  {
    id: 'mission_acq_03',
    category: 'NEW_ACQUISITION',
    categoryName: '신규 고객 첫 방문 유치',
    title: '첫 시술 고객을 위한 무통 듀얼 케어 시스템 소개',
    description: '아플까 봐 걱정하는 입문 고객을 위해 통증 완화 시스템과 안심 시술 프로세스를 안내합니다.',
    expectedOutcome: '통증 민감 초보 고객 예약 전환',
    targetChannels: ['NAVER_BLOG', 'DAANGN'],
    estimatedSC: 280,
    stepsCount: 4,
    recommendedWhen: '첫 시술 고객 비율을 높이고 싶을 때'
  },
  {
    id: 'mission_acq_04',
    category: 'NEW_ACQUISITION',
    categoryName: '신규 고객 첫 방문 유치',
    title: '퍼스널 컬러 맞춤 색소 브랜딩 (붉은기 제로)',
    description: '피부 톤과 모발 색상에 맞춘 프리미엄 색소 배합 노하우로 변색 없는 롱래스팅을 어필합니다.',
    expectedOutcome: '색소 변색 걱정 고객 신뢰 확보',
    targetChannels: ['INSTAGRAM', 'NAVER_BLOG'],
    estimatedSC: 350,
    stepsCount: 5,
    recommendedWhen: '색소 퀄리티를 강조하고 싶을 때'
  },
  {
    id: 'mission_acq_05',
    category: 'NEW_ACQUISITION',
    categoryName: '신규 고객 첫 방문 유치',
    title: '청라 주민 첫방문 웰컴 브로우 케어 키트 증정',
    description: '첫 방문 고객 전원에게 시술 후 전용 재생 크림과 브로우 브러시 키트를 증정하는 오퍼.',
    expectedOutcome: '지역 신규 고객 호감도 극대화',
    targetChannels: ['DAANGN', 'INSTAGRAM'],
    estimatedSC: 260,
    stepsCount: 4,
    recommendedWhen: '동네 첫 방문자 혜택 강조 시'
  },
  {
    id: 'mission_acq_06',
    category: 'NEW_ACQUISITION',
    categoryName: '신규 고객 첫 방문 유치',
    title: '남성 전용 옴므 결 브로우 첫인상 교정 가이드',
    description: '눈썹 숱이 적거나 퍼진 남성을 위한 단정하고 티 안 나는 맨즈 브로우 시연 룩북.',
    expectedOutcome: '남성 신규 고객 예약 3건 유치',
    targetChannels: ['INSTAGRAM', 'THREADS', 'DAANGN'],
    estimatedSC: 310,
    stepsCount: 4,
    recommendedWhen: '맨즈 브로우 신규 수요 발굴 시'
  },
  {
    id: 'mission_acq_07',
    category: 'NEW_ACQUISITION',
    categoryName: '신규 고객 첫 방문 유치',
    title: '웨딩/면접 D-30 첫인상 완성 프로젝트',
    description: '결혼식 및 취업 면접을 앞둔 고객을 위한 D-30 맞춤형 인상 개선 프로그램.',
    expectedOutcome: '프리미엄 목적성 고객 유치',
    targetChannels: ['INSTAGRAM', 'NAVER_BLOG'],
    estimatedSC: 390,
    stepsCount: 5,
    recommendedWhen: '웨딩/면접 시즌 집중 공략 시'
  },
  {
    id: 'mission_acq_08',
    category: 'NEW_ACQUISITION',
    categoryName: '신규 고객 첫 방문 유치',
    title: '다른 샵 잔흔 중화 및 흉터 복원 첫 상담',
    description: '과거 실패한 시술 잔흔으로 고민하는 고객을 위한 복원 전문 상담 웰컴 칼럼.',
    expectedOutcome: '고난도 고단가 복원 시술 고객 확보',
    targetChannels: ['NAVER_BLOG', 'INSTAGRAM'],
    estimatedSC: 440,
    stepsCount: 6,
    recommendedWhen: '잔흔 커버 전문 포지셔닝 시'
  },

  // Category 3: 단골 재방문 & 리텐션 (8건)
  {
    id: 'mission_ret_01',
    category: 'RETENTION_REPEAT',
    categoryName: '단골 재방문 & 리텐션',
    title: '시술 4주차 리터치 골든타임 알림 루프',
    description: '최적의 착색 완성을 위해 4~6주차 고객에게 1:1 맞춤 리터치 예약 알림과 상태 점검을 발송합니다.',
    expectedOutcome: '리터치 예약 완수율 95% 달성',
    targetChannels: ['KAKAO', 'NAVER_TALKTALK'],
    estimatedSC: 180,
    stepsCount: 3,
    recommendedWhen: '시술 후 30일 경과 고객 발생 시'
  },
  {
    id: 'mission_ret_02',
    category: 'RETENTION_REPEAT',
    categoryName: '단골 재방문 & 리텐션',
    title: '시술 후 3일차 안심 케어 & 재생크림 꿀팁 발송',
    description: '가려움이나 탈각이 시작되는 3일차 고객에게 안심 가이드와 관리법을 자동 안내하여 신뢰를 극대화합니다.',
    expectedOutcome: '고객 만족도 및 5점 후기 전환율 80%',
    targetChannels: ['KAKAO', 'INSTAGRAM'],
    estimatedSC: 120,
    stepsCount: 2,
    recommendedWhen: '시술 직후 3일차 고객 관리 시'
  },
  {
    id: 'mission_ret_03',
    category: 'RETENTION_REPEAT',
    categoryName: '단골 재방문 & 리텐션',
    title: '6개월~1년 차 재방문 고객 쌩얼 유지 리마인더',
    description: '서서히 결이 옅어지는 8~12개월 차 기존 고객에게 감사 혜택과 함께 재방문 예약 링크를 전달합니다.',
    expectedOutcome: '기존 고객 재방문 3~4건 유치',
    targetChannels: ['KAKAO', 'NAVER_TALKTALK'],
    estimatedSC: 200,
    stepsCount: 3,
    recommendedWhen: '기존 단골 재방문 주기 도래 시'
  },
  {
    id: 'mission_ret_04',
    category: 'RETENTION_REPEAT',
    categoryName: '단골 재방문 & 리텐션',
    title: '생일 고객 프라이빗 VIP 리워드 안내',
    description: '이번 달 생일을 맞이한 단골 고객에게 속눈썹 펌 50% 할인 쿠폰과 생일 축하 메시지를 발송합니다.',
    expectedOutcome: 'VIP 고객 충성도 및 추가 시술 결제',
    targetChannels: ['KAKAO'],
    estimatedSC: 140,
    stepsCount: 2,
    recommendedWhen: '매월 1일 생일 고객 자동 조회 시'
  },
  {
    id: 'mission_ret_05',
    category: 'RETENTION_REPEAT',
    categoryName: '단골 재방문 & 리텐션',
    title: '지인 추천 감사 리워드 (소개자+친구 동시 혜택)',
    description: '지인을 소개해 준 단골에게 감사 바우처를 지급하고 추천 유입을 가속화합니다.',
    expectedOutcome: '자연 바이럴 신규 소개 유입',
    targetChannels: ['KAKAO', 'INSTAGRAM'],
    estimatedSC: 160,
    stepsCount: 3,
    recommendedWhen: '추천 소개 고객 방문 시'
  },
  {
    id: 'mission_ret_06',
    category: 'RETENTION_REPEAT',
    categoryName: '단골 재방문 & 리텐션',
    title: '단골 전용 시크릿 야간 슬롯 오픈 초대장',
    description: '일반 예약창에는 열리지 않는 VIP 전용 야간 프라이빗 슬롯 우선 예약 링크 전달.',
    expectedOutcome: '충성 고객 감동 및 100% 예약 점유',
    targetChannels: ['KAKAO'],
    estimatedSC: 150,
    stepsCount: 2,
    recommendedWhen: '야간 프라이빗 슬롯 운영 시'
  },
  {
    id: 'mission_ret_07',
    category: 'RETENTION_REPEAT',
    categoryName: '단골 재방문 & 리텐션',
    title: '시술 1주년 감사 브로우 브러싱 리터칭 초대',
    description: '첫 방문 1주년을 맞은 고객에게 눈썹 정리 무료 서비스와 함께 방문을 유도합니다.',
    expectedOutcome: '이탈 위험 고객 60% 재활성화',
    targetChannels: ['KAKAO'],
    estimatedSC: 170,
    stepsCount: 3,
    recommendedWhen: '장기 미방문 단골 리액티베이션 시'
  },
  {
    id: 'mission_ret_08',
    category: 'RETENTION_REPEAT',
    categoryName: '단골 재방문 & 리텐션',
    title: '단골 고객 리뷰 작성 감사 포인트 자동 적립',
    description: '네이버 영수증 포토 리뷰를 남겨주신 고객에게 감사 인사와 다음 방문 적립금을 자동 지급합니다.',
    expectedOutcome: '플레이스 포토 리뷰 누적 가속',
    targetChannels: ['NAVER_TALKTALK', 'KAKAO'],
    estimatedSC: 110,
    stepsCount: 2,
    recommendedWhen: '포토 후기 작성 확인 시'
  },

  // Category 4: 객단가 상승 & 콤보 시술 (8건)
  {
    id: 'mission_aov_01',
    category: 'AOV_EXPANSION',
    categoryName: '객단가 상승 & 콤보 시술',
    title: '자연눈썹 + 블랙 틴팅 속눈썹 펌 쌩얼 콤보',
    description: '눈썹과 속눈썹을 한 번에 완성하는 쌩얼 풀세트 콤보를 제안하여 객단가를 1.5배로 끌어올립니다.',
    expectedOutcome: '평균 객단가(AOV) ₩90,000 -> ₩140,000 상승',
    targetChannels: ['INSTAGRAM', 'NAVER_BLOG', 'DAANGN'],
    estimatedSC: 340,
    stepsCount: 5,
    recommendedWhen: '단일 시술 비중이 높을 때'
  },
  {
    id: 'mission_aov_02',
    category: 'AOV_EXPANSION',
    categoryName: '객단가 상승 & 콤보 시술',
    title: '콤보 브로우(엠보+섀도우) 입체 그라데이션 업그레이드',
    description: '자연결에 부드러운 음영을 더해 유지력을 2배로 늘려주는 프리미엄 콤보 업그레이드 안내.',
    expectedOutcome: '프리미엄 시술 전환율 35% 달성',
    targetChannels: ['INSTAGRAM', 'NAVER_BLOG'],
    estimatedSC: 310,
    stepsCount: 4,
    recommendedWhen: '고단가 시술 비중을 높이고 싶을 때'
  },
  {
    id: 'mission_aov_03',
    category: 'AOV_EXPANSION',
    categoryName: '객단가 상승 & 콤보 시술',
    title: '헤어라인 교정 + 브로우 토탈 페이스 라인 패키지',
    description: 'M자 헤어라인과 눈썹을 함께 다듬어 이마 윤곽을 살리는 동안 페이스 패키지 기획.',
    expectedOutcome: '고액 결제(₩250,000+) 유치',
    targetChannels: ['NAVER_BLOG', 'INSTAGRAM'],
    estimatedSC: 390,
    stepsCount: 5,
    recommendedWhen: '헤어라인 시술 수요 창출 시'
  },
  {
    id: 'mission_aov_04',
    category: 'AOV_EXPANSION',
    categoryName: '객단가 상승 & 콤보 시술',
    title: '립 블러쉬(틴트 입술) + 브로우 올인원 쌩얼 세트',
    description: '혈색 립과 자연눈썹 결합으로 아침 메이크업 시간을 20분 단축시키는 올인원 패키지.',
    expectedOutcome: '토탈 뷰티 샵 포지셔닝 및 매출 2배',
    targetChannels: ['INSTAGRAM', 'THREADS'],
    estimatedSC: 360,
    stepsCount: 5,
    recommendedWhen: '립 시술 메뉴 홍보 시'
  },
  {
    id: 'mission_aov_05',
    category: 'AOV_EXPANSION',
    categoryName: '객단가 상승 & 콤보 시술',
    title: '프리미엄 애프터케어 세럼 & 홈케어 패키지 판매 연계',
    description: '시술 후 착색 유지력을 높이는 전용 세럼 키트를 시술 패키지에 결합하여 부가 매출 창출.',
    expectedOutcome: '시술 외 부가 상품 매출 15% 기여',
    targetChannels: ['INSTAGRAM', 'NAVER_TALKTALK'],
    estimatedSC: 220,
    stepsCount: 3,
    recommendedWhen: '홈케어 제품 재고 판매 연동 시'
  },
  {
    id: 'mission_aov_06',
    category: 'AOV_EXPANSION',
    categoryName: '객단가 상승 & 콤보 시술',
    title: '커플 동시 시술 맨즈+우먼즈 콤보 패키지',
    description: '연인 또는 부부가 함께 방문하여 받는 1:1 맞춤 커플 뷰티 패키지 안내.',
    expectedOutcome: '2인 동시 고액 결제 유치',
    targetChannels: ['INSTAGRAM', 'DAANGN'],
    estimatedSC: 330,
    stepsCount: 4,
    recommendedWhen: '커플/주말 예약 활성화 시'
  },
  {
    id: 'mission_aov_07',
    category: 'AOV_EXPANSION',
    categoryName: '객단가 상승 & 콤보 시술',
    title: '속눈썹 펌 3회 정기 구독권(선불권) 혜택 안내',
    description: '주기적 관리가 필요한 펌 고객을 위해 3회 묶음 할인 및 우선 슬롯 예약권을 판매합니다.',
    expectedOutcome: '선불 현금 흐름 및 3개월 락인',
    targetChannels: ['DAANGN', 'KAKAO'],
    estimatedSC: 270,
    stepsCount: 4,
    recommendedWhen: '단골 락인 선불권 판매 시'
  },
  {
    id: 'mission_aov_08',
    category: 'AOV_EXPANSION',
    categoryName: '객단가 상승 & 콤보 시술',
    title: 'VIP 연간 브로우 프리패스 멤버십 제안',
    description: '1년 동안 리터치 및 디자인 유지를 무제한 케어하는 최고급 멤버십 프로그램.',
    expectedOutcome: '최고가 VIP 고객 2~3명 확보',
    targetChannels: ['KAKAO', 'INSTAGRAM'],
    estimatedSC: 410,
    stepsCount: 5,
    recommendedWhen: '연간 멤버십 도입 시'
  },

  // Category 5: 로컬 상권 점유 & 플레이스 관리 (8건)
  {
    id: 'mission_loc_01',
    category: 'LOCAL_DOMINANCE',
    categoryName: '로컬 상권 점유 & 플레이스 관리',
    title: '청라 상권 스마트플레이스 검색 키워드 최적화',
    description: '청라 자연눈썹, 청라 속눈썹 펌 등 핵심 로컬 검색어의 스마트플레이스 소개글과 태그를 정밀 세팅합니다.',
    expectedOutcome: '플레이스 로컬 검색 가시성 및 유입 향상',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 290,
    stepsCount: 4,
    recommendedWhen: '네이버 지도/플레이스 검색 유입 강화 시'
  },
  {
    id: 'mission_loc_02',
    category: 'LOCAL_DOMINANCE',
    categoryName: '로컬 상권 점유 & 플레이스 관리',
    title: '청라 센트럴파크/커낼웨이 랜드마크 연계 찾아오시는 길 안내',
    description: '주차장 위치, 랜드마크 기준 도보 경로, 매장 인테리어 무드를 담은 친절한 오시는 길 포스팅.',
    expectedOutcome: '첫 방문 고객 길찾기 이탈 제로화',
    targetChannels: ['NAVER_BLOG', 'INSTAGRAM'],
    estimatedSC: 260,
    stepsCount: 4,
    recommendedWhen: '매장 위치 문의가 많을 때'
  },
  {
    id: 'mission_loc_03',
    category: 'LOCAL_DOMINANCE',
    categoryName: '로컬 상권 점유 & 플레이스 관리',
    title: '영수증 포토 후기 작성 이벤트 플레이스 연동',
    description: '방문 고객의 5점 포토 후기를 유도하는 스마트플레이스 이벤트 배너 및 공지 생성.',
    expectedOutcome: '월간 포토 후기 20건 이상 누적',
    targetChannels: ['NAVER_BLOG', 'DAANGN'],
    estimatedSC: 230,
    stepsCount: 3,
    recommendedWhen: '플레이스 후기 개수 부족 시'
  },
  {
    id: 'mission_loc_04',
    category: 'LOCAL_DOMINANCE',
    categoryName: '로컬 상권 점유 & 플레이스 관리',
    title: '청라 맘카페 추천 쌩얼 꿀팁 연계 바이럴',
    description: '등하원길 쌩얼 자신감을 높여주는 자연눈썹 관리 꿀팁으로 동네 입소문 확산.',
    expectedOutcome: '지역 맘 고객 문의 4~5건 유입',
    targetChannels: ['DAANGN', 'NAVER_BLOG'],
    estimatedSC: 340,
    stepsCount: 5,
    recommendedWhen: '지역 주부/맘 타깃 유치 시'
  },
  {
    id: 'mission_loc_05',
    category: 'LOCAL_DOMINANCE',
    categoryName: '로컬 상권 점유 & 플레이스 관리',
    title: '인천 서구/루원시티 인접 상권 확장 타깃 키워드 공략',
    description: '청라를 넘어 루원시티, 가정동 이웃 상권 주민들을 유입시키는 확장형 검색 원고.',
    expectedOutcome: '인접 상권 신규 유입 30% 증가',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 310,
    stepsCount: 4,
    recommendedWhen: '상권 확장 마케팅 진행 시'
  },
  {
    id: 'mission_loc_06',
    category: 'LOCAL_DOMINANCE',
    categoryName: '로컬 상권 점유 & 플레이스 관리',
    title: '원장님 프로필 & 11년 경력 권위 브랜딩 칼럼',
    description: 'MAC 메이크업 아티스트 출신 및 전문 자격 이력을 바탕으로 한 프리미엄 권위 입증.',
    expectedOutcome: '타 샵 대비 압도적 신뢰도 구축',
    targetChannels: ['NAVER_BLOG', 'INSTAGRAM'],
    estimatedSC: 380,
    stepsCount: 5,
    recommendedWhen: '전문성 기반 가격 저항 해소 시'
  },
  {
    id: 'mission_loc_07',
    category: 'LOCAL_DOMINANCE',
    categoryName: '로컬 상권 점유 & 플레이스 관리',
    title: '플레이스 소식란 주간 정기 업로드 & 예약창 직링크',
    description: '네이버 플레이스 소식 탭에 이번 주 실시간 잔여 슬롯과 이벤트를 정기적으로 업데이트.',
    expectedOutcome: '네이버 플레이스 예약 전환율 25% 상승',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 190,
    stepsCount: 3,
    recommendedWhen: '매주 월요일 플레이스 관리 시'
  },
  {
    id: 'mission_loc_08',
    category: 'LOCAL_DOMINANCE',
    categoryName: '로컬 상권 점유 & 플레이스 관리',
    title: '지역 제휴(인근 헤어샵/네일샵) 상호 할인 안내',
    description: '동네 미용실/네일샵 고객 대상 상호 제휴 할인 안내로 로컬 네트워크 강화.',
    expectedOutcome: '로컬 오프라인 제휴 유입',
    targetChannels: ['DAANGN', 'INSTAGRAM'],
    estimatedSC: 280,
    stepsCount: 4,
    recommendedWhen: '지역 샵 콜라보 진행 시'
  },

  // Category 6: 인스타그램/스레드 바이럴 룩북 (8건)
  {
    id: 'mission_ins_01',
    category: 'INSTA_THREADS_VIRAL',
    categoryName: '인스타그램/스레드 바이럴 룩북',
    title: '초근접 45도 자연결 엠보 4컷 룩북 릴리즈',
    description: '한 올 한 올 살아있는 모류 디테일과 자연광 무드의 4컷 카드뉴스를 제작하여 저장수를 폭발시킵니다.',
    expectedOutcome: '저장수 50+ 및 DM 문의 8건 창출',
    targetChannels: ['INSTAGRAM', 'THREADS'],
    estimatedSC: 360,
    stepsCount: 5,
    recommendedWhen: '피드 비주얼 퀄리티를 극대화할 때'
  },
  {
    id: 'mission_ins_02',
    category: 'INSTA_THREADS_VIRAL',
    categoryName: '인스타그램/스레드 바이럴 룩북',
    title: '비포애프터 드라마틱 인상 교정 릴스/쇼츠 시안',
    description: '비대칭 교정 및 또렷한 인상 변화를 보여주는 비포애프터 비교 룩북.',
    expectedOutcome: '도달수 3,000+ 및 팔로워 증가',
    targetChannels: ['INSTAGRAM'],
    estimatedSC: 420,
    stepsCount: 6,
    recommendedWhen: '인상 변화 임팩트를 강조할 때'
  },
  {
    id: 'mission_ins_03',
    category: 'INSTA_THREADS_VIRAL',
    categoryName: '인스타그램/스레드 바이럴 룩북',
    title: '스레드 1:1 대화형 "눈썹 모양 고민 상담소"',
    description: '둥근 얼굴, 각진 얼굴 등 얼굴형별 어울리는 눈썹 모양을 스레드 타래로 쉽게 풀어내기.',
    expectedOutcome: '댓글 참여 20+ 및 프로필 링크 유입',
    targetChannels: ['THREADS'],
    estimatedSC: 210,
    stepsCount: 3,
    recommendedWhen: '스레드 팔로워 소통 및 바이럴 시'
  },
  {
    id: 'mission_ins_04',
    category: 'INSTA_THREADS_VIRAL',
    categoryName: '인스타그램/스레드 바이럴 룩북',
    title: '시술 도구 위생 & 1회용 니들 100% 폐기 안심 릴스',
    description: '멸균 포장 개봉 및 시술 직후 즉시 폐기 과정을 투명하게 공개하여 위생 걱정 해소.',
    expectedOutcome: '신뢰 기반 예약 문의 30% 증가',
    targetChannels: ['INSTAGRAM'],
    estimatedSC: 280,
    stepsCount: 4,
    recommendedWhen: '위생/안전성 강조 필요 시'
  },
  {
    id: 'mission_ins_05',
    category: 'INSTA_THREADS_VIRAL',
    categoryName: '인스타그램/스레드 바이럴 룩북',
    title: '원장님의 메이크업 아티스트 시술 철학 한 끗 차이',
    description: '왜 1mm의 아치 각도가 얼굴 전체의 세련됨을 결정하는지 깊이 있는 스토리텔링.',
    expectedOutcome: '전문가 브랜딩 및 팬덤 형성',
    targetChannels: ['THREADS', 'INSTAGRAM'],
    estimatedSC: 260,
    stepsCount: 4,
    recommendedWhen: '브랜드 가치 및 철학 전달 시'
  },
  {
    id: 'mission_ins_06',
    category: 'INSTA_THREADS_VIRAL',
    categoryName: '인스타그램/스레드 바이럴 룩북',
    title: '고객 리얼 후기 인용 카드뉴스 (카톡 캡처 무드)',
    description: '고객이 보내주신 감동의 감사 메시지를 세련된 템플릿으로 제작하여 사회적 증거 제시.',
    expectedOutcome: '예약 신뢰도 및 전환율 급상승',
    targetChannels: ['INSTAGRAM'],
    estimatedSC: 240,
    stepsCount: 4,
    recommendedWhen: '생생한 고객 후기 홍보 시'
  },
  {
    id: 'mission_ins_07',
    category: 'INSTA_THREADS_VIRAL',
    categoryName: '인스타그램/스레드 바이럴 룩북',
    title: '인스타 프로필 하이라이트 & FAQ 5종 전면 개편',
    description: '예약 방법, 가격표, 오시는 길, 비포애프터 하이라이트 커버 및 내용 리뉴얼.',
    expectedOutcome: '프로필 방문자 예약 전환율 50% 향상',
    targetChannels: ['INSTAGRAM'],
    estimatedSC: 320,
    stepsCount: 5,
    recommendedWhen: '프로필 첫인상 정비 시'
  },
  {
    id: 'mission_ins_08',
    category: 'INSTA_THREADS_VIRAL',
    categoryName: '인스타그램/스레드 바이럴 룩북',
    title: '트렌디 뷰티 밈 & 일상 공감 숏폼 캡션',
    description: '아침마다 눈썹 그리다 지각할 뻔한 직장인 일상 공감 유머 콘텐츠.',
    expectedOutcome: '친근한 브랜드 이미지 및 도달 확대',
    targetChannels: ['INSTAGRAM', 'THREADS'],
    estimatedSC: 220,
    stepsCount: 3,
    recommendedWhen: '친근한 소통 및 가벼운 콘텐츠 필요 시'
  },

  // Category 7: 네이버 블로그 검색 점유 칼럼 (8건)
  {
    id: 'mission_nav_01',
    category: 'NAVER_SEARCH_COLUMN',
    categoryName: '네이버 블로그 검색 점유 칼럼',
    title: '청라 자연눈썹 실패 없이 잘하는 곳 고르는 3가지 기준',
    description: '소비자가 샵을 선택할 때 반드시 봐야 하는 체크리스트를 전문성 있게 정리한 2,500자 칼럼.',
    expectedOutcome: '네이버 블로그 검색 유입 및 가시성 확보',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 390,
    stepsCount: 5,
    recommendedWhen: '검색 유입을 통한 진성 고객 유치 시'
  },
  {
    id: 'mission_nav_02',
    category: 'NAVER_SEARCH_COLUMN',
    categoryName: '네이버 블로그 검색 점유 칼럼',
    title: '붉은 잔흔 중화 커버 vs 레이저 제거 비용/기간 완벽 비교',
    description: '잔흔으로 고통받는 고객을 위해 레이저 제거와 중화 커버의 장단점을 객관적으로 비교.',
    expectedOutcome: '잔흔 커버 고단가 시술 문의 3건 유입',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 420,
    stepsCount: 5,
    recommendedWhen: '고난도 잔흔 커버 키워드 공략 시'
  },
  {
    id: 'mission_nav_03',
    category: 'NAVER_SEARCH_COLUMN',
    categoryName: '네이버 블로그 검색 점유 칼럼',
    title: '지성 피부/건성 피부 타입별 눈썹 반영구 유지력 차이점',
    description: '피부 타입에 따른 색소 침투와 지속 기간, 전용 관리법을 의학/뷰티 관점에서 설명.',
    expectedOutcome: '피부 고민 고객의 전문 상담 예약',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 360,
    stepsCount: 4,
    recommendedWhen: '전문 지식형 콘텐츠 발행 시'
  },
  {
    id: 'mission_nav_04',
    category: 'NAVER_SEARCH_COLUMN',
    categoryName: '네이버 블로그 검색 점유 칼럼',
    title: '속눈썹 펌 주기와 손상 없는 영양 틴팅 펌 가이드',
    description: '속눈썹이 끊어지거나 타지 않는 수분 영양 펌 시술 원리와 관리법 소개.',
    expectedOutcome: '속눈썹 펌 정기 고객 5명 확보',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 310,
    stepsCount: 4,
    recommendedWhen: '속눈썹 펌 키워드 점유 시'
  },
  {
    id: 'mission_nav_05',
    category: 'NAVER_SEARCH_COLUMN',
    categoryName: '네이버 블로그 검색 점유 칼럼',
    title: '남자 눈썹 반영구 티 안 나고 자연스러운 결 디자인 핵심',
    description: '남성 골격에 맞는 각진 옴므 아치 디자인과 숱 보강 테크닉 분석.',
    expectedOutcome: '맨즈 브로우 네이버 검색 유입 선점',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 350,
    stepsCount: 4,
    recommendedWhen: '남자 눈썹 검색 점유 시'
  },
  {
    id: 'mission_nav_06',
    category: 'NAVER_SEARCH_COLUMN',
    categoryName: '네이버 블로그 검색 점유 칼럼',
    title: '시술 당일 세안 방법 & 재생크림 도포 완벽 가이드',
    description: '시술 후 관리법 검색 고객을 우리 샵 잠재 고객으로 유치하는 정보성 칼럼.',
    expectedOutcome: '월간 검색 조회수 5,000+ 유입',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 320,
    stepsCount: 4,
    recommendedWhen: '대중적 롱테일 키워드 유입 시'
  },
  {
    id: 'mission_nav_07',
    category: 'NAVER_SEARCH_COLUMN',
    categoryName: '네이버 블로그 검색 점유 칼럼',
    title: '원장님 1:1 맞춤 시술 실제 사례 심층 분석 리포트',
    description: '실제 방문 고객의 골격 분석부터 디자인, 시술, 4주 후 리터치까지 전 과정 기록.',
    expectedOutcome: '고신뢰 기반 예약 전환율 60%',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 440,
    stepsCount: 6,
    recommendedWhen: '포트폴리오형 심층 칼럼 필요 시'
  },
  {
    id: 'mission_nav_08',
    category: 'NAVER_SEARCH_COLUMN',
    categoryName: '네이버 블로그 검색 점유 칼럼',
    title: '스마트에디터 ONE 서식 템플릿 표준화 & 네이버 검색 등록',
    description: '가독성이 뛰어난 네이버 블로그 전용 카드형 서식 및 검색 로봇 최적화.',
    expectedOutcome: '블로그 가독성 및 체류 시간 2배 증가',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 260,
    stepsCount: 3,
    recommendedWhen: '블로그 서식 디자인 정비 시'
  },

  // Category 8: 당근 동네생활 이웃 유입 (8건)
  {
    id: 'mission_daa_01',
    category: 'DAANGN_COMMUNITY',
    categoryName: '당근 동네생활 이웃 유입',
    title: '청라 이웃 한정 첫방문 1만원 할인 비즈쿠폰 발행',
    description: '당근 비즈프로필 동네 소식에 이웃 주민만을 위한 1만원 환영 쿠폰을 배포합니다.',
    expectedOutcome: '동네 이웃 신규 고객 4~6건 유입',
    targetChannels: ['DAANGN'],
    estimatedSC: 240,
    stepsCount: 3,
    recommendedWhen: '동네 단골을 빠르게 모으고 싶을 때'
  },
  {
    id: 'mission_daa_02',
    category: 'DAANGN_COMMUNITY',
    categoryName: '당근 동네생활 이웃 유입',
    title: '동네소식: "원장님이 직접 알려주는 쌩얼 메이크업 꿀팁"',
    description: '광고 느낌 없이 이웃에게 유익한 쌩얼 눈썹 정리 팁을 공유하여 호감도 구축.',
    expectedOutcome: '비즈프로필 단골 맺기 30+ 명 증가',
    targetChannels: ['DAANGN'],
    estimatedSC: 210,
    stepsCount: 3,
    recommendedWhen: '동네 친근감 및 단골 확보 시'
  },
  {
    id: 'mission_daa_03',
    category: 'DAANGN_COMMUNITY',
    categoryName: '당근 동네생활 이웃 유입',
    title: '주말 당근 번개 특가 (취소 슬롯 동네 알림)',
    description: '동네 주민이 30분 내 방문할 수 있는 특성을 활용한 실시간 번개 타임세일.',
    expectedOutcome: '급작스러운 당일 공실 100% 방어',
    targetChannels: ['DAANGN'],
    estimatedSC: 180,
    stepsCount: 2,
    recommendedWhen: '당일 공실이 발생했을 때'
  },
  {
    id: 'mission_daa_04',
    category: 'DAANGN_COMMUNITY',
    categoryName: '당근 동네생활 이웃 유입',
    title: '당근 비즈프로필 단골 100명 달성 감사 이벤트',
    description: '단골 등록 고객 전원에게 속눈썹 브러시 증정 및 추첨 시술권 지급.',
    expectedOutcome: '비즈프로필 지역 랭킹 상승',
    targetChannels: ['DAANGN'],
    estimatedSC: 250,
    stepsCount: 3,
    recommendedWhen: '단골 맺기 이벤트 진행 시'
  },
  {
    id: 'mission_daa_05',
    category: 'DAANGN_COMMUNITY',
    categoryName: '당근 동네생활 이웃 유입',
    title: '청라 직장인 퇴근길 1+1 동네 쿠폰북',
    description: '동네 주민끼리 함께 방문하면 각자 15% 할인받는 지역 친화 쿠폰.',
    expectedOutcome: '이웃 동반 예약 2쌍 유치',
    targetChannels: ['DAANGN'],
    estimatedSC: 270,
    stepsCount: 4,
    recommendedWhen: '지역 직장인 타깃 마케팅 시'
  },
  {
    id: 'mission_daa_06',
    category: 'DAANGN_COMMUNITY',
    categoryName: '당근 동네생활 이웃 유입',
    title: '동네 후기 캡처 공유: "원장님 손이 너무 꼼꼼해요"',
    description: '당근 이웃이 남겨주신 솔직 담백한 동네 후기 카드뉴스 배포.',
    expectedOutcome: '지역 신뢰도 및 즉각 채팅 문의 유치',
    targetChannels: ['DAANGN'],
    estimatedSC: 200,
    stepsCount: 3,
    recommendedWhen: '동네 후기 마케팅 필요 시'
  },
  {
    id: 'mission_daa_07',
    category: 'DAANGN_COMMUNITY',
    categoryName: '당근 동네생활 이웃 유입',
    title: '동네 소상공인 응원 서로돕기 쿠폰 교환',
    description: '인근 카페/베이커리 영수증 지참 시 5,000원 추가 혜택.',
    expectedOutcome: '지역 상권 상생 및 유입 다각화',
    targetChannels: ['DAANGN'],
    estimatedSC: 230,
    stepsCount: 3,
    recommendedWhen: '지역 연계 프로모션 시'
  },
  {
    id: 'mission_daa_08',
    category: 'DAANGN_COMMUNITY',
    categoryName: '당근 동네생활 이웃 유입',
    title: '당근 문의 응대 가이드 및 추천 답변 준비',
    description: '당근 채팅 문의에 빠르게 대처할 수 있도록 추천 답변과 예약 안내 가이드를 준비합니다.',
    expectedOutcome: '야간 문의 대응 체계 구축',
    targetChannels: ['DAANGN'],
    estimatedSC: 160,
    stepsCount: 2,
    recommendedWhen: '당근 채팅 문의 관리 시'
  },

  // Category 9: 경쟁사 방어 & 안티카피 (8건)
  {
    id: 'mission_com_01',
    category: 'COMPETITOR_DEFENSE',
    categoryName: '경쟁사 방어 & 안티카피',
    title: '우리 매장 고유 시술 기법 및 하네스 비법 지식재산권 보호',
    description: '타 매장의 시안 도용이나 문구 표절을 탐지하고 독창적인 브랜드 권위를 강화합니다.',
    expectedOutcome: '시술 독창성 방어 및 브랜드 가치 수호',
    targetChannels: ['INSTAGRAM', 'NAVER_BLOG'],
    estimatedSC: 310,
    stepsCount: 4,
    recommendedWhen: '인근 경쟁사 오픈 또는 카피 의심 시'
  },
  {
    id: 'mission_com_02',
    category: 'COMPETITOR_DEFENSE',
    categoryName: '경쟁사 방어 & 안티카피',
    title: '저가 덤핑 매장 대비 프리미엄 가치 차별화 설명서',
    description: '싸구려 공장형 시술과 1:1 골격 맞춤 장인 시술의 결과물 차이를 명확히 대조.',
    expectedOutcome: '가격 덤핑 경쟁 탈피 및 프리미엄 정가 고수',
    targetChannels: ['NAVER_BLOG', 'INSTAGRAM'],
    estimatedSC: 370,
    stepsCount: 5,
    recommendedWhen: '주변 저가 샵 출혈 경쟁 발생 시'
  },
  {
    id: 'mission_com_03',
    category: 'COMPETITOR_DEFENSE',
    categoryName: '경쟁사 방어 & 안티카피',
    title: '원장님 단독 1인 시술 100% 책임 보장제 선언',
    description: '알바나 초보 시술자 없이 원장님이 직접 처음부터 끝까지 책임지는 1인 샵 원칙 어필.',
    expectedOutcome: '1인 전문 샵 선호 고객 100% 흡수',
    targetChannels: ['INSTAGRAM', 'THREADS'],
    estimatedSC: 280,
    stepsCount: 4,
    recommendedWhen: '대형 공장형 샵과의 차별화 시'
  },
  {
    id: 'mission_com_04',
    category: 'COMPETITOR_DEFENSE',
    categoryName: '경쟁사 방어 & 안티카피',
    title: '경쟁사 대비 검색 키워드 SOV(점유율) 방어 칼럼',
    description: '핵심 상권 키워드에서 경쟁 매장이 상위를 차지하지 못하도록 점유율을 방어합니다.',
    expectedOutcome: '핵심 검색 키워드 관련 콘텐츠 노출 확대',
    targetChannels: ['NAVER_BLOG'],
    estimatedSC: 410,
    stepsCount: 5,
    recommendedWhen: '경쟁사 블로그 공세가 강할 때'
  },
  {
    id: 'mission_com_05',
    category: 'COMPETITOR_DEFENSE',
    categoryName: '경쟁사 방어 & 안티카피',
    title: '실제 시술 전후 무보정 원본 45도 동영상 릴스',
    description: '필터나 포토샵 없는 100% 무보정 실사 영상을 공개하여 가짜 사진 샵과의 격차 증명.',
    expectedOutcome: '무보정 진정성 신뢰 확보',
    targetChannels: ['INSTAGRAM'],
    estimatedSC: 350,
    stepsCount: 5,
    recommendedWhen: '진정성 기반 압도적 우위 선점 시'
  },
  {
    id: 'mission_com_06',
    category: 'COMPETITOR_DEFENSE',
    categoryName: '경쟁사 방어 & 안티카피',
    title: '시술 보증서 발급 & 무상 리터치 기간 명시',
    description: '결과에 자신 있는 매장만의 공식 시술 보증서 제도로 불안 심리 완전 제거.',
    expectedOutcome: '고객 신뢰도 1위 매장 포지셔닝',
    targetChannels: ['INSTAGRAM', 'NAVER_TALKTALK'],
    estimatedSC: 260,
    stepsCount: 3,
    recommendedWhen: '시술 보증 제도 홍보 시'
  },
  {
    id: 'mission_com_07',
    category: 'COMPETITOR_DEFENSE',
    categoryName: '경쟁사 방어 & 안티카피',
    title: '타 샵 부작용/불만족 고객을 위한 안심 구조대',
    description: '타 샵에서 짝짝이로 잘못 디자인된 눈썹을 바르게 교정한 임상 사례 리포트.',
    expectedOutcome: '실패 복원 고객의 독점적 유치',
    targetChannels: ['NAVER_BLOG', 'INSTAGRAM'],
    estimatedSC: 430,
    stepsCount: 6,
    recommendedWhen: '복원 전문 샵으로 포지셔닝 시'
  },
  {
    id: 'mission_com_08',
    category: 'COMPETITOR_DEFENSE',
    categoryName: '경쟁사 방어 & 안티카피',
    title: '소희 AI 4채널 상권 감시 레이더 가동 리포트',
    description: '주변 상권의 가격 변동, 신규 이벤트, 검색 순위 변동을 24시간 실시간 감시.',
    expectedOutcome: '상권 변화에 대한 선제적 대응 체계 구축',
    targetChannels: [],
    estimatedSC: 190,
    stepsCount: 3,
    recommendedWhen: '주간 상권 정기 브리핑 시'
  },

  // Category 10: 시즌 & 명절 프로모션 (8건)
  {
    id: 'mission_sea_01',
    category: 'SEASONAL_CAMPAIGN',
    categoryName: '시즌 & 명절 프로모션',
    title: '봄맞이 쌩얼 리셋 1:1 맞춤 브로우 페스티벌',
    description: '화사한 봄 시즌을 맞아 나들이와 여행을 준비하는 고객을 위한 풀 패키지 캠페인.',
    expectedOutcome: '봄 시즌 예약 20건 완판',
    targetChannels: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'],
    estimatedSC: 580,
    stepsCount: 6,
    recommendedWhen: '3~5월 봄 시즌 마케팅 시'
  },
  {
    id: 'mission_sea_02',
    category: 'SEASONAL_CAMPAIGN',
    categoryName: '시즌 & 명절 프로모션',
    title: '여름휴가 물놀이 워터프루프 쌩얼 안심 패키지',
    description: '물에 지워지지 않는 자연눈썹 + 틴팅 펌으로 바캉스 완벽 대비.',
    expectedOutcome: '여름 성수기 조기 예약 마감',
    targetChannels: ['INSTAGRAM', 'DAANGN', 'THREADS'],
    estimatedSC: 520,
    stepsCount: 5,
    recommendedWhen: '6~8월 여름 바캉스 시즌 시'
  },
  {
    id: 'mission_sea_03',
    category: 'SEASONAL_CAMPAIGN',
    categoryName: '시즌 & 명절 프로모션',
    title: '추석/설 명절 친척 모임 전 단정한 인상 케어',
    description: '명절 가족 모임에서 5살 어려 보이는 깔끔한 인상 완성 콤보.',
    expectedOutcome: '명절 직전 주간 풀 부킹',
    targetChannels: ['DAANGN', 'NAVER_BLOG', 'INSTAGRAM'],
    estimatedSC: 480,
    stepsCount: 5,
    recommendedWhen: '명절 D-14일 전 집중 홍보 시'
  },
  {
    id: 'mission_sea_04',
    category: 'SEASONAL_CAMPAIGN',
    categoryName: '시즌 & 명절 프로모션',
    title: '연말연시 송년회/파티 돋보이는 뷰티 업그레이드',
    description: '연말 모임에서 시선을 사로잡는 입체 섀도우 브로우 & 또렷한 눈매 완성.',
    expectedOutcome: '12월 연말 슬롯 100% 매진',
    targetChannels: ['INSTAGRAM', 'THREADS'],
    estimatedSC: 490,
    stepsCount: 5,
    recommendedWhen: '11~12월 연말 모임 시즌 시'
  },
  {
    id: 'mission_sea_05',
    category: 'SEASONAL_CAMPAIGN',
    categoryName: '시즌 & 명절 프로모션',
    title: '수능 끝! 수험생 & 학부모 동반 힐링 뷰티 혜택',
    description: '수험표 지참 시 수험생 및 고생하신 어머니 20% 특별 할인.',
    expectedOutcome: '수능 직후 신규 유입 10건 창출',
    targetChannels: ['INSTAGRAM', 'DAANGN'],
    estimatedSC: 460,
    stepsCount: 5,
    recommendedWhen: '11월 수능 직후 시'
  },
  {
    id: 'mission_sea_06',
    category: 'SEASONAL_CAMPAIGN',
    categoryName: '시즌 & 명절 프로모션',
    title: '새 학기/새 출발 3월 개강 맞춤 첫인상 메이커',
    description: '새로운 학교/직장으로 출발하는 2030 세대를 위한 단정 스마트 브로우.',
    expectedOutcome: '20대 신규 고객 예약 8건 유치',
    targetChannels: ['INSTAGRAM', 'THREADS'],
    estimatedSC: 430,
    stepsCount: 4,
    recommendedWhen: '2~3월 신학기 시즌 시'
  },
  {
    id: 'mission_sea_07',
    category: 'SEASONAL_CAMPAIGN',
    categoryName: '시즌 & 명절 프로모션',
    title: '어버이날 효도 선물: 부모님 회춘 브로우 모녀 패키지',
    description: '어머니, 아버지의 처진 눈썹을 자연스럽게 리프팅해 드리는 감동 선물.',
    expectedOutcome: '가정의 달 패키지 5세트 판매',
    targetChannels: ['DAANGN', 'INSTAGRAM', 'NAVER_BLOG'],
    estimatedSC: 510,
    stepsCount: 5,
    recommendedWhen: '5월 가정의 달 시'
  },
  {
    id: 'mission_sea_08',
    category: 'SEASONAL_CAMPAIGN',
    categoryName: '시즌 & 명절 프로모션',
    title: '블랙 프라이데이 / 연중 최대 혜택 슈퍼 위크',
    description: '연중 딱 한 번 진행하는 한정 수량 선불권 및 시술 패키지 슈퍼위크.',
    expectedOutcome: '주간 최고 매출 신기록 달성',
    targetChannels: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN', 'KAKAO'],
    estimatedSC: 650,
    stepsCount: 6,
    recommendedWhen: '11월 블랙프라이데이 시즌 시'
  }
]

