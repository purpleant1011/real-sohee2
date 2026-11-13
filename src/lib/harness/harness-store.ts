import {
  HarnessAsset,
  HarnessVersion,
  HarnessRule,
  HarnessChannelAssignment,
  HarnessOverride,
  PlatformType
} from '@/types/harness'

/**
 * 1. studio_by.reum Seed Data (v1.1 System Reference)
 */
export const STUDIO_BY_REUM_SEED: {
  asset: HarnessAsset
  version: HarnessVersion
  rules: HarnessRule[]
} = {
  asset: {
    id: 'harness_byreum_001',
    workspaceId: 'b1000000-0000-4000-8000-000000000001',
    assetType: 'ATOMIC_SOURCE',
    title: '바이름(studio_by.reum) 퍼스널 뷰티 진단 하네스',
    visibility: 'SYSTEM_SEED_REFERENCE',
    overallStatus: 'READY',
    activeVersionId: 'ver_byreum_v1',
    activeVersionNo: 1,
    platform: 'instagram',
    sourceUrl: 'https://www.instagram.com/studio_by.reum',
    sourceHandle: 'studio_by.reum',
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
    totalSpentSc: 840,
    lastAnalyzedAt: '2026-08-31T16:30:00Z',
    createdAt: '2026-08-31T12:00:00Z',
    updatedAt: '2026-08-31T16:30:00Z'
  },
  version: {
    id: 'ver_byreum_v1',
    harnessAssetId: 'harness_byreum_001',
    versionNo: 1,
    schemaVersion: '1.1.0',
    compilerVersion: 'sohee-luna-5.6',
    evidenceScore: 92,
    confidence: 88,
    immutable: true,
    createdAt: '2026-08-31T12:00:00Z',
    textJson: {
      contentPillars: [
        '퍼스널 골격/모류 1:1 진단 (30%)',
        '직후 자연스러움 & 무통/무붉은기 기술력 (25%)',
        '고객 진솔한 후기 및 일상 복귀 사례 (15%)',
        '봄맞이 15% 한정 프로모션 혜택 (15%)',
        '원장 1:1 맞춤 상담 철학 & 비하인드 (15%)'
      ],
      hookPatterns: [
        '아침마다 양쪽 눈썹 그리느라 15분씩 씨름하셨나요?',
        '짱구 눈썹 될까 봐 예약 망설여지시나요?',
        '공장식 시술과 1:1 퍼스널 디자인의 결정적 차이'
      ],
      captionArchetypes: ['문제 공감형 훅', '골격 원인 진단', '맞춤 시술 솔루션', '첫 방문 혜택 CTA'],
      paragraphRhythm: '3~4문장 단위 여백 분리, 깔끔한 구분선(■) 적용',
      sentenceLengthProfile: '간결하고 명확한 어조 (평균 35자)',
      toneVector: {
        professional: 0.85,
        empathy: 0.90,
        directness: 0.70,
        urgency: 0.65
      },
      authorityPatterns: ['원장 1:1 전담 시술', '미국 FDA 안전 인증 천연 피그먼트 배합'],
      proofPatterns: ['시술 직후 무보정 근접 컷', '실제 고객 리얼 후기 인용'],
      problemSolutionGrammar: '고객 고민 ➔ 골격/피부 원인 분석 ➔ 바이름 맞춤 테크닉 ➔ 일상 속 자연스러운 변화',
      ctaPatterns: ['화/수 첫 방문 15% 혜택 프로필 링크 예약', '부담 없는 1:1 눈썹 고민 DM 상담'],
      forbiddenCliches: ['절대 지워지지 않는', '인천 최저가 덤핑', '100% 무조건 완벽']
    },
    visualJson: {
      subjectTypes: ['눈썹 결 근접 접사(Macro)', '얼굴 전체 균형 하프 샷', '시술 테이블 위생 도구'],
      sceneTypes: ['밝은 자연광 스튜디오', '아이보리/베이지 톤의 정갈한 상담실'],
      framing: ['초근접 눈썹 모류 결 포커스', '45도 측면 각도'],
      cameraAngles: ['정면 아이레벨', '측면 30도 앵글'],
      lightingProfile: '소프트 자연광 및 무반사 링라이트',
      paletteProfile: ['#F5F0EB', '#D4A373', '#2B2D42', '#FFFFFF'],
      backgroundProfile: '미니멀 화이트/웜베이지 블러 배경',
      textureRealism: '피부 결 모공과 눈썹 모 한 올 한 올의 선명한 텍스처 보존',
      beforeAfterLayout: '좌우 1:1 분할 또는 상하 콤보 비교',
      feedRhythm: '근접 샷 ➔ 하프 샷 ➔ 고객 리뷰 카드 ➔ 감성 인테리어 교차',
      imagePromptTemplate: 'Photorealistic close-up shot of perfectly refined natural microblading eyebrows, clean skin texture, soft studio warm lighting, neutral beige aesthetic, high-end beauty salon atmosphere, 8k resolution',
      negativePromptRules: ['oversaturated', 'drawn with marker', 'red tint tattoo', 'cartoonish', 'blurry']
    },
    operationsJson: {
      contentMixRatios: {
        expertDiagnosis: 30,
        beforeAfterProof: 25,
        customerReview: 15,
        promotionEvent: 15,
        behindDaily: 15
      },
      funnelStageMix: {
        awareness: 40,
        consideration: 35,
        decision: 20,
        retention: 5
      },
      trustBuildingSequence: '고객 고민 공감 ➔ 골격 진단 증명 ➔ 실제 시술 결 줌인 ➔ 프로모션 혜택 안내',
      promoRhythm: '주 1~2회 화/수 평일 비수기 타깃 15% 한정 오퍼 공지',
      socialProofPattern: '무보정 시술 직후 영상 및 카카오톡 고객 후기 캡처'
    },
    communityJson: {
      questionTaxonomy: [
        '시술 후 짱구 눈썹 여부 및 당일 출근 가능 여부',
        '시술 소요 시간 및 유지 기간(1년~1년 반)',
        '화/수 15% 첫 방문 할인 적용 조건',
        '임산부/수유부 시술 가능 여부 (안전 가이드)'
      ],
      replyTone: '다정하고 친절하지만 전문적인 1:1 뷰티 디렉터 어조',
      publicVsDmRule: '공개 댓글로는 다정한 공감 및 기본 안내 후, 1:1 프라이빗 예약 링크 및 상세 금액은 DM으로 안내',
      bookingTransition: '고객님 골격과 모류에 맞춘 1:1 상담을 위해 프로필 상단 네이버 예약 링크로 안내',
      priceQuestionRule: '기본 정가 대신 "첫 방문 15% 혜택가"를 강조하며 1:1 맞춤 상담 예약 유도',
      availabilityRule: '100% 1:1 원장 전담 시술로 동시 시술이 불가함을 정중히 안내하고 잔여 슬롯 선점 유도',
      riskyClaimGuardrails: ['100% 반영구 보장 금지', '의료적 시술 오인 표현 금지', '타샵 비방 금지']
    },
    platformJson: {
      sourcePlatform: 'instagram',
      compatibleTargets: ['instagram', 'threads', 'naver_blog'],
      formatConstraints: '인스타그램 4:5 세로 비율 및 본문 2~3줄 단위 여백 강제',
      hashtagStrategy: '#청라눈썹 #청라자연눈썹 #바이름 #인천자연눈썹 #청라속눈썹펌 #눈썹디자인',
      linkStrategy: '프로필 상단 네이버 예약 및 카카오톡 1:1 오픈채팅 단일 링크 연결',
      carouselStrategy: '1장: 임팩트 훅 ➔ 2~3장: 비포애프터 및 모류 결 접사 ➔ 4장: 15% 오퍼 및 예약 안내',
      blogHeadingStrategy: '소제목(H2, H3)을 명확히 구분하고 네이버 스마트에디터 인용구 서식 적용'
    }
  },
  rules: [
    {
      id: 'rule_byreum_001',
      harnessVersionId: 'ver_byreum_v1',
      module: 'text',
      ruleKey: 'hook_pattern_empathy',
      ruleTitle: '공감형 질문 훅 패턴',
      ruleValue: '아침 출근길 눈썹 그리기 씨름, 짱구 눈썹 불안감 등 일상 고충 직접 언급',
      evidenceState: 'OBSERVED',
      supportingSampleCount: 14,
      contradictorySampleCount: 0,
      confidence: 95,
      confidenceBasis: '인스타그램 피드 최근 20개 게시물 중 14개 게시물 훅 구조 일치'
    },
    {
      id: 'rule_byreum_002',
      harnessVersionId: 'ver_byreum_v1',
      module: 'text',
      ruleKey: 'authority_fda_pigment',
      ruleTitle: 'FDA 안전 인증 유기농 피그먼트 강조',
      ruleValue: '붉은 잔흔 없는 변색 방지 최고급 천연 색소 맞춤 배합',
      evidenceState: 'OBSERVED',
      supportingSampleCount: 8,
      contradictorySampleCount: 0,
      confidence: 90,
      confidenceBasis: '피드 및 스토리 하이라이트 내 반복 노출 사실 확인'
    },
    {
      id: 'rule_byreum_003',
      harnessVersionId: 'ver_byreum_v1',
      module: 'operations',
      ruleKey: 'promo_tue_wed_15off',
      ruleTitle: '화/수 15% 한정 프로모션 리듬',
      ruleValue: '주초/주중 빈자리 소진을 위한 화요일/수요일 15% 타깃 혜택',
      evidenceState: 'OBSERVED',
      supportingSampleCount: 6,
      contradictorySampleCount: 0,
      confidence: 88,
      confidenceBasis: '스토리 공지 및 프로필 안내 문구 일치'
    },
    {
      id: 'rule_byreum_004',
      harnessVersionId: 'ver_byreum_v1',
      module: 'community',
      ruleKey: 'reply_tone_default',
      ruleTitle: '소희 추천 응대 톤앤매너',
      ruleValue: '다정하면서도 전문성 있는 1:1 맞춤 케어 어조',
      evidenceState: 'RECOMMENDED_DEFAULT',
      supportingSampleCount: 0,
      contradictorySampleCount: 0,
      confidence: 75,
      confidenceBasis: '비공개 댓글 데이터 부족을 보완하기 위해 소희가 생성한 고품질 기본값'
    }
  ]
}

