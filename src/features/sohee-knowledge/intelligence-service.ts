import type {
  CompetitiveInsight,
  InquiryQuestion,
  KnowledgeIntelligenceResult,
  SeasonTrigger,
} from './types'

export interface IntelligenceClientDeps {
  from(table: string): any
}

async function resolveClient(
  client?: IntelligenceClientDeps,
): Promise<IntelligenceClientDeps> {
  if (client) return client
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as IntelligenceClientDeps
}

function extractAreaName(location?: string | null): string {
  if (!location?.trim()) return '우리 동네'
  const trimmed = location.trim()

  // 1. '청라동', '성수동' 등 '...동' 추출 -> '청라', '성수'
  const dongMatch = trimmed.match(/([가-힣0-9]+)동(?:\s|$|[0-9]|번지)/)
  if (dongMatch) {
    return dongMatch[1]
  }

  // 2. '...구', '...시', '...군' 추출 (예: '서구', '강남구', '분당구')
  const guMatch = trimmed.match(/([가-힣0-9]+[구시군])(?:\s|$|[0-9])/)
  if (guMatch) {
    return guMatch[1]
  }

  // 3. 공백 기준 첫 단어
  const firstWord = trimmed.split(/\s+/)[0]
  return firstWord || '우리 동네'
}

function deriveInquiry(
  industryStr: string,
  allContent: string,
  facts: Array<{ category: string; content: string }>,
): InquiryQuestion | null {
  const industry = industryStr.toLowerCase()
  const isDining =
    /식당|요식|음식|고기|한식|일식|중식|양식|주점|이자카야|구이|포차|레스토랑|뷔페/.test(
      industry,
    )
  const isCafe =
    /카페|디저트|베이커리|커피|베이크|찻집|제과|베이글|도넛/.test(industry)
  const isBeauty =
    /미용|뷰티|헤어|네일|바버|피부|에스테틱|살롱|속눈썹|왁싱/.test(industry)

  if (isDining) {
    const hasFacilities =
      /그릴|구워|룸|단체|콜키지|주차|예약|아기의자/i.test(allContent)
    if (!hasFacilities) {
      return {
        id: 'inq-dining-facilities',
        category: 'FACILITIES',
        question:
          '사장님, 고기 직접 구워주시나요? 아니면 단체 룸이나 아기의자가 있나요?',
        reason: '식당 손님들이 방문 전 가장 궁금해하는 필수 이용 편의 정보예요.',
        placeholder: '예: 고기는 직원이 직접 구워드립니다. 단체룸 최대 16석 완비!',
        suggestedChips: [
          '직접 구워드림',
          '단체룸 완비',
          '콜키지 프리',
          '아기의자 있음',
          '무료 주차 가능',
        ],
      }
    }
  } else if (isCafe) {
    const hasCafeOptions =
      /디카페인|테라스|포장|원두|애견동반|반려견|로스팅/i.test(allContent)
    if (!hasCafeOptions) {
      return {
        id: 'inq-cafe-options',
        category: 'FAQ',
        question: '디카페인 변경이나 테라스/포장이 가능한가요?',
        reason: '카페 방문 고객이 메뉴 선택 시 자주 묻는 대표 질문이에요.',
        placeholder:
          '예: 모든 커피 메뉴 디카페인 변경 가능, 테라스 애견동반 가능합니다.',
        suggestedChips: [
          '디카페인 가능',
          '테라스석 완비',
          '애견동반 가능',
          '포장/배달 가능',
          '직접 로스팅',
        ],
      }
    }
  } else if (isBeauty) {
    const hasBeautyOptions =
      /100%\s*예약|예약제|경력|주차|시술시간|1:1|원장|맞춤/i.test(allContent)
    if (!hasBeautyOptions) {
      return {
        id: 'inq-beauty-booking',
        category: 'FAQ',
        question:
          '하루 최대 시술 인원이나 원장 1:1 맞춤 예약 기준이 어떻게 되나요?',
        reason: '뷰티/미용 매장 고객의 신뢰도를 높여주는 핵심 예약 안내예요.',
        placeholder:
          '예: 100% 1:1 맞춤 예약제 운영, 하루 최대 5명 집중 시술.',
        suggestedChips: [
          '100% 예약제',
          '1:1 원장 맞춤',
          '주차 가능',
          '프라이빗 룸',
          '10년 이상 경력',
        ],
      }
    }
  }

  // 일반/기타 또는 결핍 카테고리 체크
  const hasFAQ = facts.some((f) => f.category === 'FAQ')
  const hasDiff = facts.some((f) => f.category === 'DIFFERENTIATOR')

  if (!hasDiff && !hasFAQ) {
    return {
      id: 'inq-general-diff',
      category: 'DIFFERENTIATOR',
      question:
        '사장님 매장만의 특별한 자랑거리나 손님들이 가장 자주 묻는 질문이 있나요?',
      reason: '매장만의 차별점을 등록해두면 소희가 콘텐츠에 매력적으로 녹여내요.',
      placeholder: '예: 30년 전통의 비법 소스 사용, 손님들 재방문율 90% 이상',
      suggestedChips: [
        '친절한 서비스',
        '가성비 최고',
        '주차 편리',
        '단골 혜택',
      ],
    }
  }

  return null
}

