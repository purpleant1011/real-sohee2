import { z } from 'zod'
import { getTonePreset, TONE_PRESET_KEYS } from './tone-presets'
import { businessDetailsSchema } from './business-details'

export const quickStartInputSchema = z.object({
  businessName: z.string().trim().min(1, '매장 이름을 입력해 주세요.').max(60),
  industry: z.string().trim().min(1, '업종을 선택하거나 입력해 주세요.').max(40),
  location: z.string().trim().max(60).optional().default(''),
  summary: z.string().trim().min(1, '한 줄 소개를 입력해 주세요.').max(300),
  offerings: z.array(z.string().trim().min(1).max(60)).max(8).optional().default([]),
  tone: z.enum(TONE_PRESET_KEYS).default('friendly'),
  goal: z.string().trim().max(300).optional(),
  /** 사장님이 직접 입력한 사업자·운영 정보(선택). 네이버 링크가 없어도 입력할 수 있다. */
  businessDetails: businessDetailsSchema.optional(),
})
export type QuickStartInput = z.infer<typeof quickStartInputSchema>

export const quickStartProgressSchema = z.object({
  businessName: z.string().trim().min(1).max(60),
  industry: z.string().trim().max(40),
  location: z.string().trim().max(60),
  summary: z.string().trim().max(300),
})

type AdminClient = any