/**
 * 2. noor.brow Seed Data (v1.1 System Reference)
 */
export const NOOR_BROW_SEED: {
  asset: HarnessAsset
  version: HarnessVersion
  rules: HarnessRule[]
} = {
  asset: {
    id: 'harness_noor_002',
    workspaceId: 'b1000000-0000-4000-8000-000000000001',
    assetType: 'ATOMIC_SOURCE',
    title: '누르브로우(noor.brow) 메이크업 전공 1:1 디자인 하네스',
    visibility: 'SYSTEM_SEED_REFERENCE',
    overallStatus: 'READY',
    activeVersionId: 'ver_noor_v1',
    activeVersionNo: 1,
    platform: 'instagram',
    sourceUrl: 'https://www.instagram.com/noor.brow',
    sourceHandle: 'noor.brow',
    coreDna: [
      '11년 메이크업 전공 & 전 MAC 아티스트 권위',
      '비대칭·흉터·골격별 맞춤 원인 분석',
      '유행 일자 눈썹 탈피, 어울리는 입체 디자인'
    ],
    moduleReadiness: {
      text: 'READY',
      visual: 'READY',
      operations: 'READY',
      community: 'PARTIAL',
      platform: 'READY'
    },
    dailyEstimatedSc: 100,
    totalSpentSc: 720,
    lastAnalyzedAt: '2026-08-31T16:35:00Z',
    createdAt: '2026-08-31T12:00:00Z',
    updatedAt: '2026-08-31T16:35:00Z'
  },
  version: {
    id: 'ver_noor_v1',
    harnessAssetId: 'harness_noor_002',
    versionNo: 1,
    schemaVersion: '1.1.0',
    compilerVersion: 'sohee-luna-5.6',
    evidenceScore: 94,
    confidence: 90,
    immutable: true,
    createdAt: '2026-08-31T12:00:00Z',
    textJson: {
      contentPillars: [
        '11년 메이크업 전문가 골격 진단 (35%)',
        '비대칭/흉터 교정 전후 비교 (25%)',
        '잘못된 일자 눈썹 시술 피해 방지 팁 (15%)',
        '100% 예약제 맞춤 상담 예약 (15%)',
        '아티스트 작업 철학 (10%)'
      ],
      hookPatterns: [
        '누구나 똑같은 일자 눈썹, 과연 내 얼굴에도 어울릴까요?',
        '양쪽 눈썹 비대칭이 심한 진짜 이유',
        '메이크업 아티스트 11년 차가 눈썹을 디자인하는 기준'
      ],
      captionArchetypes: ['전문가 문제 제기', '얼굴형 분석 진단', '비대칭 정밀 교정 솔루션', '1:1 상담 예약'],
      paragraphRhythm: '전문 테크닉 용어와 고객 사례 기반 명쾌한 단락 구성',
      sentenceLengthProfile: '권위 있고 확신에 찬 아티스트 어조 (평균 40자)',
      toneVector: {
        professional: 0.92,
        empathy: 0.80,
        directness: 0.85,
        urgency: 0.60
      },
      authorityPatterns: ['11년 메이크업 전공', '전 MAC 메이크업 아티스트'],
      proofPatterns: ['골격 비대칭 교정 무보정 비교', '눈썹 근육 쓰임 정밀 분석 컷'],
      problemSolutionGrammar: '잘못된 유행 쉐입 ➔ 골격/근육 비대칭 원인 진단 ➔ 아티스트 맞춤 아치 설계',
      ctaPatterns: ['1:1 골격 분석 집중 상담 예약', '비대칭 눈썹 고민 사진 DM 전송'],
      forbiddenCliches: ['공장형 찍어내기', '누구나 10분 완성']
    },
    visualJson: {
      subjectTypes: ['비대칭 교정 하프 샷', '눈썹 아치 라인 접사', '전문 메이크업 브러시/드로잉'],
      sceneTypes: ['미니멀 모던 스튜디오', '은은한 간접 조명'],
      framing: ['얼굴 전체 균형 샷 및 눈썹 45도 클로즈업'],
      cameraAngles: ['정면 아이레벨', '상하 밸런스 앵글'],
      lightingProfile: '선명한 쿨/뉴트럴 스튜디오 조명',
      paletteProfile: ['#222222', '#FFFFFF', '#D5B9B2', '#ECE4DB'],
      backgroundProfile: '모던 그레이 & 샌드베이지 단색 배경',
      textureRealism: '한 올 한 올 심은 듯한 미세 결 디테일',
      beforeAfterLayout: '정면 1:1 완벽 정렬 비교',
      feedRhythm: '비대칭 비포애프터 ➔ 디자인 스케치 ➔ 고객 후기',
      imagePromptTemplate: 'Photorealistic balanced artistic eyebrow microblading, architectural symmetry, elegant arch, flawless studio lighting, luxury beauty editorial style, 8k resolution',
      negativePromptRules: ['oversaturated', 'blurred', 'asymmetric mistake']
    },
    operationsJson: {
      contentMixRatios: {
        expertDiagnosis: 35,
        beforeAfterProof: 25,
        customerReview: 15,
        promotionEvent: 15,
        behindDaily: 10
      },
      funnelStageMix: {
        awareness: 35,
        consideration: 40,
        decision: 20,
        retention: 5
      },
      trustBuildingSequence: '메이크업 전공 권위 증명 ➔ 비대칭 원인 분석 ➔ 입체 아치 전후 비교 ➔ 상담 예약',
      promoRhythm: '월 2회 1:1 골격 맞춤 분석 데이 한정 예약 오픈',
      socialProofPattern: '시술 전후 골격 정렬 각도 비교 및 고객 만족 인터뷰'
    },
    communityJson: {
      questionTaxonomy: ['비대칭 눈썹도 교정 가능한지', '이전 타샵 흉터/잔흔 커버 가능 여부', '상담 예약 대기 기간'],
      replyTone: '신뢰감 있고 정중하며 확신에 찬 아티스트 보이스',
      publicVsDmRule: '상세 상담 및 사진 진단은 1:1 DM으로 요청',
      bookingTransition: '정밀한 1:1 맞춤 디자인을 위해 프로필 링크를 통한 사전 예약 안내',
      priceQuestionRule: '단순 금액 안내 대신 골격 분석 프로세스 포함 가치 강조',
      availabilityRule: '하루 3명 한정 집중 시술 원칙 안내',
      riskyClaimGuardrails: ['완벽한 100% 대칭 확언 금지 (인간의 골격 한계 설명)', '타샵 비방 금지']
    },
    platformJson: {
      sourcePlatform: 'instagram',
      compatibleTargets: ['instagram', 'threads', 'naver_blog'],
      formatConstraints: '고화질 4:5 피드 및 9:16 릴스 프로세스 영상 최적화',
      hashtagStrategy: '#누르브로우 #비대칭눈썹교정 #메이크업전공눈썹 #청라눈썹 #자연눈썹디자인',
      linkStrategy: '카카오톡 채널 1:1 예약 상담 링크',
      carouselStrategy: '1장: 비대칭 고민 질문 ➔ 2장: 원인 분석 드로잉 ➔ 3장: 교정 완료 샷 ➔ 4장: 상담 링크'
    }
  },
  rules: [
    {
      id: 'rule_noor_001',
      harnessVersionId: 'ver_noor_v1',
      module: 'text',
      ruleKey: 'authority_mac_artist',
      ruleTitle: '11년 메이크업 아티스트 권위 강조',
      ruleValue: '전 MAC 아티스트 및 메이크업 전공 이력을 바탕으로 한 입체 디자인 철학',
      evidenceState: 'OBSERVED',
      supportingSampleCount: 18,
      contradictorySampleCount: 0,
      confidence: 98,
      confidenceBasis: '프로필 소개 및 모든 게시물 서두 일치'
    },
    {
      id: 'rule_noor_002',
      harnessVersionId: 'ver_noor_v1',
      module: 'text',
      ruleKey: 'diagnosis_grammar',
      ruleTitle: '문제 ➔ 원인 분석 ➔ 맞춤 해결 진단 문법',
      ruleValue: '비대칭, 흉터, 잘못된 모양에 대한 원인 설명 후 맞춤 솔루션 제시',
      evidenceState: 'OBSERVED',
      supportingSampleCount: 15,
      contradictorySampleCount: 0,
      confidence: 94,
      confidenceBasis: '피드 콘텐츠 분석 일치'
    }
  ]
}

