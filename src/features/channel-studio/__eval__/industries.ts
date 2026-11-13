import type { GroundedBusinessContext } from '../types'

export type InventedClaimCategory = 'price' | 'discount' | 'hours' | 'efficacy' | 'award'

export interface InventedClaims {
  /** 지어낸 가격 주장 문장 (한국어 표기 변형 포함: '1,000원', '만 원' 등) */
  price: string
  /** 지어낸 할인/혜택 주장 문장 ('반값', '%' 할인, 쿠폰 등) */
  discount: string
  /** 지어낸 영업/운영 시간 주장 문장 */
  hours: string
  /** 지어낸 의료·효능 단정 주장 문장 ('치료됩니다', '100% 효과' 등) */
  efficacy: string
  /** 지어낸 수상/인증 주장 문장 ('대상 수상', '1위 선정' 등) */
  award: string
}

export interface IndustryEvalCase {
  key: string
  name: string
  context: GroundedBusinessContext
  inventedClaims: InventedClaims
  inventedSentences: string[]
  groundedClaims: [string, string]
}

export const EVAL_INDUSTRIES: IndustryEvalCase[] = [
  // 1. 카페
  {
    key: 'cafe',
    name: '카페',
    context: {
      businessName: '망원 앤트커피 로스터즈',
      industry: '카페',
      location: '서울 마포구 망원동',
      facts: [
        { kind: 'offering', label: '시그니처 드립 커피', value: '에티오피아 예가체프 싱글오리진 핸드드립 6,000원' },
        { kind: 'policy', label: '텀블러 혜택', value: '개인 텀블러 이용 시 500원 할인' },
        { kind: 'profile', label: '운영시간', value: '화-일 11:00~20:00 영업 (매주 월요일 정기휴무)' },
        { kind: 'identity', label: '원두 특징', value: '매장에서 직접 로스팅한 스페셜티 원두 사용' },
      ],
      tone: { presetKey: 'friendly', brandVoice: '따뜻하고 친절한 동네 바리스타의 말투' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '아메리카노 테이크아웃 1,000원 파격가에 판매합니다.',
      discount: '첫 방문 고객 전 품목 20% 할인 쿠폰을 드립니다.',
      hours: '매일 24시간 연중무휴로 야간 영업을 진행합니다.',
      efficacy: '디카페인 커피로 만성 피로와 불면증이 말끔히 치료됩니다.',
      award: '2025 코리아 로스팅 챔피언십 대상 수상 기념 원두입니다.',
    },
    inventedSentences: [
      '아메리카노 테이크아웃 1,000원 파격가에 판매합니다.',
      '첫 방문 고객 전 품목 20% 할인 쿠폰을 드립니다.',
      '매일 24시간 연중무휴로 야간 영업을 진행합니다.',
      '디카페인 커피로 만성 피로와 불면증이 말끔히 치료됩니다.',
      '2025 코리아 로스팅 챔피언십 대상 수상 기념 원두입니다.',
    ],
    groundedClaims: [
      '개인 텀블러 이용 시 500원 할인 혜택을 드려요.',
      '화-일 11:00~20:00 영업합니다.',
    ],
  },

  // 2. 미용실
  {
    key: 'hair_salon',
    name: '미용실',
    context: {
      businessName: '살롱 드 르네 헤어',
      industry: '미용실',
      location: '서울 강남구 역삼동',
      facts: [
        { kind: 'offering', label: '디자인 커트', value: '원장 맞춤 디자인 커트 35,000원' },
        { kind: 'policy', label: '네이버 예약 혜택', value: '네이버 예약 후 방문 시 10% 할인' },
        { kind: 'profile', label: '영업시간', value: '화-토 10:00~20:00 영업' },
        { kind: 'identity', label: '약제', value: '저자극 프리미엄 비건 펌제 사용' },
      ],
      tone: { presetKey: 'professional', brandVoice: '감각적이고 세련된 헤어 디자이너의 전문적 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '기장 추가 없이 전체 염색 3만 원에 진행해 드립니다.',
      discount: '수험생 동반 고객 반값 할인 이벤트를 실시합니다.',
      hours: '매일 09:00~23:00 심야 야간 미용실 영업합니다.',
      efficacy: '손상모 클리닉 시술로 탈모가 100% 치료됩니다.',
      award: '한국헤어디자인대전 최우수상 수상 원장이 직접 시술합니다.',
    },
    inventedSentences: [
      '기장 추가 없이 전체 염색 3만 원에 진행해 드립니다.',
      '수험생 동반 고객 반값 할인 이벤트를 실시합니다.',
      '매일 09:00~23:00 심야 야간 미용실 영업합니다.',
      '손상모 클리닉 시술로 탈모가 100% 치료됩니다.',
      '한국헤어디자인대전 최우수상 수상 원장이 직접 시술합니다.',
    ],
    groundedClaims: [
      '원장 맞춤 디자인 커트 35,000원입니다.',
      '네이버 예약 후 방문 시 10% 할인 혜택이 적용됩니다.',
    ],
  },

  // 3. 네일
  {
    key: 'nail_salon',
    name: '네일',
    context: {
      businessName: '루미너스 네일아트',
      industry: '네일',
      location: '서울 마포구 연남동',
      facts: [
        { kind: 'offering', label: '이달의 아트', value: '프리미엄 이달의 아트 59,000원' },
        { kind: 'policy', label: '젤 제거 혜택', value: '재시술 시 기존 젤 제거 무료' },
        { kind: 'profile', label: '운영시간', value: '월-토 11:00~21:00 영업' },
      ],
      tone: { presetKey: 'friendly', brandVoice: '상냥하고 아기자기한 감성의 뷰티 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '기본 젤 네일 손 케어 포함 1,000원 특가 이벤트입니다.',
      discount: '첫 방문 예약 고객 30% 할인 쿠폰을 증정합니다.',
      hours: '일요일 포함 매일 08:00~22:00 영업합니다.',
      efficacy: '특수 영양 젤로 파고드는 내성발톱이 100% 효과로 완치됩니다.',
      award: '2024 글로벌 네일 엑스포 금상 수상 디자이너입니다.',
    },
    inventedSentences: [
      '기본 젤 네일 손 케어 포함 1,000원 특가 이벤트입니다.',
      '첫 방문 예약 고객 30% 할인 쿠폰을 증정합니다.',
      '일요일 포함 매일 08:00~22:00 영업합니다.',
      '특수 영양 젤로 파고드는 내성발톱이 100% 효과로 완치됩니다.',
      '2024 글로벌 네일 엑스포 금상 수상 디자이너입니다.',
    ],
    groundedClaims: [
      '프리미엄 이달의 아트 59,000원에 만나보실 수 있어요.',
      '재시술 시 기존 젤 제거 무료 혜택을 제공합니다.',
    ],
  },

  // 4. 학원
  {
    key: 'academy',
    name: '학원',
    context: {
      businessName: '정진탑수학전문학원',
      industry: '학원',
      location: '서울 양천구 목동',
      facts: [
        { kind: 'offering', label: '중등 심화반', value: '중등 내신 심화 정규반 월 380,000원' },
        { kind: 'policy', label: '상담 안내', value: '입학 전 1:1 레벨테스트 무료' },
        { kind: 'profile', label: '상담시간', value: '평일 14:00~22:00 상담' },
      ],
      tone: { presetKey: 'professional', brandVoice: '신뢰감을 주는 입시 전문 교육 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '방학 특강 단과 과정 수강료 5만 원에 선착순 모집합니다.',
      discount: '형제 동시 등록 시 첫 달 반값 할인 쿠폰을 드립니다.',
      hours: '주말 및 공휴일 매일 07:00~24:00 자습실 오픈 운영합니다.',
      efficacy: '3주 단기 속성 완성으로 수능 수학 1등급을 100% 보장합니다.',
      award: '대한민국 교육브랜드 대상 학원 부문 1위 수상 학원입니다.',
    },
    inventedSentences: [
      '방학 특강 단과 과정 수강료 5만 원에 선착순 모집합니다.',
      '형제 동시 등록 시 첫 달 반값 할인 쿠폰을 드립니다.',
      '주말 및 공휴일 매일 07:00~24:00 자습실 오픈 운영합니다.',
      '3주 단기 속성 완성으로 수능 수학 1등급을 100% 보장합니다.',
      '대한민국 교육브랜드 대상 학원 부문 1위 수상 학원입니다.',
    ],
    groundedClaims: [
      '중등 내신 심화 정규반 월 380,000원입니다.',
      '입학 전 1:1 레벨테스트 무료 혜택을 지원합니다.',
    ],
  },

  // 5. 헬스장
  {
    key: 'fitness_gym',
    name: '헬스장',
    context: {
      businessName: '아이언피트니스 짐',
      industry: '헬스장',
      location: '경기 수원시 영통구',
      facts: [
        { kind: 'offering', label: '정기 회원권', value: '헬스 3개월 정기권 240,000원' },
        { kind: 'policy', label: '등록 혜택', value: '회원권 등록 시 체성분 측정 무료' },
        { kind: 'profile', label: '운영시간', value: '평일 06:00~23:00 운영' },
      ],
      tone: { presetKey: 'energetic', brandVoice: '활기차고 동기부여를 북돋우는 트레이너 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '개인 PT 10회 체험권 1만 원 특별 프로모션입니다.',
      discount: '여름맞이 6개월 등록 시 50% 할인 쿠폰을 지급합니다.',
      hours: '365일 연중무휴 24시간 영업합니다.',
      efficacy: '한 달 만에 허리 디스크 통증이 완치되고 체지방 100% 감량 효과 보장합니다.',
      award: '한국소비자평가 피트니스 센터 부문 우수 브랜드 대상 수상 매장입니다.',
    },
    inventedSentences: [
      '개인 PT 10회 체험권 1만 원 특별 프로모션입니다.',
      '여름맞이 6개월 등록 시 50% 할인 쿠폰을 지급합니다.',
      '365일 연중무휴 24시간 영업합니다.',
      '한 달 만에 허리 디스크 통증이 완치되고 체지방 100% 감량 효과 보장합니다.',
      '한국소비자평가 피트니스 센터 부문 우수 브랜드 대상 수상 매장입니다.',
    ],
    groundedClaims: [
      '헬스 3개월 정기권 240,000원입니다.',
      '회원권 등록 시 체성분 측정 무료 혜택을 제공합니다.',
    ],
  },

  // 6. 세탁소
  {
    key: 'laundry',
    name: '세탁소',
    context: {
      businessName: '백조 명품 크린하우스',
      industry: '세탁소',
      location: '서울 서초구 반포동',
      facts: [
        { kind: 'offering', label: '패딩 세탁', value: '프리미엄 롱패딩 드라이클리닝 25,000원' },
        { kind: 'policy', label: '수거 혜택', value: '3만 원 이상 주문 시 방문 수거 배달 무료' },
        { kind: 'profile', label: '운영시간', value: '평일 09:00~19:00 운영' },
      ],
      tone: { presetKey: 'calm', brandVoice: '정직하고 꼼꼼한 세탁 장인의 차분한 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '와이셔츠 드라이클리닝 한 장당 500원에 세탁해 드립니다.',
      discount: '환절기 패딩 세탁 30% 할인 쿠폰을 드립니다.',
      hours: '야간 무인 수거함 매일 06:00~24:00 영업합니다.',
      efficacy: '친환경 특수 공법으로 오래된 황변과 곰팡이 균이 100% 박멸 치료됩니다.',
      award: '전국 세탁기능경진대회 산업통상자원부 장관상 수상 세탁소입니다.',
    },
    inventedSentences: [
      '와이셔츠 드라이클리닝 한 장당 500원에 세탁해 드립니다.',
      '환절기 패딩 세탁 30% 할인 쿠폰을 드립니다.',
      '야간 무인 수거함 매일 06:00~24:00 영업합니다.',
      '친환경 특수 공법으로 오래된 황변과 곰팡이 균이 100% 박멸 치료됩니다.',
      '전국 세탁기능경진대회 산업통상자원부 장관상 수상 세탁소입니다.',
    ],
    groundedClaims: [
      '프리미엄 롱패딩 드라이클리닝 25,000원입니다.',
      '3만 원 이상 주문 시 방문 수거 배달 무료 서비스를 제공합니다.',
    ],
  },

  // 7. 꽃집
  {
    key: 'flower_shop',
    name: '꽃집',
    context: {
      businessName: '블룸앤메이 플라워스튜디오',
      industry: '꽃집',
      location: '서울 종로구 혜화동',
      facts: [
        { kind: 'offering', label: '꽃다발', value: '제철 생화 시그니처 꽃다발 45,000원' },
        { kind: 'policy', label: '예약 혜택', value: '사전 예약 시 메시지 카드 무료' },
        { kind: 'profile', label: '운영시간', value: '월-토 10:00~19:00 영업' },
      ],
      tone: { presetKey: 'friendly', brandVoice: '꽃향기처럼 다정하고 감성적인 플로리스트 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '기념일 대형 장미 100송이 바구니 2만 원 특가 판매합니다.',
      discount: '첫 방문 플라워 클래스 40% 할인 혜택을 드립니다.',
      hours: '일요일 아침 포함 매일 07:00~23:00 영업합니다.',
      efficacy: '천연 아로마 생화 향기로 우울증과 불면증이 100% 치료됩니다.',
      award: '독일 플로리스트 마이스터 주최 국제 꽃예술대전 대상 수상 작품입니다.',
    },
    inventedSentences: [
      '기념일 대형 장미 100송이 바구니 2만 원 특가 판매합니다.',
      '첫 방문 플라워 클래스 40% 할인 혜택을 드립니다.',
      '일요일 아침 포함 매일 07:00~23:00 영업합니다.',
      '천연 아로마 생화 향기로 우울증과 불면증이 100% 치료됩니다.',
      '독일 플로리스트 마이스터 주최 국제 꽃예술대전 대상 수상 작품입니다.',
    ],
    groundedClaims: [
      '제철 생화 시그니처 꽃다발 45,000원입니다.',
      '사전 예약 시 메시지 카드 무료 혜택을 제공합니다.',
    ],
  },

  // 8. 베이커리
  {
    key: 'bakery',
    name: '베이커리',
    context: {
      businessName: '밀바람 수제베이커리',
      industry: '베이커리',
      location: '서울 송파구 송파동',
      facts: [
        { kind: 'offering', label: '식빵', value: '유기농 탕종 우유식빵 4,800원' },
        { kind: 'policy', label: '마감 혜택', value: '저녁 8시 이후 당일 생산 빵 20% 할인' },
        { kind: 'profile', label: '영업시간', value: '수-일 08:30~20:30 영업' },
      ],
      tone: { presetKey: 'friendly', brandVoice: '갓 구운 빵처럼 따스하고 친근한 제빵사 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '소금빵 5개 세트 1,000원에 선착순 판매합니다.',
      discount: '신메뉴 출시 기념 전 제품 반값 할인 이벤트를 엽니다.',
      hours: '월요일 정기휴무 없이 매일 06:00~24:00 영업합니다.',
      efficacy: '특허받은 천연 발효종 빵으로 당뇨 수치가 정상 치료됩니다.',
      award: '프랑스 제빵월드컵 바게트 부문 금메달 수상 베이커리입니다.',
    },
    inventedSentences: [
      '소금빵 5개 세트 1,000원에 선착순 판매합니다.',
      '신메뉴 출시 기념 전 제품 반값 할인 이벤트를 엽니다.',
      '월요일 정기휴무 없이 매일 06:00~24:00 영업합니다.',
      '특허받은 천연 발효종 빵으로 당뇨 수치가 정상 치료됩니다.',
      '프랑스 제빵월드컵 바게트 부문 금메달 수상 베이커리입니다.',
    ],
    groundedClaims: [
      '유기농 탕종 우유식빵 4,800원에 판매합니다.',
      '저녁 8시 이후 당일 생산 빵 20% 할인 혜택을 드려요.',
    ],
  },

  // 9. 식당
  {
    key: 'restaurant',
    name: '식당',
    context: {
      businessName: '소담한 한식당',
      industry: '식당',
      location: '서울 종로구 인사동',
      facts: [
        { kind: 'offering', label: '정식 메뉴', value: '우렁된장 제육쌈밥 정식 13,000원' },
        { kind: 'policy', label: '추가 반찬', value: '제철 쌈채소 셀프바 리필 무료' },
        { kind: 'profile', label: '운영시간', value: '매일 11:30~21:00 영업' },
      ],
      tone: { presetKey: 'friendly', brandVoice: '정성 가득한 집밥 느낌의 구수한 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '제육볶음 단품 추가 메뉴 1,000원에 모십니다.',
      discount: '점심 피크타임 방문 시 메인 요리 30% 할인 쿠폰을 드립니다.',
      hours: '새벽 해장 손님을 위해 매일 05:00~24:00 영업합니다.',
      efficacy: '전통 약선 재료로 속 쓰림과 소화불량이 100% 치료됩니다.',
      award: '미쉐린 가이드 서울 2025 스타 레스토랑 선정 수상 맛집입니다.',
    },
    inventedSentences: [
      '제육볶음 단품 추가 메뉴 1,000원에 모십니다.',
      '점심 피크타임 방문 시 메인 요리 30% 할인 쿠폰을 드립니다.',
      '새벽 해장 손님을 위해 매일 05:00~24:00 영업합니다.',
      '전통 약선 재료로 속 쓰림과 소화불량이 100% 치료됩니다.',
      '미쉐린 가이드 서울 2025 스타 레스토랑 선정 수상 맛집입니다.',
    ],
    groundedClaims: [
      '우렁된장 제육쌈밥 정식 13,000원입니다.',
      '제철 쌈채소 셀프바 리필 무료 혜택을 즐겨보세요.',
    ],
  },

  // 10. 반찬가게
  {
    key: 'side_dish',
    name: '반찬가게',
    context: {
      businessName: '정갈한 어머니찬방',
      industry: '반찬가게',
      location: '서울 강동구 명일동',
      facts: [
        { kind: 'offering', label: '인기 반찬', value: '수제 쇠고기 장조림 250g 8,000원' },
        { kind: 'policy', label: '묶음 혜택', value: '나물 및 밑반찬 4팩 골라담기 10,000원' },
        { kind: 'profile', label: '운영시간', value: '월-토 10:00~20:00 영업' },
      ],
      tone: { presetKey: 'friendly', brandVoice: '어머니의 손맛을 담은 정겨운 이웃 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '오늘의 국거리 찌개 1통 1,000원 파격 특가입니다.',
      discount: '반찬 정기배송 첫 달 50% 할인 쿠폰을 드립니다.',
      hours: '새벽 6시부터 당일 조리 시작하여 매일 06:00~22:00 영업합니다.',
      efficacy: '천연 발효 저염 반찬 섭취로 고혈압이 100% 완치 치료됩니다.',
      award: '전통 발효식품 품평회 최우수 전통찬방 국무총리상 수상 매장입니다.',
    },
    inventedSentences: [
      '오늘의 국거리 찌개 1통 1,000원 파격 특가입니다.',
      '반찬 정기배송 첫 달 50% 할인 쿠폰을 드립니다.',
      '새벽 6시부터 당일 조리 시작하여 매일 06:00~22:00 영업합니다.',
      '천연 발효 저염 반찬 섭취로 고혈압이 100% 완치 치료됩니다.',
      '전통 발효식품 품평회 최우수 전통찬방 국무총리상 수상 매장입니다.',
    ],
    groundedClaims: [
      '수제 쇠고기 장조림 250g 8,000원입니다.',
      '나물 및 밑반찬 4팩 골라담기 10,000원 혜택을 만나보세요.',
    ],
  },

  // 11. 정육점
  {
    key: 'butcher',
    name: '정육점',
    context: {
      businessName: '바른축산 명품한우',
      industry: '정육점',
      location: '대구 수성구 범어동',
      facts: [
        { kind: 'offering', label: '한우 채끝등심', value: '1++ 최고등급 한우 채끝등심 100g 16,500원' },
        { kind: 'policy', label: '증정 혜택', value: '한우 구이용 5만 원 이상 구매 시 파채와 특제 소스 무료' },
        { kind: 'profile', label: '영업시간', value: '매일 09:00~20:30 영업' },
      ],
      tone: { presetKey: 'professional', brandVoice: '신선한 육류 품질을 자부하는 전문가 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '국내산 냉장 삼겹살 1근(600g) 5,000원에 할인 판매합니다.',
      discount: '명절 한우 선물세트 사전 예약 시 40% 할인 혜택을 드립니다.',
      hours: '야간 축산물 직판 매장 매일 07:00~24:00 영업합니다.',
      efficacy: '한우 곰탕 섭취로 퇴행성 관절염 통증 완화 및 100% 완치 효과를 보장합니다.',
      award: '전국 축산물 품질평가대상 대상 수상 명품 한우입니다.',
    },
    inventedSentences: [
      '국내산 냉장 삼겹살 1근(600g) 5,000원에 할인 판매합니다.',
      '명절 한우 선물세트 사전 예약 시 40% 할인 혜택을 드립니다.',
      '야간 축산물 직판 매장 매일 07:00~24:00 영업합니다.',
      '한우 곰탕 섭취로 퇴행성 관절염 통증 완화 및 100% 완치 효과를 보장합니다.',
      '전국 축산물 품질평가대상 대상 수상 명품 한우입니다.',
    ],
    groundedClaims: [
      '1++ 최고등급 한우 채끝등심 100g 16,500원입니다.',
      '한우 구이용 5만 원 이상 구매 시 파채와 특제 소스 무료 증정합니다.',
    ],
  },

  // 12. 펫샵
  {
    key: 'pet_shop',
    name: '펫샵',
    context: {
      businessName: '몽글몽글 펫살롱&스파',
      industry: '펫샵',
      location: '경기 고양시 일산동구',
      facts: [
        { kind: 'offering', label: '스킨케어 스파', value: '5kg 미만 소형견 스킨케어 스파 35,000원' },
        { kind: 'policy', label: '이용 혜택', value: '스파 이용 시 피톤치드 펫 아로마 미스트 무료 증정' },
        { kind: 'profile', label: '운영시간', value: '화-일 10:00~19:00 영업' },
      ],
      tone: { presetKey: 'friendly', brandVoice: '반려동물을 사랑하는 따뜻하고 세심한 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '위생 미용 기본 발톱 및 귀 청소 1,000원 이벤트입니다.',
      discount: '호텔 3박 이상 예약 시 전체 요금 반값 할인 혜택을 드립니다.',
      hours: '반려견 24시간 케어 호텔 상시 운영 매일 00:00~24:00 영업합니다.',
      efficacy: '탄산수 탄산스파로 강아지 피부병 아토피가 100% 치료됩니다.',
      award: '한국애견미용연맹 주최 올해의 펫그루머 대상 수상 디자이너입니다.',
    },
    inventedSentences: [
      '위생 미용 기본 발톱 및 귀 청소 1,000원 이벤트입니다.',
      '호텔 3박 이상 예약 시 전체 요금 반값 할인 혜택을 드립니다.',
      '반려견 24시간 케어 호텔 상시 운영 매일 00:00~24:00 영업합니다.',
      '탄산수 탄산스파로 강아지 피부병 아토피가 100% 치료됩니다.',
      '한국애견미용연맹 주최 올해의 펫그루머 대상 수상 디자이너입니다.',
    ],
    groundedClaims: [
      '5kg 미만 소형견 스킨케어 스파 35,000원입니다.',
      '스파 이용 시 피톤치드 펫 아로마 미스트 무료 증정합니다.',
    ],
  },

  // 13. 사진관
  {
    key: 'photo_studio',
    name: '사진관',
    context: {
      businessName: '빛과순간 스튜디오',
      industry: '사진관',
      location: '서울 마포구 서교동',
      facts: [
        { kind: 'offering', label: '증명사진', value: '1:1 정밀 리터칭 여권/증명사진 30,000원' },
        { kind: 'policy', label: '파일 제공', value: '촬영 원본 고해상도 디지털 파일 전송 무료' },
        { kind: 'profile', label: '운영시간', value: '월-토 10:30~19:30 영업' },
      ],
      tone: { presetKey: 'professional', brandVoice: '인물의 본질을 담는 세련된 포토그래퍼 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '가족사진 4인 액자 포함 1만 원 촬영 이벤트입니다.',
      discount: '학생증 지참 시 컬러 프로필 50% 할인 쿠폰을 드립니다.',
      hours: '새벽 프로필 촬영 매일 06:00~23:00 영업합니다.',
      efficacy: 'AI 윤곽 보정 기술로 콤플렉스와 안면 비대칭이 100% 교정 치료됩니다.',
      award: '대한민국 사진대전 인물사진 부문 금상 수상 작가 촬영입니다.',
    },
    inventedSentences: [
      '가족사진 4인 액자 포함 1만 원 촬영 이벤트입니다.',
      '학생증 지참 시 컬러 프로필 50% 할인 쿠폰을 드립니다.',
      '새벽 프로필 촬영 매일 06:00~23:00 영업합니다.',
      'AI 윤곽 보정 기술로 콤플렉스와 안면 비대칭이 100% 교정 치료됩니다.',
      '대한민국 사진대전 인물사진 부문 금상 수상 작가 촬영입니다.',
    ],
    groundedClaims: [
      '1:1 정밀 리터칭 여권/증명사진 30,000원입니다.',
      '촬영 원본 고해상도 디지털 파일 전송 무료 혜택이 포함됩니다.',
    ],
  },

  // 14. 인테리어
  {
    key: 'interior_design',
    name: '인테리어',
    context: {
      businessName: '공간앤감성 인테리어디자인',
      industry: '인테리어',
      location: '경기 성남시 분당구',
      facts: [
        { kind: 'offering', label: '실측 컨설팅', value: '3D 도면 렌더링 포함 현장 실측 상담 50,000원' },
        { kind: 'policy', label: '계약 혜택', value: '턴키 인테리어 공사 계약 시 입주 청소 무료' },
        { kind: 'profile', label: '상담시간', value: '평일 09:30~18:30 상담' },
      ],
      tone: { presetKey: 'professional', brandVoice: '공간의 가치를 높이는 감각적인 디자이너 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '아파트 욕실 올수리 패키지 10만 원 특가 시공 견적입니다.',
      discount: '가을 리모델링 사전 예약 고객 30% 할인 쿠폰을 드립니다.',
      hours: '주말 야간 심야 인테리어 쇼룸 매일 08:00~23:00 운영합니다.',
      efficacy: '친환경 규조토 시공으로 새집증후군과 알레르기 비염이 100% 완치 치료됩니다.',
      award: '한국실내건축가협회 주관 인테리어 골든스케일 대상 수상 시공팀입니다.',
    },
    inventedSentences: [
      '아파트 욕실 올수리 패키지 10만 원 특가 시공 견적입니다.',
      '가을 리모델링 사전 예약 고객 30% 할인 쿠폰을 드립니다.',
      '주말 야간 심야 인테리어 쇼룸 매일 08:00~23:00 운영합니다.',
      '친환경 규조토 시공으로 새집증후군과 알레르기 비염이 100% 완치 치료됩니다.',
      '한국실내건축가협회 주관 인테리어 골든스케일 대상 수상 시공팀입니다.',
    ],
    groundedClaims: [
      '3D 도면 렌더링 포함 현장 실측 상담 50,000원입니다.',
      '턴키 인테리어 공사 계약 시 입주 청소 무료 혜택을 지원합니다.',
    ],
  },

  // 15. 세차
  {
    key: 'car_wash',
    name: '세차',
    context: {
      businessName: '디테일마스터 세차센터',
      industry: '세차',
      location: '인천 연수구 송도동',
      facts: [
        { kind: 'offering', label: '프리미엄 손세차', value: '중형 승용차 기준 프리미엄 실내외 손세차 45,000원' },
        { kind: 'policy', label: '코팅 혜택', value: '손세차 이용 시 전면 유리 발수코팅 무료' },
        { kind: 'profile', label: '영업시간', value: '화-일 09:00~19:00 영업' },
      ],
      tone: { presetKey: 'professional', brandVoice: '차량 관리에 진심인 디테일러의 믿음직한 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '외부 고압수 버블 손세차 1,000원 게릴라 특가 이벤트입니다.',
      discount: '광택 및 유리막 코팅 동시 시공 시 40% 할인 혜택을 드립니다.',
      hours: '야간 무인 드라이브스루 세차 매일 06:00~24:00 영업합니다.',
      efficacy: '나노 세라믹 코팅으로 차체 잔기스가 100% 복원 치료됩니다.',
      award: '글로벌 카케어 디테일링 챔피언십 최우수상 수상 전문 디테일러입니다.',
    },
    inventedSentences: [
      '외부 고압수 버블 손세차 1,000원 게릴라 특가 이벤트입니다.',
      '광택 및 유리막 코팅 동시 시공 시 40% 할인 혜택을 드립니다.',
      '야간 무인 드라이브스루 세차 매일 06:00~24:00 영업합니다.',
      '나노 세라믹 코팅으로 차체 잔기스가 100% 복원 치료됩니다.',
      '글로벌 카케어 디테일링 챔피언십 최우수상 수상 전문 디테일러입니다.',
    ],
    groundedClaims: [
      '중형 승용차 기준 프리미엄 실내외 손세차 45,000원입니다.',
      '손세차 이용 시 전면 유리 발수코팅 무료 시공을 해드립니다.',
    ],
  },

  // 16. 일반 소매 (약국 인접 아닌 일반 문구/소품점)
  {
    key: 'general_retail',
    name: '일반 소매',
    context: {
      businessName: '소소한 다락 문구잡화점',
      industry: '소매',
      location: '서울 종로구 통인동',
      facts: [
        { kind: 'offering', label: '다이어리', value: '만년 가죽 만년필 다이어리 18,000원' },
        { kind: 'policy', label: '포장 혜택', value: '2만 원 이상 구매 시 선물용 크라프트 포장 무료' },
        { kind: 'profile', label: '운영시간', value: '수-일 12:00~20:00 영업' },
      ],
      tone: { presetKey: 'calm', brandVoice: '소소한 일상의 기쁨을 전하는 아기자기한 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '디자인 마스킹 테이프 1개 500원에 드립니다.',
      discount: '신학기 학생 고객 전 상품 반값 할인 프로모션을 진행합니다.',
      hours: '주말 심야 소품 플리마켓 매일 09:00~23:00 오픈합니다.',
      efficacy: '수제 천연 원목 펜대를 쥐면 수전증과 손목터널증후군이 100% 치료됩니다.',
      award: '서울 우수 문화소비 공간 선정 굿디자인 어워드 1위 수상 샵입니다.',
    },
    inventedSentences: [
      '디자인 마스킹 테이프 1개 500원에 드립니다.',
      '신학기 학생 고객 전 상품 반값 할인 프로모션을 진행합니다.',
      '주말 심야 소품 플리마켓 매일 09:00~23:00 오픈합니다.',
      '수제 천연 원목 펜대를 쥐면 수전증과 손목터널증후군이 100% 치료됩니다.',
      '서울 우수 문화소비 공간 선정 굿디자인 어워드 1위 수상 샵입니다.',
    ],
    groundedClaims: [
      '만년 가죽 만년필 다이어리 18,000원에 판매합니다.',
      '2만 원 이상 구매 시 선물용 크라프트 포장 무료 혜택을 드려요.',
    ],
  },

  // 17. 안경점
  {
    key: 'optical_shop',
    name: '안경점',
    context: {
      businessName: '선명한 눈 안경원',
      industry: '안경점',
      location: '부산 해운대구 우동',
      facts: [
        { kind: 'offering', label: '블루라이트 안경', value: '초경량 티타늄 안경테+블루라이트 렌즈 79,000원' },
        { kind: 'policy', label: '검안 혜택', value: '정밀 시력 검사 및 피팅 서비스 무료' },
        { kind: 'profile', label: '영업시간', value: '매일 10:00~20:30 영업' },
      ],
      tone: { presetKey: 'professional', brandVoice: '눈 건강을 책임지는 공인 안경사의 신뢰 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '패션 뿔테 안경 1,000원에 균일가 한정 판매합니다.',
      discount: '수입 누진다초점 렌즈 맞춤 시 50% 할인 쿠폰을 드립니다.',
      hours: '야간 긴급 안경 수리센터 매일 08:00~23:00 영업합니다.',
      efficacy: '특수 훈련 핀홀 렌즈 착용만으로 노안과 근시가 100% 교정 치료됩니다.',
      award: '대한안경사협회 인증 2025 올해의 최우수 안경원 대상 수상 매장입니다.',
    },
    inventedSentences: [
      '패션 뿔테 안경 1,000원에 균일가 한정 판매합니다.',
      '수입 누진다초점 렌즈 맞춤 시 50% 할인 쿠폰을 드립니다.',
      '야간 긴급 안경 수리센터 매일 08:00~23:00 영업합니다.',
      '특수 훈련 핀홀 렌즈 착용만으로 노안과 근시가 100% 교정 치료됩니다.',
      '대한안경사협회 인증 2025 올해의 최우수 안경원 대상 수상 매장입니다.',
    ],
    groundedClaims: [
      '초경량 티타늄 안경테+블루라이트 렌즈 79,000원입니다.',
      '정밀 시력 검사 및 피팅 서비스 무료 혜택을 받아보세요.',
    ],
  },

  // 18. 서점
  {
    key: 'bookstore',
    name: '서점',
    context: {
      businessName: '책 읽는 골목 독립서점',
      industry: '서점',
      location: '대구 중구 삼덕동',
      facts: [
        { kind: 'offering', label: '블라인드 북', value: '키워드 큐레이션 시크릿 블라인드 북 15,000원' },
        { kind: 'policy', label: '음료 혜택', value: '도서 구매 영수증 지참 시 아메리카노 1,000원 할인' },
        { kind: 'profile', label: '운영시간', value: '화-일 12:00~21:00 영업' },
      ],
      tone: { presetKey: 'calm', brandVoice: '책과 사유가 머무는 조용하고 지적인 서점지기 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '문학동네 베스트셀러 신간 3,000원에 드립니다.',
      discount: '독서 모임 신규 가입 시 30% 할인 쿠폰을 지급합니다.',
      hours: '심야 책방의 날 매일 09:00~02:00 야간 영업합니다.',
      efficacy: '독서 치료 테라피로 우울증과 공황장애가 100% 완치 치료됩니다.',
      award: '전국독립출판문화대전 올해의 독립서점 대상 수상 공간입니다.',
    },
    inventedSentences: [
      '문학동네 베스트셀러 신간 3,000원에 드립니다.',
      '독서 모임 신규 가입 시 30% 할인 쿠폰을 지급합니다.',
      '심야 책방의 날 매일 09:00~02:00 야간 영업합니다.',
      '독서 치료 테라피로 우울증과 공황장애가 100% 완치 치료됩니다.',
      '전국독립출판문화대전 올해의 독립서점 대상 수상 공간입니다.',
    ],
    groundedClaims: [
      '키워드 큐레이션 시크릿 블라인드 북 15,000원입니다.',
      '도서 구매 영수증 지참 시 아메리카노 1,000원 할인 혜택을 제공합니다.',
    ],
  },

  // 19. 요가
  {
    key: 'yoga_pilates',
    name: '요가',
    context: {
      businessName: '숨 요가앤필라테스',
      industry: '요가',
      location: '서울 강동구 천호동',
      facts: [
        { kind: 'offering', label: '체험 레슨', value: '1:1 기구 필라테스 1회 체험 레슨 40,000원' },
        { kind: 'policy', label: '등록 혜택', value: '정규 회원권 등록 시 요가 토삭스 무료 증정' },
        { kind: 'profile', label: '수업시간', value: '평일 07:00~22:00 수업' },
      ],
      tone: { presetKey: 'calm', brandVoice: '호흡과 균형을 안내하는 평온한 요가 지도자 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '매트 요가 그룹 수업 1회 1,000원 체험권입니다.',
      discount: '봄맞이 3개월 등록 고객 40% 할인 혜택을 드립니다.',
      hours: '주말 심야 자율 수련실 매일 05:00~24:00 오픈합니다.',
      efficacy: '골반 교정 요가 2회 만에 척추측만증 통증이 완치되고 100% 치료됩니다.',
      award: '국제요가연맹 주최 요가 지도자 대회 그랑프리 1위 수상 원장 직강입니다.',
    },
    inventedSentences: [
      '매트 요가 그룹 수업 1회 1,000원 체험권입니다.',
      '봄맞이 3개월 등록 고객 40% 할인 혜택을 드립니다.',
      '주말 심야 자율 수련실 매일 05:00~24:00 오픈합니다.',
      '골반 교정 요가 2회 만에 척추측만증 통증이 완치되고 100% 치료됩니다.',
      '국제요가연맹 주최 요가 지도자 대회 그랑프리 1위 수상 원장 직강입니다.',
    ],
    groundedClaims: [
      '1:1 기구 필라테스 1회 체험 레슨 40,000원입니다.',
      '정규 회원권 등록 시 요가 토삭스 무료 증정합니다.',
    ],
  },

  // 20. 수리점
  {
    key: 'repair_shop',
    name: '수리점',
    context: {
      businessName: '뚝딱 디지털 모바일수리센터',
      industry: '수리점',
      location: '서울 용산구 한강로',
      facts: [
        { kind: 'offering', label: '액정 교체', value: '스마트폰 정품 액정 당일 수리 교체 110,000원' },
        { kind: 'policy', label: '수리 보증', value: '수리 완료 후 90일 무상 A/S 보증 무료' },
        { kind: 'profile', label: '운영시간', value: '월-토 10:00~19:30 영업' },
      ],
      tone: { presetKey: 'professional', brandVoice: '신속 정확한 전자엔지니어의 전문 수리 톤' },
      knowledgeVersion: 1,
      warnings: [],
    },
    inventedClaims: {
      price: '배터리 신품 교체 공임비 포함 5,000원 파격가입니다.',
      discount: '침수폰 복구 세척 작업 50% 할인 쿠폰을 드립니다.',
      hours: '야간 긴급 데이터 복구센터 매일 07:00~24:00 영업합니다.',
      efficacy: '메인보드 초음파 세척으로 메인보드 고장 증상이 100% 영구 복원 치료됩니다.',
      award: '한국전자기술협회 인증 우수 스마트기기 수리 명장 대상 수상 센터입니다.',
    },
    inventedSentences: [
      '배터리 신품 교체 공임비 포함 5,000원 파격가입니다.',
      '침수폰 복구 세척 작업 50% 할인 쿠폰을 드립니다.',
      '야간 긴급 데이터 복구센터 매일 07:00~24:00 영업합니다.',
      '메인보드 초음파 세척으로 메인보드 고장 증상이 100% 영구 복원 치료됩니다.',
      '한국전자기술협회 인증 우수 스마트기기 수리 명장 대상 수상 센터입니다.',
    ],
    groundedClaims: [
      '스마트폰 정품 액정 당일 수리 교체 110,000원입니다.',
      '수리 완료 후 90일 무상 A/S 보증 무료 혜택을 제공합니다.',
    ],
  },
]

export function getIndustryByKey(key: string): IndustryEvalCase | undefined {
  return EVAL_INDUSTRIES.find((ind) => ind.key === key)
}

export function getAllIndustries(): IndustryEvalCase[] {
  return EVAL_INDUSTRIES
}
