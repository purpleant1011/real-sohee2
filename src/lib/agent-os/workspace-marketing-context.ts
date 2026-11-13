/**
 * Workspace Marketing Context Builder (ANI-1039, ANI-1055)
 *
 * Single Source of Truth (SSOT) for assembling workspace business identity,
 * brand tone, structured products/services grounding, hard policies,
 * current work state, and dynamic persona without capability theatre or false green.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'

export interface StructuredProductService {
  id: string
  workspaceId: string
  name: string
  price?: number | null
  priceFormatted?: string | null
  description?: string | null
  keyBenefits?: string[]
  priority?: number
  isSignature?: boolean
  active: boolean
  createdAt?: string
  updatedAt?: string
}

export interface WorkspaceMarketingContext {
  workspaceId: string
  business: {
    status: 'CONFIGURED' | 'SETUP_REQUIRED'
    businessName: string
    industry: string | null
    location: string | null
    summary: string | null
  }
  brand: {
    status: 'CONFIGURED' | 'SETUP_REQUIRED'
    voice: string | null
    keywords: string[]
    prohibitedTerms: string[]
  }
  productsServices: {
    status: 'CONFIGURED' | 'EMPTY'
    items: StructuredProductService[]
    source: 'TABLE' | 'EXTRACTED_SUMMARY' | 'EMPTY'
  }
  policies: {
    maxDiscountRate?: number
    hardPolicyNotice?: string
  }
  currentWork: {
    activeWorkItemsCount: number
    latestWorkItem?: { id: string; title: string; status: string } | null
  }
  recentVerifiedResults: {
    lastPublishedAt?: string
    channel?: string
    url?: string
  }[]
  dynamicPersona: {
    addressTerm: string
    industryCategory: 'FOOD_BEVERAGE' | 'BEAUTY_CLINIC' | 'RETAIL_COMMERCE' | 'GENERAL_SERVICE'
    industryVocabulary: string[]
    toneGuidelines: string
  }
  learnedChannelKnowledge?: {
    epoch: number
    facts: Array<{ id: string; category: string; content: string }>
    dependencies: Array<{ workspaceId: string; sourceId: string; revision: number }>
  }
  contextSummary: string
  contextVersion: string
  observedAt: string
}

/**
 * Robust extractor that parses structured products, prices, and signature tags
 * from free-form business summary text.
 */
export function extractStructuredProductsFromSummary(
  summary: string | null | undefined,
  workspaceId: string
): StructuredProductService[] {
  if (!summary || typeof summary !== 'string' || !summary.trim()) {
    return []
  }

  const items: StructuredProductService[] = []
  // Matches patterns like: "제품명(18,000원)" or "대표 시그니처 파스타 (18,000원)"
  const priceRegex = /([^,.\n()]+?)\s*\(([0-9,]+)\s*원\)/g
  let match: RegExpExecArray | null

  let priority = 1
  while ((match = priceRegex.exec(summary)) !== null) {
    const rawNameWithDesc = match[1].trim()
    const rawPriceStr = match[2].replace(/,/g, '')
    const priceNum = parseInt(rawPriceStr, 10)

    if (rawNameWithDesc && !isNaN(priceNum)) {
      const isSignature = rawNameWithDesc.includes('시그니처') || rawNameWithDesc.includes('대표')
      
      // Clean up descriptive modifiers if present
      let cleanName = rawNameWithDesc
      let description: string | null = null

      // E.g., "직접 재배한 생바질과 통들깨를 갈아 넣은 시그니처 바질 크림 파스타"
      // or "프랑스 AOP 버터 크루아상에 제철 딸기와 마스카포네 크림을 얹은 딸기 크림 크루아상"
      const verbEndingMatch = rawNameWithDesc.match(/^(.*?(?:[은는한인던]|추출|사용|담은))\s+([가-힣a-zA-Z0-9\s]+)$/)
      if (verbEndingMatch) {
        description = verbEndingMatch[1].trim()
        cleanName = verbEndingMatch[2].trim()
      }

      items.push({
        id: `extracted_${workspaceId}_${priority}`,
        workspaceId,
        name: cleanName,
        price: priceNum,
        priceFormatted: `${match[2]}원`,
        description: description || rawNameWithDesc,
        keyBenefits: description ? [description] : [],
        priority: priority++,
        isSignature,
        active: true,
      })
    }
  }

  return items
}