/**
 * 3. modeun.brow Seed Data (Mens Eyebrow Tattoo)
 */
export const MODEUN_BROW_SEED: { asset: HarnessAsset; version: HarnessVersion; rules: HarnessRule[] } = {
  asset: {
    id: 'harness_modeun_003',
    workspaceId: 'b1000000-0000-4000-8000-000000000001',
    assetType: 'ATOMIC_SOURCE',
    title: '모든결브로우(modeun.brow) 맨즈 전문 굵은 결 브로우 하네스',
    visibility: 'SYSTEM_SEED_REFERENCE',
    overallStatus: 'READY',
    activeVersionId: 'ver_modeun_v1',
    activeVersionNo: 1,
    platform: 'instagram',
    sourceUrl: 'https://www.instagram.com/modeun.brow',
    sourceHandle: 'modeun.brow',
    coreDna: [
      '남성 전용 티 안 나는 자연 옴므 결 디자인',
      '면접·웨딩 맞춤 또렷하고 젠틀한 인상 형성',
      '직장인 퇴근길 19시 야간 예약 슬롯 운영'
    ],
    moduleReadiness: { text: 'READY', visual: 'READY', operations: 'READY', community: 'READY', platform: 'READY' },
    dailyEstimatedSc: 110,
    totalSpentSc: 550,
    lastAnalyzedAt: '2026-08-31T17:00:00Z',
    createdAt: '2026-08-31T12:00:00Z',
    updatedAt: '2026-08-31T17:00:00Z'
  },
  version: {
    id: 'ver_modeun_v1',
    harnessAssetId: 'harness_modeun_003',
    versionNo: 1,
    schemaVersion: '1.1.0',
    compilerVersion: 'sohee-luna-5.6',
    evidenceScore: 94,
    confidence: 92,
    immutable: true,
    createdAt: '2026-08-31T12:00:00Z',
    textJson: {
      contentPillars: ['남성 눈썹 고민 해결 (40%)', '직후 자연스러움 팩트 (30%)', '야간 예약 안내 (30%)'],
      hookPatterns: ['눈썹 문신 티 날까 봐 망설이셨나요?', '면접 전 인상을 바꾸는 15분 눈썹 디자인'],
      captionArchetypes: ['남성 직관형 훅', '자연결 증명', '퇴근길 슬롯 CTA'],
      paragraphRhythm: '군더더기 없는 팩트 중심 3줄 단락',
      sentenceLengthProfile: '단호하고 신뢰감 높은 숏폼 어조 (평균 28자)',
      toneVector: { professional: 0.88, empathy: 0.75, directness: 0.90, urgency: 0.70 },
      authorityPatterns: ['남성 시술 3,000건 임상'],
      proofPatterns: ['무보정 전후 남성 눈썹 직후 샷'],
      problemSolutionGrammar: '티 날까 봐 불안 ➔ 모류 결 맞춤 배합 ➔ 젠틀한 인상 완성',
      ctaPatterns: ['직장인을 위한 야간 19시 슬롯 빠른 DM 예약'],
      forbiddenCliches: ['여자 눈썹 기법 적용']
    },
    visualJson: {
      subjectTypes: ['남성 눈썹 결 접사', '남성 하프 프로필'],
      sceneTypes: ['모던 그레이 스튜디오'],
      framing: ['남성 골격 포커스'],
      cameraAngles: ['정면 아이레벨'],
      lightingProfile: '선명한 쿨톤 조명',
      paletteProfile: ['#1E2022', '#F0F5F9', '#52616B'],
      backgroundProfile: '미니멀 다크 그레이',
      textureRealism: '남성 특유의 굵은 모류 결 보존',
      beforeAfterLayout: '좌우 1:1 분할',
      feedRhythm: '남성 시술 컷 ➔ 리뷰 컷 교차',
      imagePromptTemplate: 'Photorealistic masculine eyebrow microblading, bold natural hair strokes, sharp jawline framing, modern cool lighting, 8k resolution',
      negativePromptRules: ['feminine thin arch', 'cartoonish']
    },
    operationsJson: {
      contentMixRatios: { expertDiagnosis: 40, beforeAfterProof: 30, customerReview: 15, promotionEvent: 10, behindDaily: 5 },
      funnelStageMix: { awareness: 40, consideration: 30, decision: 20, retention: 10 },
      trustBuildingSequence: '남성 시술 3,000건 임상 ➔ 직후 무보정 샷 ➔ 야간 슬롯 제안',
      promoRhythm: '면접 시즌 및 연초 옴므 프로모션',
      socialProofPattern: '남성 고객 실제 전후 사진 및 직장인 후기'
    },
    communityJson: {
      questionTaxonomy: ['시술 통증 문의', '직후 자연스러움 여부', '야간 예약 가능 시간'],
      replyTone: '단호하고 신뢰감 높은 프로페셔널 톤',
      publicVsDmRule: '가격 및 야간 슬롯 예약은 1:1 DM으로 전환',
      bookingTransition: '상담 감사 ➔ 남성 전문 1:1 맞춤 슬롯 안내 ➔ 빠른 예약 링크',
      priceQuestionRule: '남성 전용 맞춤 색소 및 1:1 프라이빗 룸 보장 안내',
      availabilityRule: '직장인을 위한 평일 19시/20시 야간 슬롯 우선 배정',
      riskyClaimGuardrails: ['영구적 착색 보장 금지', '100% 무통 단정 금지']
    },
    platformJson: {
      sourcePlatform: 'instagram',
      compatibleTargets: ['instagram', 'threads', 'naver_blog'],
      formatConstraints: '간결하고 명확한 숏폼 (300자 내외)',
      hashtagStrategy: '#남자눈썹 #맨즈브로우 #청라남자눈썹 #자연눈썹',
      linkStrategy: '프로필 링크 예약 유도'
    }
  },
  rules: []
}