/** Partial owner input is saved without claiming onboarding readiness or calling a provider. */
export async function saveQuickStartProgress(params: {
  admin: AdminClient; workspaceId: string; input: z.infer<typeof quickStartProgressSchema>
}): Promise<void> {
  const input = quickStartProgressSchema.parse(params.input)
  const result = await params.admin.from('business_profiles').upsert({
    workspace_id: params.workspaceId, business_name: input.businessName,
    industry: input.industry || null, location: input.location || null,
    summary: input.summary || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' })
  throwIfError('PROGRESS_SAVE', result.error)
}

const QUICK_ACTOR_NOTE = 'quick-start'

export async function loadQuickStartPreferences(params: { admin: AdminClient; workspaceId: string }) {
  const result = await params.admin.from('workspace_knowledge_harnesses')
    .select('business_identity,brand_voice').eq('workspace_id', params.workspaceId)
    .eq('is_active', true).limit(1).maybeSingle()
  throwIfError('PREFERENCES_READ', result.error)
  const identity = result.data?.business_identity
  const tone = z.enum(TONE_PRESET_KEYS).safeParse(result.data?.brand_voice?.preset)
  return {
    goal: identity?.source === QUICK_ACTOR_NOTE && typeof identity.marketingGoal === 'string' ? identity.marketingGoal : '',
    tone: tone.success ? tone.data : 'friendly' as const,
  }
}

export interface QuickStartProfile {
  business_name: string
  industry: string | null
  location: string | null
  summary: string | null
}

/** Read only server-persisted owner facts; never infer an industry from a shop name. */
export async function loadQuickStartProfile(params: {
  admin: AdminClient; workspaceId: string; userId: string
}): Promise<QuickStartProfile | null> {
  const { admin, workspaceId, userId } = params
  const profile = await admin.from('business_profiles')
    .select('business_name, industry, location, summary').eq('workspace_id', workspaceId).maybeSingle()
  throwIfError('PROFILE_READ', profile.error)
  const usableName = (value: unknown): value is string => typeof value === 'string'
    && Boolean(value.trim()) && value.trim() !== '신규 매장' && !value.trim().endsWith('의 워크스페이스')
  if (usableName(profile.data?.business_name)) return profile.data

  const application = await admin.from('signup_applications').select('company_name')
    .eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle()
  throwIfError('SIGNUP_READ', application.error)
  let name = application.data?.company_name
  if (!usableName(name)) {
    const workspace = await admin.from('workspaces').select('name').eq('id', workspaceId).maybeSingle()
    throwIfError('WORKSPACE_READ', workspace.error)
    name = workspace.data?.name
  }
  if (!usableName(name)) return null
  return {
    business_name: name.trim(),
    industry: profile.data?.industry ?? null,
    location: profile.data?.location ?? null,
    summary: profile.data?.summary ?? null,
  }
}

function throwIfError(label: string, error: { message?: string } | null | undefined) {
  if (error) throw new Error(`[QUICK_START_${label}] ${error.message ?? 'database error'}`)
}

/**
 * Persists the four things the first-post lane needs from four owner answers:
 * business profile + knowledge snapshot + text rule (voice) + image rule + approval policy.
 * Idempotent: re-running updates the existing active records in place, so approved-but-unpublished
 * drafts keep their bound versions and are not invalidated by version drift.
 */
export async function applyQuickStart(params: {
  admin: AdminClient
  workspaceId: string
  userId: string
  input: QuickStartInput
}): Promise<{ workspaceId: string }> {
  const { admin, workspaceId, userId, input } = params
  const now = new Date().toISOString()
  const tone = getTonePreset(input.tone)

  const ws = await admin.from('workspaces').update({ name: input.businessName }).eq('id', workspaceId)
  throwIfError('WORKSPACE', ws.error)

  const profile = await admin.from('business_profiles').upsert(
    {
      workspace_id: workspaceId,
      business_name: input.businessName,
      industry: input.industry,
      location: input.location || null,
      summary: input.summary,
      updated_at: now,
    },
    { onConflict: 'workspace_id' },
  )
  throwIfError('PROFILE', profile.error)

  // 사장님이 직접 입력한 사업자·운영 정보. 자가 입력이므로 검증 상태를 만들지 않는다.
  if (input.businessDetails) {
    const details = input.businessDetails
    const detailsRow = {
      workspace_id: workspaceId,
      business_number: details.businessNumber || null,
      representative_name: details.representativeName || null,
      business_start_date: details.businessStartDate || null,
      business_type: details.businessType || null,
      business_item: details.businessItem || null,
      phone: details.phone || null,
      business_hours: details.businessHours || null,
      closed_days: details.closedDays || null,
      parking_info: details.parkingInfo || null,
      reservation_method: details.reservationMethod || null,
      website_url: details.websiteUrl || null,
      price_range: details.priceRange || null,
      naver_place_url: details.naverPlaceUrl || null,
      intake_source: details.intakeSource,
      updated_at: now,
    }
    const savedDetails = await admin
      .from('workspace_business_details')
      .upsert(detailsRow, { onConflict: 'workspace_id' })
    throwIfError('BUSINESS_DETAILS', savedDetails.error)
  }

  const offerings = input.offerings.map((value, i) => ({ key: `offering-${i + 1}`, value }))
  const businessIdentity = {
    name: input.businessName,
    industry: input.industry,
    location: input.location,
    summary: input.summary,
    ...(input.goal ? { marketingGoal: input.goal } : {}),
    source: QUICK_ACTOR_NOTE,
  }

  const knowledge = await admin
    .from('workspace_knowledge_harnesses')
    .select('harness_version_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  throwIfError('KNOWLEDGE_READ', knowledge.error)

  if (knowledge.data) {
    const upd = await admin
      .from('workspace_knowledge_harnesses')
      .update({ business_identity: businessIdentity, offerings, brand_voice: { preset: tone.key, text: tone.brandVoice } })
      .eq('workspace_id', workspaceId)
      .eq('harness_version_id', knowledge.data.harness_version_id)
    throwIfError('KNOWLEDGE_UPDATE', upd.error)
  } else {
    const ins = await admin.from('workspace_knowledge_harnesses').insert({
      harness_version_id: `quick-${workspaceId}-v1`,
      workspace_id: workspaceId,
      version_no: 1,
      is_active: true,
      business_identity: businessIdentity,
      offerings,
      audience: {},
      brand_voice: { preset: tone.key, text: tone.brandVoice },
      policies: [],
      channel_truth: {},
    })
    throwIfError('KNOWLEDGE_INSERT', ins.error)
  }

  await upsertActiveRule(admin, {
    workspaceId,
    userId,
    now,
    ruleType: 'text_generation',
    ruleKey: 'quick-text-voice',
    title: `${input.businessName} 글 쓰는 기준`,
    structuredRule: {
      brandVoice: tone.brandVoice,
      tonePreset: tone.key,
      rules: ['사실로 확인된 정보만 사용', '허위·과장 표현 금지', '이모지는 절제해서 사용'],
      source: QUICK_ACTOR_NOTE,
    },
  })

  await upsertActiveRule(admin, {
    workspaceId,
    userId,
    now,
    ruleType: 'image_generation',
    ruleKey: 'quick-image-style',
    title: `${input.businessName} 이미지 기준`,
    structuredRule: {
      source: 'AI_GENERATED',
      goldenImageIds: [],
      rules: {
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        style: '실제 매장 분위기가 느껴지는 자연스러운 사진 느낌, 글자·로고·워터마크 없음',
      },
    },
  })

  await upsertActiveRule(admin, {
    workspaceId,
    userId,
    now,
    ruleType: 'approval_policy',
    ruleKey: 'quick-approval-policy',
    title: '발행 전 항상 사장님 승인',
    structuredRule: {
      publishApprovalLevel: 'ALWAYS_REQUIRE',
      dailySpendLimitKrw: 0,
      maxDailyPublishCount: 3,
      source: QUICK_ACTOR_NOTE,
    },
  })

  return { workspaceId }
}

async function upsertActiveRule(
  admin: AdminClient,
  p: {
    workspaceId: string
    userId: string
    now: string
    ruleType: string
    ruleKey: string
    title: string
    structuredRule: Record<string, unknown>
  },
) {
  const existing = await admin
    .from('harness_rules')
    .select('id')
    .eq('workspace_id', p.workspaceId)
    .eq('rule_type', p.ruleType)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  throwIfError(`RULE_READ_${p.ruleType}`, existing.error)

  if (existing.data) {
    // Only owner-visible voice/style settings are refreshed; version and approval evidence stay intact.
    if (p.ruleType === 'approval_policy' || p.ruleType === 'image_generation') return
    const upd = await admin
      .from('harness_rules')
      .update({ structured_rule: p.structuredRule, title: p.title, updated_at: p.now })
      .eq('id', existing.data.id)
    throwIfError(`RULE_UPDATE_${p.ruleType}`, upd.error)
    return
  }

  const ins = await admin.from('harness_rules').insert({
    workspace_id: p.workspaceId,
    rule_key: p.ruleKey,
    rule_type: p.ruleType,
    title: p.title,
    structured_rule: p.structuredRule,
    applies_to_channels: ['instagram', 'threads'],
    status: 'active',
    version: 1,
    approved_by_user_id: p.userId,
    approved_at: p.now,
    created_by_user_id: p.userId,
  })
  throwIfError(`RULE_INSERT_${p.ruleType}`, ins.error)
}