function deriveSeasonTrigger(monthIndex: number): SeasonTrigger {
  const month = monthIndex + 1 // 1-12

  if (month === 10 || month === 11) {
    return {
      id: 'season-autumn-year-end',
      seasonName: '가을 단풍 & 수능/연말 모임 시즌',
      title: '가을 단풍 & 수능/연말 모임 시즌 준비',
      description:
        '쌀쌀해진 날씨와 다가오는 수능, 연말 모임에 어울리는 따뜻한 분위기나 단체 예약 혜택을 팩트에 추가해보세요.',
      actionPrompt:
        '연말 단체 모임이나 수능 수험생 혜택, 가을 제철 메뉴가 있다면 알려주세요!',
      targetCategory: 'MENU',
    }
  }

  if (month === 12 || month === 1) {
    return {
      id: 'season-christmas-newyear',
      seasonName: '크리스마스 & 송년회/신년 예약 시즌',
      title: '크리스마스 & 송년회/신년 예약 시즌 준비',
      description:
        '크리스마스 특별 코스, 연말연시 단체 대관이나 신년 맞이 이벤트 정보를 등록해 보세요.',
      actionPrompt:
        '크리스마스와 연말연시 특별 영업 시간이나 예약 프로모션이 있나요?',
      targetCategory: 'EVENT',
    }
  }

  if (month === 2 || month === 3) {
    return {
      id: 'season-graduation-spring',
      seasonName: '졸업/입학 & 봄맞이 신메뉴 시즌',
      title: '졸업/입학 & 봄맞이 신메뉴 시즌 준비',
      description:
        '새로운 시작을 축하하는 졸업·입학 가족 모임 혜택과 산뜻한 봄 신메뉴를 홍보해보세요.',
      actionPrompt:
        '졸업/입학 축하 이벤트나 봄 시즌 한정 메뉴가 준비되어 있나요?',
      targetCategory: 'MENU',
    }
  }

  if (month >= 6 && month <= 8) {
    return {
      id: 'season-summer-vacation',
      seasonName: '여름 휴가 & 시원한 계절 메뉴 시즌',
      title: '여름 휴가 & 시원한 계절 메뉴 시즌 준비',
      description:
        '무더위를 날릴 시원한 계절 메뉴나 여름 휴가철 운영 일정/이벤트를 안내해보세요.',
      actionPrompt:
        '여름 한정 시원한 메뉴나 바캉스 시즌 특별 프로모션이 있나요?',
      targetCategory: 'MENU',
    }
  }

  if (month === 4 || month === 5) {
    return {
      id: 'season-spring-family',
      seasonName: '따뜻한 봄나들이 & 가정의 달 시즌',
      title: '따뜻한 봄나들이 & 가정의 달 시즌 준비',
      description:
        '가정의 달(어린이날, 어버이날) 가족 단위 방문객을 위한 혜택이나 봄맞이 이벤트를 준비해보세요.',
      actionPrompt:
        '가정의 달 가족 모임 혜택이나 선물 세트, 봄 이벤트가 있나요?',
      targetCategory: 'EVENT',
    }
  }

  // 9월
  return {
    id: 'season-chuseok-autumn',
    seasonName: '풍성한 한가위 & 초가을 시즌',
    title: '풍성한 한가위 & 초가을 시즌 준비',
    description:
      '추석 명절 영업 안내와 가을맞이 특별 프로모션을 준비해보세요.',
    actionPrompt: '추석 연휴 정상 영업 여부나 명절 특별 이벤트가 있나요?',
    targetCategory: 'HOURS',
  }
}