/**
 * 4. salonde.brow Seed Data (Shadow & Combo Eyebrows)
 */
export const SALONDE_BROW_SEED: { asset: HarnessAsset; version: HarnessVersion; rules: HarnessRule[] } = {
  asset: {
    id: 'harness_salonde_004',
    workspaceId: 'b1000000-0000-4000-8000-000000000001',
    assetType: 'ATOMIC_SOURCE',
    title: '살롱드브로우(salonde_brow) 콤보 & 섀도우 무통 그라데이션 하네스',
    visibility: 'SYSTEM_SEED_REFERENCE',
    overallStatus: 'READY',
    activeVersionId: 'ver_salonde_v1',
    activeVersionNo: 1,
    platform: 'instagram',
    sourceUrl: 'https://www.instagram.com/salonde_brow',
    sourceHandle: 'salonde_brow',
    coreDna: [
      '화장한 듯 은은하고 부드러운 섀도우 콤보 테크닉',
      '지성 피부 및 모공 넓은 피부도 오래 유지되는 착색력',
      '시술 중 잠들 만큼 편안한 1차/2차 듀얼 안심 케어'
    ],
    moduleReadiness: { text: 'READY', visual: 'READY', operations: 'PARTIAL', community: 'PARTIAL', platform: 'READY' },
    dailyEstimatedSc: 115,
    totalSpentSc: 610,
    lastAnalyzedAt: '2026-08-31T17:10:00Z',
    createdAt: '2026-08-31T12:00:00Z',
    updatedAt: '2026-08-31T17:10:00Z'
  },
  version: {
    id: 'ver_salonde_v1',
    harnessAssetId: 'harness_salonde_004',
    versionNo: 1,
    schemaVersion: '1.1.0',
    compilerVersion: 'sohee-luna-5.6',
    evidenceScore: 90,
    confidence: 88,
    immutable: true,
    createdAt: '2026-08-31T12:00:00Z',
    textJson: {
      contentPillars: ['섀도우 눈썹 기법 (35%)', '유지력 비교 (35%)', '무통 케어 (30%)'],
      hookPatterns: ['화장하기 귀찮은 날, 섀도우 눈썹 하나면 끝!'],
      captionArchetypes: ['감성 공감형', '벨벳 텍스처 소개', '안심 예약'],
      paragraphRhythm: '부드러운 이모지와 함께하는 감성 단락',
      sentenceLengthProfile: '친절하고 디테일한 설명체 (평균 38자)',
      toneVector: { professional: 0.82, empathy: 0.95, directness: 0.68, urgency: 0.65 },
      authorityPatterns: ['벨벳 그라데이션 특허 테크닉'],
      proofPatterns: ['화장한 듯 뽀송한 시술 직후 컷'],
      problemSolutionGrammar: '지성 피부 지워짐 ➔ 섀도우 콤보 테크닉 ➔ 2년 지속 뽀송함',
      ctaPatterns: ['1:1 프라이빗 룸 안심 예약'],
      forbiddenCliches: ['짱구 눈썹']
    },
    visualJson: {
      subjectTypes: ['섀도우 그라데이션 접사'],
      sceneTypes: ['핑크 베이지 살롱'],
      framing: ['벨벳 피부 결 포커스'],
      cameraAngles: ['측면 45도'],
      lightingProfile: '소프트 웜 라이트',
      paletteProfile: ['#F7ECE1', '#CCAF9B', '#4D433D'],
      backgroundProfile: '감성 파스텔 웜 베이지',
      textureRealism: '파우더리 섀도우 텍스처',
      beforeAfterLayout: '상하 콤보 컷',
      feedRhythm: '시술 컷 ➔ 인테리어 컷',
      imagePromptTemplate: 'Photorealistic soft powder ombre gradient eyebrows, velvety texture, flawless skin, soft warm pink-beige studio lighting, 8k',
      negativePromptRules: ['sharp marker line', 'oversaturated']
    },
    operationsJson: {
      contentMixRatios: { expertDiagnosis: 35, beforeAfterProof: 30, customerReview: 15, promotionEvent: 10, behindDaily: 10 },
      funnelStageMix: { awareness: 35, consideration: 35, decision: 20, retention: 10 },
      trustBuildingSequence: '지성 피부 유지력 비교 ➔ 벨벳 텍스처 접사 ➔ 안심 케어 예약',
      promoRhythm: '여름 물놀이 대비 지속력 프로모션',
      socialProofPattern: '시술 3개월 후 유지력 셀카 후기'
    },
    communityJson: {
      questionTaxonomy: ['유지 기간 문의', '지성 피부 가능 여부', '무통 케어 과정'],
      replyTone: '다정하고 친근한 뷰티 살롱 보이스',
      publicVsDmRule: '세부 시술 기법 및 예약 안내는 DM 전환',
      bookingTransition: '친절 인사 ➔ 피부 타입 질문 ➔ 맞춤 콤보 추천 및 예약 슬롯 안내',
      priceQuestionRule: '2차 리터치 포함 프리미엄 색소 안내',
      availabilityRule: '주말 콤보 슬롯 사전 예약제 운영',
      riskyClaimGuardrails: ['부작용 0% 단정 금지', '의료 행위 오인 표현 금지']
    },
    platformJson: {
      sourcePlatform: 'instagram',
      compatibleTargets: ['instagram', 'threads', 'naver_blog'],
      formatConstraints: '풍부하고 친절한 설명 (400자 내외)',
      hashtagStrategy: '#섀도우눈썹 #콤보눈썹 #그라데이션눈썹 #인천눈썹문신',
      linkStrategy: '프로필 상단 카카오 채널 링크'
    }
  },
  rules: []
}

