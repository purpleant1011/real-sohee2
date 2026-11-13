/**
 * Sohee Action Capability Registry (ANI-311, ANI-312)
 * 
 * 25+ Specialized Marketing Actions for Conversational Agent Command Plane
 * - Strict Risk Tiers: LOW | MEDIUM | HIGH | IRREVERSIBLE
 * - Estimated SC Range & Dynamic Cost Resolver
 * - Autonomous Policy & Pre-flight Permission Contracts
 */

export type ActionRiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'IRREVERSIBLE'

export type ActionCategory = 
  | 'CONTENT'
  | 'PUBLISHING'
  | 'CUSTOMER_CRM'
  | 'PROMOTION'
  | 'RADAR'
  | 'ANALYTICS'
  | 'HARNESS'
  | 'SYSTEM'
  | 'EXPERIMENT'

export interface ActionDefinition {
  id: string
  name: string
  description: string
  category: ActionCategory
  riskTier: ActionRiskTier
  requiresOwnerApproval: boolean
  estimatedSCLow: number
  estimatedSCExpected: number
  estimatedSCHigh: number
  supportedChannels: ('INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN' | 'NAVER_TALKTALK' | 'KAKAO')[]
  parametersSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required?: string[]
  }
}

export const ACTION_CAPABILITY_REGISTRY: Record<string, ActionDefinition> = {
  // 1. 콘텐츠 제작 (Content Generation)
  'content.create_blog': {
    id: 'content.create_blog',
    name: '네이버 블로그 전문 칼럼 원고 작성',
    description: '매장 하네스 지식과 지역 타깃 키워드를 결합한 2,000자 이상 스마트에디터 원고를 생성합니다.',
    category: 'CONTENT',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 150,
    estimatedSCExpected: 280,
    estimatedSCHigh: 400,
    supportedChannels: ['NAVER_BLOG'],
    parametersSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '포스팅 주제' },
        harnessId: { type: 'string', description: '적용할 하네스 ID' },
        targetKeywords: { type: 'string', description: '타깃 검색 키워드' }
      },
      required: ['topic']
    }
  },
  'content.create_insta_feed': {
    id: 'content.create_insta_feed',
    name: '인스타그램 룩북 피드 및 캡션 작성',
    description: '퍼스널 브로우 시술 룩북, 비포애프터 설명, 킬러 해시태그를 포함한 피드 원고를 작성합니다.',
    category: 'CONTENT',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 80,
    estimatedSCExpected: 140,
    estimatedSCHigh: 220,
    supportedChannels: ['INSTAGRAM'],
    parametersSchema: {
      type: 'object',
      properties: {
        concept: { type: 'string', description: '피드 콘셉트' },
        imageCount: { type: 'string', description: '시안 매수' }
      },
      required: ['concept']
    }
  },
  'content.create_threads': {
    id: 'content.create_threads',
    name: '스레드 인사이트 & 스토리텔링 작성',
    description: '원장님의 메이크업/시술 철학을 담은 1:1 대화형 스레드 텍스트를 생성합니다.',
    category: 'CONTENT',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 40,
    estimatedSCExpected: 70,
    estimatedSCHigh: 120,
    supportedChannels: ['THREADS'],
    parametersSchema: {
      type: 'object',
      properties: {
        theme: { type: 'string', description: '스레드 주제' }
      },
      required: ['theme']
    }
  },
  'content.create_daangn': {
    id: 'content.create_daangn',
    name: '당근 비즈프로필 동네소식 원고 작성',
    description: '동네 이웃 주민들을 위한 친근한 소개와 한정 쿠폰이 포함된 동네소식을 작성합니다.',
    category: 'CONTENT',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 60,
    estimatedSCExpected: 110,
    estimatedSCHigh: 180,
    supportedChannels: ['DAANGN'],
    parametersSchema: {
      type: 'object',
      properties: {
        offerDetails: { type: 'string', description: '혜택 내용' }
      },
      required: ['offerDetails']
    }
  },

  // 2. 비주얼 이미지 생성 (GPT Image 2)
  'visual.generate_image': {
    id: 'visual.generate_image',
    name: 'GPT Image 2 기반 초고화질 실사 시안 생성',
    description: '자연광 매장 무드, 45도 초근접 자연결 엠보 시술 룩북 이미지를 단독 생성합니다.',
    category: 'CONTENT',
    riskTier: 'MEDIUM',
    requiresOwnerApproval: false,
    estimatedSCLow: 200,
    estimatedSCExpected: 350,
    estimatedSCHigh: 500,
    supportedChannels: ['INSTAGRAM', 'NAVER_BLOG', 'DAANGN', 'THREADS'],
    parametersSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '생성할 이미지 세부 묘사' },
        style: { type: 'string', description: '스타일 (자연광 실사, 비포애프터, 엠보 결)' }
      },
      required: ['prompt']
    }
  },

  // 3. 외부 채널 실발행 (Publishing - Irreversible)
  'publishing.publish_live': {
    id: 'publishing.publish_live',
    name: '4대 채널 즉시 실발행 및 HTTP 200 검증',
    description: '원장님이 승인한 원고와 이미지를 실제 채널로 배포하고 외부 URL 실존성을 확인합니다.',
    category: 'PUBLISHING',
    riskTier: 'IRREVERSIBLE',
    requiresOwnerApproval: true,
    estimatedSCLow: 100,
    estimatedSCExpected: 180,
    estimatedSCHigh: 260,
    supportedChannels: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'],
    parametersSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'], description: '발행할 채널' },
        contentId: { type: 'string', description: '발행할 콘텐츠 ID' }
      },
      required: ['channel', 'contentId']
    }
  },

  // 4. 고객 응대 & CRM (Customer Conversion)
  'customer.draft_inquiry_reply': {
    id: 'customer.draft_inquiry_reply',
    name: '고객 문의 1:1 맞춤 답변 초안 작성',
    description: '인스타 DM/톡톡/당근채팅 문의 고객의 골격/고민에 맞춘 상담 가이드 초안을 작성합니다.',
    category: 'CUSTOMER_CRM',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 30,
    estimatedSCExpected: 60,
    estimatedSCHigh: 100,
    supportedChannels: ['INSTAGRAM', 'NAVER_TALKTALK', 'DAANGN', 'KAKAO'],
    parametersSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: '고객 ID' },
        inquiryMessage: { type: 'string', description: '고객의 질문 내용' }
      },
      required: ['customerId', 'inquiryMessage']
    }
  },
  'customer.send_reply': {
    id: 'customer.send_reply',
    name: '고객 1:1 상담 메시지 실제 발송',
    description: '원장님 컨펌된 메시지를 해당 고객의 DM 또는 채팅으로 실제 전송합니다.',
    category: 'CUSTOMER_CRM',
    riskTier: 'MEDIUM',
    requiresOwnerApproval: true,
    estimatedSCLow: 20,
    estimatedSCExpected: 40,
    estimatedSCHigh: 70,
    supportedChannels: ['INSTAGRAM', 'NAVER_TALKTALK', 'DAANGN'],
    parametersSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: '고객 ID' },
        messageText: { type: 'string', description: '전송할 메시지 본문' }
      },
      required: ['customerId', 'messageText']
    }
  },
  'customer.manage_reservation': {
    id: 'customer.manage_reservation',
    name: '방문 예약 확정 및 예약금 수납 기록',
    description: '매장 캘린더 빈 슬롯을 점유하고 2만원 예약금 입금 상태를 동기화합니다.',
    category: 'CUSTOMER_CRM',
    riskTier: 'MEDIUM',
    requiresOwnerApproval: false,
    estimatedSCLow: 20,
    estimatedSCExpected: 40,
    estimatedSCHigh: 60,
    supportedChannels: ['NAVER_TALKTALK', 'INSTAGRAM'],
    parametersSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: '고객 ID' },
        slotDateTime: { type: 'string', description: '예약 일시' },
        depositPaid: { type: 'string', enum: ['paid', 'pending'], description: '예약금 상태' }
      },
      required: ['customerId', 'slotDateTime']
    }
  },
  'customer.retention_loop': {
    id: 'customer.retention_loop',
    name: '시술 후 3일/4주차 리터치 재방문 알림',
    description: '시술 고객별 최적 시점에 관리법과 리터치 예약 권유 메시지를 자동 생성합니다.',
    category: 'CUSTOMER_CRM',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 40,
    estimatedSCExpected: 70,
    estimatedSCHigh: 120,
    supportedChannels: ['KAKAO', 'NAVER_TALKTALK', 'INSTAGRAM'],
    parametersSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: '고객 ID' },
        daysSinceVisit: { type: 'string', description: '시술 후 경과 일수' }
      },
      required: ['customerId']
    }
  },

  // 5. 프로모션 & 유휴 슬롯 (Promotion & Slot Filling)
  'promo.idle_slot_boost': {
    id: 'promo.idle_slot_boost',
    name: '주중 유휴 슬롯 타깃 15% 한정 오퍼 배포',
    description: '공실 위험이 있는 화/수 시간대 슬롯을 파악하고 전 채널 긴급 프로모션을 가동합니다.',
    category: 'PROMOTION',
    riskTier: 'HIGH',
    requiresOwnerApproval: true,
    estimatedSCLow: 250,
    estimatedSCExpected: 450,
    estimatedSCHigh: 680,
    supportedChannels: ['INSTAGRAM', 'NAVER_BLOG', 'DAANGN', 'THREADS'],
    parametersSchema: {
      type: 'object',
      properties: {
        targetDay: { type: 'string', description: '채울 요일 (예: 화요일/수요일)' },
        discountRate: { type: 'string', description: '할인율 (예: 15%)' }
      },
      required: ['targetDay']
    }
  },

  // 6. 상권 레이더 & 경쟁사 방어 (Market Radar)
  'radar.scan_market': {
    id: 'radar.scan_market',
    name: '지역 상권 키워드 및 고객 인텐트 탐지',
    description: '청라/인근 상권의 검색량 급상승 키워드와 인기 뷰티 트렌드를 실시간 스캔합니다.',
    category: 'RADAR',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 50,
    estimatedSCExpected: 90,
    estimatedSCHigh: 150,
    supportedChannels: ['NAVER_BLOG', 'INSTAGRAM'],
    parametersSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', description: '상권 지역명' }
      },
      required: ['region']
    }
  },
  'radar.anti_copy_protect': {
    id: 'radar.anti_copy_protect',
    name: '경쟁사 카피 방지 및 원장님 시술 독창성 감사',
    description: '우리 매장 하네스 텍스트와 시안이 타 샵과 겹치지 않도록 독창성을 비교 검증합니다.',
    category: 'RADAR',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 60,
    estimatedSCExpected: 100,
    estimatedSCHigh: 160,
    supportedChannels: ['INSTAGRAM', 'NAVER_BLOG'],
    parametersSchema: {
      type: 'object',
      properties: {
        contentSnippet: { type: 'string', description: '검증할 원고 본문' }
      },
      required: ['contentSnippet']
    }
  },

  // 7. 성과 분석 & 결과 검증 (Analytics & Evidence)
  'analytics.compile_weekly': {
    id: 'analytics.compile_weekly',
    name: '주간 마케팅 기여 매출 및 ROI 정본 결산',
    description: '실제 예약 원장과 발행 콘텐츠를 매칭하여 직접/보조 기여 매출을 결산합니다.',
    category: 'ANALYTICS',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 50,
    estimatedSCExpected: 80,
    estimatedSCHigh: 130,
    supportedChannels: [],
    parametersSchema: {
      type: 'object',
      properties: {
        weekOffset: { type: 'string', description: '조회 주차' }
      }
    }
  },
  'analytics.audit_http200': {
    id: 'analytics.audit_http200',
    name: '발행된 외부 링크 200 OK 실존 전수 검증',
    description: '인스타그램/네이버/당근에 배포된 모든 퍼블릭 링크의 정상 노출을 확인합니다.',
    category: 'ANALYTICS',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 30,
    estimatedSCExpected: 50,
    estimatedSCHigh: 80,
    supportedChannels: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'],
    parametersSchema: {
      type: 'object',
      properties: {}
    }
  },

  // 8. 하네스 비법 교육 & 동기화 (Harness)
  'harness.tune_dna': {
    id: 'harness.tune_dna',
    name: '매장 1:1 시술 DNA 및 브랜드 어조 튜닝',
    description: '원장님의 시술 철학, 모류 진단 방식, 응대 톤을 소희의 하네스 엔진에 주입합니다.',
    category: 'HARNESS',
    riskTier: 'MEDIUM',
    requiresOwnerApproval: false,
    estimatedSCLow: 80,
    estimatedSCExpected: 150,
    estimatedSCHigh: 250,
    supportedChannels: [],
    parametersSchema: {
      type: 'object',
      properties: {
        dnaRule: { type: 'string', description: '추가할 시술 철학/규칙' }
      },
      required: ['dnaRule']
    }
  },

  // 9. 시스템 제어 & 자율성 (System)
  'system.switch_autonomy': {
    id: 'system.switch_autonomy',
    name: '소희 24시간 자율 근무 모드 전환',
    description: '풀에이전트 자동 루틴 가동(start) 또는 일시 정지(pause)를 수행합니다.',
    category: 'SYSTEM',
    riskTier: 'MEDIUM',
    requiresOwnerApproval: true,
    estimatedSCLow: 10,
    estimatedSCExpected: 20,
    estimatedSCHigh: 30,
    supportedChannels: [],
    parametersSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['start', 'pause'], description: '가동 또는 정지' }
      },
      required: ['mode']
    }
  },
  'system.check_connections': {
    id: 'system.check_connections',
    name: '4대 채널 및 인프라 연동 상태 진단',
    description: '인스타/네이버/당근/스레드 API 및 데이터베이스 연결 상태를 점검합니다.',
    category: 'SYSTEM',
    riskTier: 'LOW',
    requiresOwnerApproval: false,
    estimatedSCLow: 10,
    estimatedSCExpected: 20,
    estimatedSCHigh: 30,
    supportedChannels: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'],
    parametersSchema: {
      type: 'object',
      properties: {}
    }
  },

  // 10. A/B 실험 & 캠페인 (Experiments & Campaigns)
  'experiment.run_ab': {
    id: 'experiment.run_ab',
    name: '2가지 시안 4채널 A/B 전환율 동시 실험',
    description: '진단형 톤 vs 감성형 톤 2가지 시안을 발행하여 실시간 클릭/문의 전환을 비교합니다.',
    category: 'EXPERIMENT',
    riskTier: 'HIGH',
    requiresOwnerApproval: true,
    estimatedSCLow: 300,
    estimatedSCExpected: 520,
    estimatedSCHigh: 780,
    supportedChannels: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'],
    parametersSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '실험 주제' }
      },
      required: ['topic']
    }
  },
  'campaign.launch_seasonal': {
    id: 'campaign.launch_seasonal',
    name: '시즌 풀 마케팅 캠페인 자동 실행',
    description: '봄맞이/웨딩/휴가철 타깃으로 콘텐츠 4건, 동네소식 1건, 고객 알림을 패키지로 진행합니다.',
    category: 'PROMOTION',
    riskTier: 'HIGH',
    requiresOwnerApproval: true,
    estimatedSCLow: 600,
    estimatedSCExpected: 1100,
    estimatedSCHigh: 1600,
    supportedChannels: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN', 'KAKAO'],
    parametersSchema: {
      type: 'object',
      properties: {
        campaignTheme: { type: 'string', description: '캠페인 테마' }
      },
      required: ['campaignTheme']
    }
  }
}

