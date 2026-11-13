import { containsFactPlaceholder } from '@/features/knowledge/fact-placeholder'
import { sanitizeBusinessText } from '@/features/quick-start/sanitize-business-text'
import { resolveWritingStyle } from '@/features/text-harness/resolve-writing-style'
import type { GroundedBusinessContext, GroundedFact, GroundedFactKind } from './types'
import { ChannelDraftError } from './types'

export interface KnowledgeGateway {
  profile(workspaceId: string): Promise<{ data: any; error: any }>
  knowledge(workspaceId: string): Promise<{ data: any; error: any }>
  textRule(workspaceId: string): Promise<{ data: any; error: any }>
  facts?(workspaceId: string): Promise<{ data: any; error: any }>
  businessDetails?(workspaceId: string): Promise<{ data: any; error: any }>
}

/** The caller must first authorize access to this workspace. Never use a browser/service-role client here. */
export function createSupabaseKnowledgeGateway(admin: any): KnowledgeGateway {
  return {
    profile: (workspaceId) => admin.from('business_profiles')
      .select('business_name, industry, location, summary').eq('workspace_id', workspaceId).maybeSingle(),
    knowledge: (workspaceId) => admin.from('workspace_knowledge_harnesses')
      .select('version_no, business_identity, offerings, policies, audience, brand_voice')
      .eq('workspace_id', workspaceId).eq('is_active', true)
      .order('version_no', { ascending: false }).limit(1).maybeSingle(),
    textRule: (workspaceId) => admin.from('harness_rules')
      .select('structured_rule').eq('workspace_id', workspaceId)
      .eq('rule_type', 'text_generation').eq('status', 'active')
      .order('version', { ascending: false }).limit(1).maybeSingle(),
    // The RPC preserves approved manual/file knowledge and rejects revoked, expired or unverified channel sources.
    // Missing migration/authority is an explicit error, never a fallback to unfiltered active facts.
    facts: (workspaceId) => typeof admin?.rpc === 'function'
      ? admin.rpc('get_approved_learning_context', {
          p_workspace_id: workspaceId, p_purpose: 'content', p_max_facts: 1000, p_query: '',
        })
      : Promise.resolve({ data: null, error: null }),
    // 사장님이 가입 첫 화면에서 직접 적은 운영 정보. 사업자등록번호·대표자명은 개인정보라 제외한다.
    businessDetails: (workspaceId) => admin.from('workspace_business_details')
      .select('business_type, business_item, business_hours, closed_days, parking_info, reservation_method, price_range, website_url')
      .eq('workspace_id', workspaceId).maybeSingle(),
  }
}

const MAX_FACTS = 32
const MAX_FACT_LENGTH = 240
const MAX_LABEL_LENGTH = 50
const clean = (value: unknown, maxLength = MAX_FACT_LENGTH): string =>
  typeof value === 'string' && !containsFactPlaceholder(value) ? sanitizeBusinessText(value, maxLength) : ''

function collectFacts(kind: GroundedFactKind, source: unknown, facts: GroundedFact[], defaultLabel: string): void {
  const add = (label: string, value: unknown) => {
    if (facts.length >= MAX_FACTS) return
    const text = clean(value)
    if (text && !facts.some((fact) => fact.kind === kind && fact.value === text)) {
      facts.push({ kind, label: clean(label, MAX_LABEL_LENGTH) || defaultLabel, value: text })
    }
  }
  if (typeof source === 'string') { add(defaultLabel, source); return }
  if (Array.isArray(source)) {
    for (const item of source.slice(0, MAX_FACTS)) {
      if (typeof item === 'string') add(defaultLabel, item)
      else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const entry = item as Record<string, unknown>
        // Structured, explicitly confirmed entries from the active knowledge version only.
        add(clean(entry.key, MAX_LABEL_LENGTH) || clean(entry.label, MAX_LABEL_LENGTH) || defaultLabel, entry.value)
      }
    }
    return
  }
  if (source && typeof source === 'object') {
    for (const [label, value] of Object.entries(source).slice(0, MAX_FACTS)) {
      if (typeof value === 'string') add(label, value)
      else if (Array.isArray(value)) collectFacts(kind, value, facts, label)
    }
  }
}

function mapFactCategory(category: unknown): { kind: GroundedFactKind; label: string } {
  const cat = typeof category === 'string' ? category.trim().toUpperCase() : ''
  switch (cat) {
    case 'MENU':
      return { kind: 'offering', label: '메뉴' }
    case 'PRICE':
      return { kind: 'offering', label: '가격' }
    case 'HOURS':
      return { kind: 'policy', label: '영업시간' }
    case 'DIFFERENTIATOR':
      return { kind: 'identity', label: '매장 특징' }
    case 'FAQ':
      return { kind: 'policy', label: '자주 묻는 질문' }
    case 'PROHIBITED':
      return { kind: 'policy', label: '주의할 점' }
    default:
      return { kind: 'identity', label: clean(category, MAX_LABEL_LENGTH) || '기타' }
  }
}