/**
 * 5. In-Memory / Local Harness Store
 */
class HarnessStore {
  private assets: HarnessAsset[] = [STUDIO_BY_REUM_SEED.asset, NOOR_BROW_SEED.asset, MODEUN_BROW_SEED.asset, SALONDE_BROW_SEED.asset]
  private versions: HarnessVersion[] = [STUDIO_BY_REUM_SEED.version, NOOR_BROW_SEED.version, MODEUN_BROW_SEED.version, SALONDE_BROW_SEED.version]
  private rules: HarnessRule[] = [...STUDIO_BY_REUM_SEED.rules, ...NOOR_BROW_SEED.rules, ...MODEUN_BROW_SEED.rules, ...SALONDE_BROW_SEED.rules]
  private assignments: HarnessChannelAssignment[] = [
    {
      id: 'assign_001',
      workspaceId: 'b1000000-0000-4000-8000-000000000001',
      channelId: 'chan_insta_001',
      channelName: 'Instagram (studio_by.reum)',
      channelPlatform: 'instagram',
      harnessAssetId: 'harness_byreum_001',
      assignmentMode: 'FOLLOW_ACTIVE',
      desiredAutonomyMode: 'FULL_AUTONOMOUS',
      actualAutonomyMode: 'FULL_AUTONOMOUS',
      enabled: true,
      assignedAt: '2026-08-31T14:00:00Z'
    },
    {
      id: 'assign_002',
      workspaceId: 'b1000000-0000-4000-8000-000000000001',
      channelId: 'chan_naver_001',
      channelName: 'Naver Blog (findk3)',
      channelPlatform: 'naver_blog',
      harnessAssetId: 'harness_byreum_001',
      assignmentMode: 'FOLLOW_ACTIVE',
      desiredAutonomyMode: 'SEMI_AUTONOMOUS',
      actualAutonomyMode: 'SEMI_AUTONOMOUS',
      enabled: true,
      assignedAt: '2026-08-31T14:30:00Z'
    }
  ]
  private overrides: HarnessOverride[] = [
    {
      id: 'override_001',
      harnessAssetId: 'harness_byreum_001',
      workspaceId: 'b1000000-0000-4000-8000-000000000001',
      module: 'text',
      ruleKey: 'cta_frequency',
      overrideValue: '직접적인 "예약하세요" 문구는 주 1회 이하로 제한하고 상담 위주로 작성',
      reason: '대표님 피드백: 과도한 세일즈 톤 완화',
      createdAt: '2026-08-31T15:00:00Z'
    }
  ]

