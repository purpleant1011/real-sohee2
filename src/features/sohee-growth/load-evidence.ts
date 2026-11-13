import { isMeaningfulText } from './constants'
import type { GrowthEvidence, MembershipTierKey } from './types'

export interface GrowthEvidenceDeps {
  admin: { from(table: string): any }
  isChannelVerified(workspaceId: string, channel: 'instagram' | 'threads'): Promise<boolean>
  getTier(workspaceId: string): Promise<MembershipTierKey>
}

/** 자료로 세지 않는 상태 (처리 실패·거절·일시정지) */
const EXCLUDED_SOURCE_STATUSES = new Set(['failed', 'rejected', 'paused'])

async function defaultDeps(): Promise<GrowthEvidenceDeps> {
  const [{ createAdminSupabaseClient }, { getPersistedChannelVerification }, { getMembershipTier }] = await Promise.all([
    import('@/lib/supabase/admin'),
    import('@/features/channels/dual-channel-verification'),
    import('@/features/membership/membership-tier'),
  ])
  const admin = createAdminSupabaseClient() as unknown as { from(table: string): any }
  return {
    admin,
    isChannelVerified: async (workspaceId, channel) => Boolean((await getPersistedChannelVerification(workspaceId, channel))?.verified),
    getTier: (workspaceId) => getMembershipTier(admin, workspaceId) as Promise<MembershipTierKey>,
  }
}

function fail(): never {
  throw new Error('GROWTH_EVIDENCE_READ_FAILED')
}

async function read<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await query
  if (error) fail()
  return data
}

export async function loadGrowthEvidence(workspaceId: string, injected?: GrowthEvidenceDeps): Promise<GrowthEvidence> {
  const deps = injected ?? (await defaultDeps())
  const { admin } = deps

  const [business, brand, facts, rules, sources, items, instagram, threads, tier] = await Promise.all([
    read<{ business_name?: string; industry?: string; location?: string; summary?: string }>(
      admin.from('business_profiles').select('business_name, industry, location, summary').eq('workspace_id', workspaceId).maybeSingle(),
    ),
    read<{ voice?: string; keywords?: string[]; prohibited_terms?: string[] }>(
      admin.from('brand_profiles').select('voice, keywords, prohibited_terms').eq('workspace_id', workspaceId).maybeSingle(),
    ),
    read<Array<{ category: string }>>(
      admin.from('knowledge_facts').select('category').eq('workspace_id', workspaceId).eq('status', 'active').limit(500),
    ),
    read<Array<{ rule_type: string; status: string; approved_at: string | null }>>(
      admin.from('harness_rules').select('rule_type, status, approved_at').eq('workspace_id', workspaceId).eq('status', 'active').limit(100),
    ),
    read<Array<{ status: string }>>(
      admin.from('knowledge_sources').select('status').eq('workspace_id', workspaceId).limit(200),
    ),
    read<Array<{ status: string }>>(
      admin.from('knowledge_items').select('status').eq('workspace_id', workspaceId).limit(200),
    ),
    deps.isChannelVerified(workspaceId, 'instagram'),
    deps.isChannelVerified(workspaceId, 'threads'),
    deps.getTier(workspaceId),
  ])

  const factCounts: Record<string, number> = {}
  for (const row of facts ?? []) {
    const key = String(row.category ?? '').trim().toUpperCase()
    if (key) factCounts[key] = (factCounts[key] ?? 0) + 1
  }

  const activeRules = rules ?? []
  const hasRule = (type: string, needApproval = false) =>
    activeRules.some((r) => r.rule_type === type && r.status === 'active' && (!needApproval || Boolean(r.approved_at)))

  const validSourcesCount = (sources ?? []).filter((s) => !EXCLUDED_SOURCE_STATUSES.has(s.status)).length
  const validItemsCount = (items ?? []).filter((i) => i.status === 'approved').length

  return {
    profile: {
      nameValid: isMeaningfulText(business?.business_name),
      industryValid: isMeaningfulText(business?.industry),
      locationValid: isMeaningfulText(business?.location),
      summaryValid: isMeaningfulText(business?.summary),
      voiceValid: isMeaningfulText(brand?.voice),
      keywordCount: (brand?.keywords ?? []).filter((k) => isMeaningfulText(k, 1)).length,
      prohibitedTermCount: (brand?.prohibited_terms ?? []).filter((k) => isMeaningfulText(k, 1)).length,
    },
    factCounts,
    harness: {
      text: hasRule('text_generation'),
      image: hasRule('image_generation'),
      approvalPolicy: hasRule('approval_policy', true),
    },
    sourceCount: validSourcesCount + validItemsCount,
    channels: { instagram, threads },
    tier,
  }
}