function hasFact(facts: GroundedFact[], pattern: RegExp): boolean {
  return facts.some(({ label, value }) => pattern.test(`${label} ${value}`))
}

function isFactValid(item: any, now: number): boolean {
  if (!item || !clean(item.content)) return false
  if (item.status && item.status !== 'active') return false
  if (
    item.is_revoked === true
    || item.source_status === 'revoked'
    || item.source_status === 'expired'
    || item.lease_expired === true
  ) {
    return false
  }
  // Channel-derived facts are strictly gated behind SOHEE_CHANNEL_LEARNING_ENABLED.
  // Manual & file verified knowledge is always preserved.
  if (item.source_type === 'channel' && process.env.SOHEE_CHANNEL_LEARNING_ENABLED !== '1') {
    return false
  }
  if (item.valid_until) {
    const until = new Date(item.valid_until).getTime()
    if (!Number.isNaN(until) && until <= now) {
      return false
    }
  }
  return true
}

export async function loadGroundedBusinessContext(
  workspaceId: string, gateway: KnowledgeGateway,
): Promise<GroundedBusinessContext> {

  let profileResult: Awaited<ReturnType<KnowledgeGateway['profile']>>
  let knowledgeResult: Awaited<ReturnType<KnowledgeGateway['knowledge']>>
  let textRuleResult: Awaited<ReturnType<KnowledgeGateway['textRule']>>
  let factsResult: { data: any; error: any } = { data: null, error: null }
  let detailsResult: { data: any; error: any } = { data: null, error: null }

  try {
    const queries: [
      ReturnType<KnowledgeGateway['profile']>,
      ReturnType<KnowledgeGateway['knowledge']>,
      ReturnType<KnowledgeGateway['textRule']>,
      Promise<{ data: any; error: any }>,
      Promise<{ data: any; error: any }>,
    ] = [
      gateway.profile(workspaceId),
      gateway.knowledge(workspaceId),
      gateway.textRule(workspaceId),
      gateway.facts ? gateway.facts(workspaceId) : Promise.resolve({ data: null, error: null }),
      gateway.businessDetails ? gateway.businessDetails(workspaceId) : Promise.resolve({ data: null, error: null }),
    ]
    const results = await Promise.all(queries)
    profileResult = results[0]
    knowledgeResult = results[1]
    textRuleResult = results[2]
    factsResult = results[3]
    detailsResult = results[4]
  } catch {
    throw new ChannelDraftError('가게 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'KNOWLEDGE_UNAVAILABLE', 503)
  }

  if (
    !profileResult || profileResult.error
    || !knowledgeResult || knowledgeResult.error
    || !textRuleResult || textRuleResult.error
    || (factsResult && factsResult.error)
  ) {
    throw new ChannelDraftError('가게 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'KNOWLEDGE_UNAVAILABLE', 503)
  }

  const profile = profileResult.data
  const knowledge = knowledgeResult.data
  const textRule = textRuleResult.data
  const factsEnvelope = factsResult?.data
  const rawKnowledgeFacts: any[] = Array.isArray(factsEnvelope?.items)
    ? factsEnvelope.items
    : Array.isArray(factsEnvelope)
    ? factsEnvelope
    : []
  const epoch: number = typeof factsEnvelope?.epoch === 'number' ? factsEnvelope.epoch : 1

  // The Supabase adapter filters on workspace_id; also refuse foreign rows from alternate gateways.
  if (
    [profile, knowledge, textRule].some((row) => row?.workspace_id && row.workspace_id !== workspaceId)
    || rawKnowledgeFacts.some((row) => row?.workspace_id && row.workspace_id !== workspaceId)
  ) {
    throw new ChannelDraftError('가게 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'KNOWLEDGE_UNAVAILABLE', 503)
  }

  const hasLegacyKnowledge = Boolean(
    knowledge && knowledge.is_active !== false && Number.isSafeInteger(knowledge.version_no) && knowledge.version_no >= 1,
  )
  const now = Date.now()
  const validFacts = rawKnowledgeFacts.filter((item) => isFactValid(item, now))
  const hasValidFacts = validFacts.length > 0

  if (!profile || !clean(profile.business_name, 120)) {
    throw new ChannelDraftError('나의 지식에서 가게 정보를 먼저 확인해 주세요.', 'KNOWLEDGE_MISSING', 409)
  }

  if (!hasLegacyKnowledge && !hasValidFacts) {
    throw new ChannelDraftError('나의 지식에서 가게 정보를 먼저 확인해 주세요.', 'KNOWLEDGE_MISSING', 409)
  }

  if (knowledge && knowledge.is_active === false && !hasValidFacts) {
    throw new ChannelDraftError('나의 지식에서 가게 정보를 먼저 확인해 주세요.', 'KNOWLEDGE_MISSING', 409)
  }

  const dependencies: Array<{ workspaceId: string; sourceId: string; revision: number }> = []
  const seenDeps = new Set<string>()

  for (const factItem of validFacts) {
    if (factItem?.source_type === 'channel' && factItem?.source_id) {
      const sourceId = String(factItem.source_id)
      const sourceRevision = Number(factItem.source_revision ?? 1)
      const key = `${workspaceId}:${sourceId}:${sourceRevision}`
      if (!seenDeps.has(key)) {
        seenDeps.add(key)
        dependencies.push({ workspaceId, sourceId, revision: sourceRevision })
      }
    }
  }

  const facts: GroundedFact[] = []
  for (const [label, value] of [
    ['상호', profile.business_name], ['업종', profile.industry], ['지역', profile.location], ['소개', profile.summary],
  ] as const) {
    collectFacts('profile', value, facts, label)
  }

  for (const factItem of validFacts) {
    if (facts.length >= MAX_FACTS) break
    const text = clean(factItem?.content)
    if (!text) continue
    const { kind, label } = mapFactCategory(factItem?.category)
    const finalLabel = clean(label, MAX_LABEL_LENGTH) || '기타'
    if (!facts.some((fact) => fact.kind === kind && fact.value === text)) {
      facts.push({ kind, label: finalLabel, value: text })
    }
  }

  // 사장님이 가입 첫 화면에서 직접 적은 운영 정보를 사실로 편입한다.
  // 사업자등록번호·대표자명은 개인정보이자 마케팅 문구에 불필요하므로 절대 넣지 않는다.
  const details = detailsResult?.data
  if (details && typeof details === 'object') {
    for (const [key, kind, label] of [
      ['business_hours', 'policy', '영업시간'],
      ['closed_days', 'policy', '휴무일'],
      ['parking_info', 'policy', '주차 안내'],
      ['reservation_method', 'policy', '예약 안내'],
      ['price_range', 'offering', '가격대'],
      ['business_type', 'identity', '업태'],
      ['business_item', 'identity', '종목'],
      ['website_url', 'identity', '웹사이트'],
    ] as const) {
      if (facts.length >= MAX_FACTS) break
      const text = clean((details as Record<string, unknown>)[key])
      if (!text) continue
      if (!facts.some((fact) => fact.kind === kind && fact.value === text)) {
        facts.push({ kind, label, value: text })
      }
    }
  }

  // These JSON columns can contain compiler metadata and permission ceilings. Only known owner-facing
  // fields are business facts; arbitrary keys and internal limits must never become marketing copy.
  if (hasLegacyKnowledge && knowledge) {
    const identity = knowledge.business_identity
    if (typeof identity === 'string' || Array.isArray(identity)) collectFacts('identity', identity, facts, '가게 소개')
    else if (identity && typeof identity === 'object') {
      for (const [key, label] of [
        ['businessName', '상호'], ['businessType', '가게 종류'], ['brandSummary', '가게 소개'],
        ['locationDistrict', '지역'], ['operatingHours', '영업시간'],
      ] as const) collectFacts('identity', identity[key], facts, label)
      collectFacts('identity', identity.differentiators, facts, '가게 특징')
    }
    collectFacts('offering', knowledge.offerings, facts, '서비스')
    const policies = knowledge.policies
    if (typeof policies === 'string' || Array.isArray(policies)) collectFacts('policy', policies, facts, '운영 안내')
    else if (policies && typeof policies === 'object') {
      for (const [key, label] of [
        ['operatingHours', '영업시간'], ['hours', '영업시간'], ['parking', '주차 안내'],
        ['reservation', '예약 안내'], ['refund', '환불 안내'],
      ] as const) collectFacts('policy', policies[key], facts, label)
    }
    const audience = knowledge.audience
    if (typeof audience === 'string' || Array.isArray(audience)) collectFacts('audience', audience, facts, '대상 고객')
    else if (audience && typeof audience === 'object') {
      collectFacts('audience', audience.primaryTarget, facts, '대상 고객')
      collectFacts('audience', audience.targetRegions, facts, '대상 지역')
    }
  }

  const warnings: string[] = []
  if (!hasFact(facts, /(?:\d[\d,.]*\s*(?:원|₩)|가격|가격표|정가|판매가|요금|비용|금액|메뉴판)/u)) {
    warnings.push('가격 정보가 없어서 가격 문구는 넣지 않아요.')
  }
  if (!hasFact(facts, /(?:할인|쿠폰|무료|증정|이벤트|혜택|사은품|특가|프로모션)/u)) {
    warnings.push('혜택 정보가 없어서 할인·쿠폰 문구는 넣지 않아요.')
  }
  if (!hasFact(facts, /(?:영업시간|운영시간|오픈|마감|정기휴무|휴무일|\d{1,2}:\d{2})/u)) {
    warnings.push('영업시간 정보가 없어서 운영 시간은 안내하지 않아요.')
  }

  return {
    businessName: clean(profile.business_name, 120),
    industry: clean(profile.industry, 120), location: clean(profile.location, 200),
    facts,
    knowledgeVersion: hasLegacyKnowledge && knowledge ? knowledge.version_no : 1,
    warnings,
    epoch,
    dependencies,
    tone: {
      presetKey: null,
      brandVoice: resolveWritingStyle(
        textRule?.structured_rule,
        knowledge?.brand_voice?.brandVoice || knowledge?.brand_voice?.text || knowledge?.brand_voice,
      ),
    },
  }
}