  public getAssets(workspaceId?: string): HarnessAsset[] {
    return this.assets
  }

  public getAssetById(id: string): HarnessAsset | undefined {
    return this.assets.find(a => a.id === id)
  }

  public getVersionById(id: string): HarnessVersion | undefined {
    return this.versions.find(v => v.id === id)
  }

  public getRulesByVersionId(versionId: string): HarnessRule[] {
    return this.rules.filter(r => r.harnessVersionId === versionId)
  }

  public getAssignments(workspaceId?: string): HarnessChannelAssignment[] {
    return this.assignments
  }

  public getOverrides(harnessAssetId: string): HarnessOverride[] {
    return this.overrides.filter(o => o.harnessAssetId === harnessAssetId)
  }

  public addOverride(override: Omit<HarnessOverride, 'id' | 'createdAt'>): HarnessOverride {
    const newOverride: HarnessOverride = {
      ...override,
      id: `override_${Date.now()}`,
      createdAt: new Date().toISOString()
    }
    this.overrides.push(newOverride)
    return newOverride
  }

  public removeOverride(id: string): boolean {
    const idx = this.overrides.findIndex(o => o.id === id)
    if (idx !== -1) {
      this.overrides.splice(idx, 1)
      return true
    }
    return false
  }

  public addAsset(asset: HarnessAsset, version: HarnessVersion, rules: HarnessRule[] = []): HarnessAsset {
    this.assets.unshift(asset)
    this.versions.unshift(version)
    this.rules.push(...rules)
    return asset
  }