/**
 * Resolves dynamic persona based on actual business profile industry,
 * preventing salon assumptions from leaking into non-beauty industries.
 */
export function resolveIndustryPersona(
  industry: string | null,
  businessName: string
): {
  addressTerm: string
  industryCategory: 'FOOD_BEVERAGE' | 'BEAUTY_CLINIC' | 'RETAIL_COMMERCE' | 'GENERAL_SERVICE'
  industryVocabulary: string[]
  toneGuidelines: string
} {
  const ind = (industry || '').toLowerCase()
  const name = businessName.toLowerCase()

  const isBeautyClinic =
    ind.includes('뷰티') ||
    ind.includes('미용') ||
    ind.includes('피부') ||
    ind.includes('헤어') ||
    ind.includes('네일') ||
    ind.includes('속눈썹') ||
    ind.includes('의원') ||
    ind.includes('클리닉') ||
    ind.includes('학원') ||
    name.includes('의원') ||
    name.includes('뷰티') ||
    name.includes('클리닉')

  if (isBeautyClinic) {
    return {
      addressTerm: '원장님',
      industryCategory: 'BEAUTY_CLINIC',
      industryVocabulary: ['시술', '예약', '1:1 맞춤', '상담', '케어', '디자인', '피부', '자연스러움'],
      toneGuidelines: '전문적이고 정성스러운 1:1 케어 및 신뢰 중심 톤앤매너',
    }
  }

  const isFoodBeverage =
    ind.includes('카페') ||
    ind.includes('브런치') ||
    ind.includes('식당') ||
    ind.includes('음식') ||
    ind.includes('베이커리') ||
    ind.includes('요식') ||
    ind.includes('키친') ||
    ind.includes('디저트') ||
    ind.includes('커피') ||
    name.includes('카페') ||
    name.includes('키친') ||
    name.includes('브런치') ||
    name.includes('베이커리')

  if (isFoodBeverage) {
    return {
      addressTerm: '사장님',
      industryCategory: 'FOOD_BEVERAGE',
      industryVocabulary: ['메뉴', '신선한 재료', '정성', '풍미', '브런치', '디저트', '음료', '매장 분위기', '방문'],
      toneGuidelines: '신선한 식재료, 정성 가득한 맛, 매장의 따뜻한 채광과 여유로운 분위기를 전하는 다정하고 세련된 톤앤매너',
    }
  }

  const isRetail =
    ind.includes('쇼핑') ||
    ind.includes('커머스') ||
    ind.includes('의류') ||
    ind.includes('소품') ||
    ind.includes('잡화') ||
    ind.includes('판매')

  if (isRetail) {
    return {
      addressTerm: '대표님',
      industryCategory: 'RETAIL_COMMERCE',
      industryVocabulary: ['상품', '컬렉션', '주문', '혜택', '셀렉션', '품질', '배송'],
      toneGuidelines: '트렌디하고 감각적인 상품 가치와 소장 욕구를 자극하는 세련된 톤앤매너',
    }
  }

  return {
    addressTerm: '사장님',
    industryCategory: 'GENERAL_SERVICE',
    industryVocabulary: ['서비스', '고객 만족', '매장 소식', '정성', '방문 안내'],
    toneGuidelines: '신뢰감 있고 친절하며 사장님의 비즈니스 성장을 진심으로 돕는 전문적인 톤앤매너',
  }
}

/**
 * Builds the canonical workspace marketing context.
 * Single entry point used across AgentOrchestrator and ConversationBrain.
 */