function deriveCompetitiveInsight(
  area: string,
  allContent: string,
): CompetitiveInsight {
  const strengthPatterns = [
    {
      regex: /(\d+시간\s*무료\s*주차|무료\s*주차|주차\s*무료|주차\s*지원)/i,
      label: '무료 주차',
      extract: (m: RegExpMatchArray) => m[0],
    },
    {
      regex: /(직접\s*로스팅|자가배전|스페셜티\s*원두)/i,
      label: '직접 로스팅',
      extract: (m: RegExpMatchArray) => m[0],
    },
    {
      regex: /(\d+년\s*(?:경력|전통|노하우|업력)|장인|명인)/i,
      label: '경력/전통',
      extract: (m: RegExpMatchArray) => m[0],
    },
    {
      regex: /(웻에이징|드라이에이징|워터에이징|\d+시간\s*숙성|숙성육)/i,
      label: '숙성 노하우',
      extract: (m: RegExpMatchArray) => m[0],
    },
    {
      regex: /(100%\s*예약제|1:1\s*맞춤|프라이빗\s*룸)/i,
      label: '1:1 맞춤 예약',
      extract: (m: RegExpMatchArray) => m[0],
    },
    {
      regex: /(당일\s*생산|수제|유기농|천연\s*발효)/i,
      label: '수제·유기농',
      extract: (m: RegExpMatchArray) => m[0],
    },
    {
      regex: /(콜키지\s*프리|콜키지\s*무료)/i,
      label: '콜키지 프리',
      extract: (m: RegExpMatchArray) => m[0],
    },
  ]

  for (const p of strengthPatterns) {
    const match = allContent.match(p.regex)
    if (match) {
      const highlight = p.extract(match)
      return {
        id: `comp-${p.label}`,
        strengthHighlight: highlight,
        recommendation: `${area} 지역 매장 중 '${highlight}'은(는) 강력한 경쟁력이에요! 인스타 피드 첫 줄에 꼭 강조해 보세요.`,
        targetKeyword: `${area} ${highlight}`,
      }
    }
  }

  // 기본 강점
  const defaultHighlight = '정성스러운 서비스와 기본기'
  return {
    id: 'comp-default',
    strengthHighlight: defaultHighlight,
    recommendation: `${area} 지역 고객들에게 사랑받을 수 있도록 매장만의 특별한 강점과 스토리를 피드에 소개해 보세요.`,
    targetKeyword: `${area} 추천 매장`,
  }
}

/**
 * 사장님의 등록된 팩트와 매장 정보를 분석하여 지식 인텔리전스 결과 생성
 */
export async function analyzeKnowledgeIntelligence(
  workspaceId: string,
  client?: IntelligenceClientDeps,
): Promise<KnowledgeIntelligenceResult> {
  if (!workspaceId?.trim()) {
    throw new Error('workspaceId is required')
  }

  const supabase = await resolveClient(client)

  // 1. 매장 프로필 조회
  const { data: profile } = await supabase
    .from('business_profiles')
    .select('business_name, industry, location, summary')
    .eq('workspace_id', workspaceId.trim())
    .maybeSingle()

  // 2. 활성 승인 지식 목록 조회 (권위 RPC 우선, bare active 팩트 우회 제거)
  let facts: Array<{ id: string; category: string; content: string }> = []
  let rpcSucceeded = false

  if (typeof (supabase as any).rpc === 'function') {
    try {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_approved_learning_context', {
        p_workspace_id: workspaceId.trim(),
        p_purpose: 'conversation',
        p_max_facts: 200,
        p_query: '',
      })
      if (!rpcError && rpcData) {
        const items = Array.isArray(rpcData.items) ? rpcData.items : Array.isArray(rpcData) ? rpcData : []
        const channelEnabled = process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1'
        facts = items
          .filter((item: any) => item.source_type !== 'channel' || channelEnabled)
          .map((item: any) => ({
            id: String(item.id),
            category: String(item.category),
            content: String(item.content),
          }))
        rpcSucceeded = true
      }
    } catch {
      // safe fallback
    }
  }

  if (!rpcSucceeded) {
    const { data: factsData, error } = await supabase
      .from('knowledge_facts')
      .select('id, category, content, valid_until')
      .eq('workspace_id', workspaceId.trim())
      .eq('status', 'active')

    if (error) {
      throw new Error(error.message || 'KNOWLEDGE_FACTS_QUERY_FAILED')
    }

    const now = Date.now()
    const rawList: any[] = Array.isArray(factsData) ? factsData : []
    facts = rawList
      .filter((f) => {
        if (f.valid_until) {
          const until = new Date(f.valid_until).getTime()
          if (!Number.isNaN(until) && until <= now) return false
        }
        return true
      })
      .map((f) => ({
        id: String(f.id),
        category: String(f.category),
        content: String(f.content),
      }))
  }

  const industryStr = profile?.industry || ''
  const locationStr = profile?.location || ''
  const summaryStr = profile?.summary || ''

  const allContent = [
    summaryStr,
    ...facts.map((f) => `${f.category} ${f.content}`),
  ].join(' ')

  const area = extractAreaName(locationStr)

  // 1) 역질문 도출
  const inquiry = deriveInquiry(industryStr, allContent, facts)

  // 2) 시즌 트리거 도출
  const seasonTrigger = deriveSeasonTrigger(new Date().getMonth())

  // 3) 상권 경쟁력 인텔리전스 도출
  const competitiveInsight = deriveCompetitiveInsight(area, allContent)

  return {
    inquiry,
    seasonTrigger,
    competitiveInsight,
    lastAnalyzedAt: new Date().toISOString(),
  }
}