  public assignChannel(
    workspaceId: string,
    channelId: string,
    channelName: string,
    channelPlatform: PlatformType,
    harnessAssetId: string,
    assignmentMode: 'FOLLOW_ACTIVE' | 'PINNED_VERSION' = 'FOLLOW_ACTIVE',
    desiredAutonomyMode: 'FULL_AUTONOMOUS' | 'SEMI_AUTONOMOUS' | 'REQUIRE_APPROVAL' = 'FULL_AUTONOMOUS',
    enabled = true
  ): HarnessChannelAssignment {
    let assignment = this.assignments.find(a => a.channelId === channelId)
    if (assignment) {
      assignment.harnessAssetId = harnessAssetId
      assignment.channelName = channelName
      assignment.channelPlatform = channelPlatform
      assignment.assignmentMode = assignmentMode
      assignment.desiredAutonomyMode = desiredAutonomyMode
      assignment.actualAutonomyMode = desiredAutonomyMode
      assignment.enabled = enabled
    } else {
      assignment = {
        id: `assign_${Date.now()}`,
        workspaceId,
        channelId,
        channelName,
        channelPlatform,
        channelConnectionId: `conn_${channelId}`,
        harnessAssetId,
        assignmentMode,
        desiredAutonomyMode,
        actualAutonomyMode: desiredAutonomyMode,
        enabled,
        assignedAt: new Date().toISOString()
      }
      this.assignments.push(assignment)
    }
    return assignment
  }
}

export const harnessStore = new HarnessStore()