export async function buildWorkspaceMarketingContext(
  workspaceId: string,
  options?: { client?: any }
): Promise<WorkspaceMarketingContext> {
  const supabase = options?.client || (await createServerSupabaseClient())
  const observedAt = new Date().toISOString()

  // 1. Fetch Business Profile
  const businessRes = await supabase
    .from('business_profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const rawBusiness = businessRes?.data || null
  const isBusinessConfigured = Boolean(rawBusiness?.business_name)

  const business = {
    status: (isBusinessConfigured ? 'CONFIGURED' : 'SETUP_REQUIRED') as 'CONFIGURED' | 'SETUP_REQUIRED',
    businessName: rawBusiness?.business_name || '매장',
    industry: rawBusiness?.industry || null,
    location: rawBusiness?.location || null,
    summary: rawBusiness?.summary || null,
  }

  // 2. Fetch Brand Profile
  const brandRes = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const rawBrand = brandRes?.data || null
  const isBrandConfigured = Boolean(rawBrand?.voice || (rawBrand?.keywords && rawBrand.keywords.length > 0))

  const brand = {
    status: (isBrandConfigured ? 'CONFIGURED' : 'SETUP_REQUIRED') as 'CONFIGURED' | 'SETUP_REQUIRED',
    voice: rawBrand?.voice || null,
    keywords: Array.isArray(rawBrand?.keywords) ? rawBrand.keywords : [],
    prohibitedTerms: Array.isArray(rawBrand?.prohibited_terms) ? rawBrand.prohibited_terms : [],
  }

  // 3. Structured Products & Services (ANI-1055)
  // Check table first; if empty or not present, extract from summary
  let products: StructuredProductService[] = []
  let productsSource: 'TABLE' | 'EXTRACTED_SUMMARY' | 'EMPTY' = 'EMPTY'

  try {
    const productsRes = await supabase
      .from('workspace_products_services')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('active', true)
      .order('priority', { ascending: true })

    if (productsRes?.data && Array.isArray(productsRes.data) && productsRes.data.length > 0) {
      products = productsRes.data.map((r: any) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        name: r.name,
        price: r.price,
        priceFormatted: r.price_formatted || (r.price != null ? `${Number(r.price).toLocaleString()}원` : null),
        description: r.description,
        keyBenefits: r.key_benefits || [],
        priority: r.priority,
        isSignature: Boolean(r.is_signature),
        active: r.active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
      productsSource = 'TABLE'
    }
  } catch {
    // If table doesn't exist yet, fallback to summary
  }

  if (products.length === 0 && business.summary) {
    const extracted = extractStructuredProductsFromSummary(business.summary, workspaceId)
    if (extracted.length > 0) {
      products = extracted
      productsSource = 'EXTRACTED_SUMMARY'
    }
  }

  const productsServices = {
    status: (products.length > 0 ? 'CONFIGURED' : 'EMPTY') as 'CONFIGURED' | 'EMPTY',
    items: products,
    source: productsSource,
  }

  // 4. Current Work Items (Active queue)
  let activeWorkCount = 0
  let latestWorkItem: { id: string; title: string; status: string } | null = null
  try {
    const workRes = await supabase
      .from('work_items')
      .select('id, title, status')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("published","cancelled","archived")')
      .order('created_at', { ascending: false })
      .limit(5)

    if (workRes?.data && Array.isArray(workRes.data)) {
      activeWorkCount = workRes.data.length
      if (workRes.data.length > 0) {
        latestWorkItem = workRes.data[0]
      }
    }
  } catch {
    // Safe ignore if work_items unavailable
  }

  // 5. Recent Verified Outcomes
  let recentResults: { lastPublishedAt?: string; channel?: string; url?: string }[] = []
  try {
    const receiptsRes = await supabase
      .from('external_action_receipts')
      .select('channel, provider_post_url, observed_at')
      .eq('workspace_id', workspaceId)
      .order('observed_at', { ascending: false })
      .limit(3)

    if (receiptsRes?.data && Array.isArray(receiptsRes.data)) {
      recentResults = receiptsRes.data.map((r: any) => ({
        channel: r.channel,
        url: r.provider_post_url,
        lastPublishedAt: r.observed_at,
      }))
    }
  } catch {
    // Safe ignore
  }

  // 6. Resolve Dynamic Persona
  const dynamicPersona = resolveIndustryPersona(business.industry, business.businessName)

  // 7. Channel Learning Grounding (ANI-2192)
  let learnedChannelKnowledge: WorkspaceMarketingContext['learnedChannelKnowledge'] | undefined
  if (process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1' && typeof (supabase as any)?.rpc === 'function') {
    try {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_approved_learning_context', {
        p_workspace_id: workspaceId,
        p_purpose: 'conversation',
        p_max_facts: 50,
        p_query: '',
      })
      if (!rpcError && rpcData) {
        const items = Array.isArray(rpcData.items) ? rpcData.items : Array.isArray(rpcData) ? rpcData : []
        const epoch = Number(rpcData.epoch ?? items[0]?.epoch ?? 1)
        const facts: Array<{ id: string; category: string; content: string }> = []
        const dependencies: Array<{ workspaceId: string; sourceId: string; revision: number }> = []
        const seenDeps = new Set<string>()

        for (const item of items) {
          if (item?.content && typeof item.content === 'string') {
            facts.push({
              id: String(item.id || ''),
              category: String(item.category || 'GENERAL'),
              content: item.content.trim(),
            })
          }
          if (Array.isArray(item?.dependencies)) {
            for (const dep of item.dependencies) {
              const sId = dep.sourceId || dep.source_id || dep.id
              if (sId) {
                const depWs = dep.workspaceId || dep.workspace_id || workspaceId
                const depRev = Number(dep.revision || dep.source_revision || 1)
                const key = `${depWs}:${sId}:${depRev}`
                if (!seenDeps.has(key)) {
                  seenDeps.add(key)
                  dependencies.push({ workspaceId: depWs, sourceId: String(sId), revision: depRev })
                }
              }
            }
          }
        }

        if (facts.length > 0) {
          learnedChannelKnowledge = {
            epoch,
            facts,
            dependencies,
          }
        }
      }
    } catch {
      // Safe fallback on RPC error
    }
  }

  // 8. Assemble Context Summary Markdown for AI System Prompt
  let contextSummary = ''
  const channelBlock =
    learnedChannelKnowledge && learnedChannelKnowledge.facts.length > 0
      ? `\n\n[학습된 매장 공식 채널 지식 (승인됨)]\n` +
        learnedChannelKnowledge.facts.map(f => `  - [${f.category}] ${f.content}`).join('\n')
      : ''

  if (!isBusinessConfigured && !isBrandConfigured) {
    contextSummary = [
      `[소희 AI 매장 마케팅 정본 맥락 (SSOT)]`,
      `• 매장 정보 상태: 매장 정보 설정 대기 (SETUP_REQUIRED)`,
      `• 안내: 아직 등록된 사업자 프로필이 없습니다. 기본 설정을 마친 후 정확한 매장 정보 기반 마케팅을 진행할 수 있습니다.`,
      `• 호칭: ${dynamicPersona.addressTerm}`,
      channelBlock,
    ].join('\n')
  } else {
    const productsBlock =
      products.length > 0
        ? products
            .map(
              p =>
                `  - ${p.isSignature ? '[대표 시그니처] ' : ''}${p.name}${
                  p.priceFormatted ? ` (${p.priceFormatted})` : ''
                }${p.description ? `: ${p.description}` : ''}`
            )
            .join('\n')
        : '  (등록된 대표 상품 없음)'

    const prohibitedBlock =
      brand.prohibitedTerms.length > 0
        ? `\n\n[절대 사용 금지어 (Hard Policy - 위반 시 발행 차단)]\n${brand.prohibitedTerms.join(', ')}`
        : ''

    const keywordsBlock =
      brand.keywords.length > 0 ? `\n\n[핵심 강조 키워드]\n${brand.keywords.join(', ')}` : ''

    const voiceBlock = brand.voice ? `\n\n[브랜드 고유 말투 및 톤앤매너]\n${brand.voice}` : ''

    contextSummary = [
      `[소희 AI 매장 마케팅 정본 맥락 (SSOT)]`,
      `• 매장명: ${business.businessName}`,
      `• 업종: ${business.industry || '미지정'} (${dynamicPersona.industryCategory})`,
      `• 위치: ${business.location || '미등록'}`,
      `• 호칭: ${dynamicPersona.addressTerm}`,
      `• 톤앤매너 가이드: ${dynamicPersona.toneGuidelines}`,
      `\n[대표 메뉴 및 서비스 (정형 데이터 Grounding Fact)]\n${productsBlock}`,
      voiceBlock,
      keywordsBlock,
      prohibitedBlock,
      channelBlock,
    ]
      .filter(Boolean)
      .join('')
  }

  // Generate deterministic version hash
  const contextVersion = `ctx_${Buffer.from(
    `${workspaceId}_${business.businessName}_${brand.prohibitedTerms.join('_')}_${products.length}`
  ).toString('base64url').slice(0, 16)}`

  return {
    workspaceId,
    business,
    brand,
    productsServices,
    policies: {
      maxDiscountRate: 20,
      hardPolicyNotice: brand.prohibitedTerms.length > 0 ? `금지어 포함 금지: ${brand.prohibitedTerms.join(', ')}` : undefined,
    },
    currentWork: {
      activeWorkItemsCount: activeWorkCount,
      latestWorkItem,
    },
    recentVerifiedResults: recentResults,
    dynamicPersona,
    learnedChannelKnowledge,
    contextSummary,
    contextVersion,
    observedAt,
  }
}