/**
 * Returns dynamic action capability registry customized for the specific business category and name.
 */
export function getDynamicActionRegistry(category?: string, businessName?: string): Record<string, ActionDefinition> {
  const isBeauty = !category || category.includes('뷰티') || category.includes('미용') || category.includes('헤어') || category.includes('눈썹')
  const isFood = category?.includes('음식') || category?.includes('카페') || category?.includes('베이커리') || category?.includes('요식') || category?.includes('식당')
  const isFitness = category?.includes('헬스') || category?.includes('피트니스') || category?.includes('필라테스') || category?.includes('요가')
  const isEducation = category?.includes('학원') || category?.includes('교육') || category?.includes('교습')
  const isMedical = category?.includes('병원') || category?.includes('의원') || category?.includes('클리닉') || category?.includes('치과') || category?.includes('한의원')

  const clone: Record<string, ActionDefinition> = JSON.parse(JSON.stringify(ACTION_CAPABILITY_REGISTRY))

  if (isFood) {
    if (clone['content.create_blog']) {
      clone['content.create_blog'].description = '매장 대표 시그니처 메뉴와 지역 맛집 탐방 키워드를 결합한 스마트에디터 원고를 생성합니다.'
    }
    if (clone['content.create_insta_feed']) {
      clone['content.create_insta_feed'].name = '인스타그램 메뉴 비주얼 피드 및 캡션 작성'
      clone['content.create_insta_feed'].description = '음식 플레이팅 룩북, 맛의 디테일 설명, 상권 해시태그를 포함한 피드 원고를 작성합니다.'
    }
    if (clone['content.create_threads']) {
      clone['content.create_threads'].description = '사장님의 식재료 철학과 레시피 스토리를 담은 1:1 대화형 스레드 텍스트를 생성합니다.'
    }
    if (clone['crm.respond_inquiry']) {
      clone['crm.respond_inquiry'].description = '단체 예약, 웨이팅, 주차, 메뉴 알레르기 문의를 실시간 감지하여 친절하게 응대합니다.'
    }
  } else if (isFitness) {
    if (clone['content.create_blog']) {
      clone['content.create_blog'].description = '체형 교정 및 다이어트 성공 케이스 중심의 전문 운동 칼럼 스마트에디터 원고를 생성합니다.'
    }
    if (clone['content.create_insta_feed']) {
      clone['content.create_insta_feed'].name = '인스타그램 회원 비포애프터 & 운동 팁 피드'
      clone['content.create_insta_feed'].description = '체형 변화 데이터, 루틴 가이드, 지역 헬스 해시태그를 포함한 피드 원고를 작성합니다.'
    }
    if (clone['content.create_threads']) {
      clone['content.create_threads'].description = '트레이너의 운동 철학과 식단 노하우를 담은 1:1 대화형 스레드 텍스트를 생성합니다.'
    }
    if (clone['crm.respond_inquiry']) {
      clone['crm.respond_inquiry'].description = 'PT 체험 수업 예약, 시설 이용료, 락커/주차 문의를 감지하여 1:1 방문 상담 슬롯을 예약합니다.'
    }
  } else if (isEducation) {
    if (clone['content.create_blog']) {
      clone['content.create_blog'].description = '내신/수능 분석 및 합격 커리큘럼 중심의 교육 칼럼 스마트에디터 원고를 생성합니다.'
    }
    if (clone['content.create_insta_feed']) {
      clone['content.create_insta_feed'].name = '인스타그램 수업 현장 & 성적 향상 스토리 피드'
      clone['content.create_insta_feed'].description = '수업 분위기, 우수 수강생 후기, 학부모 상담 해시태그를 포함한 피드 원고를 작성합니다.'
    }
    if (clone['crm.respond_inquiry']) {
      clone['crm.respond_inquiry'].description = '레벨 테스트 예약, 수강료, 수업 시간표 문의를 감지하여 원장님 상담 슬롯을 예약합니다.'
    }
  } else if (isMedical) {
    if (clone['content.create_blog']) {
      clone['content.create_blog'].description = '의료법 준수 가이드라인 기반의 환자 맞춤 건강 정보 및 진료 안내 칼럼 원고를 생성합니다.'
    }
    if (clone['content.create_insta_feed']) {
      clone['content.create_insta_feed'].name = '인스타그램 병원 진료 시설 & 원장님 진료 철학 피드'
      clone['content.create_insta_feed'].description = '쾌적한 원내 공간, 최신 장비 소개, 환자 안심 해시태그를 포함한 피드 원고를 작성합니다.'
    }
    if (clone['crm.respond_inquiry']) {
      clone['crm.respond_inquiry'].description = '진료 시간, 위치 안내, 사전 문진 및 예약 상담을 실시간으로 친절하게 안내합니다.'
    }
  }

  return clone
}


