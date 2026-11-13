import 'server-only'

import { z } from 'zod'
import type { Json } from '@/lib/supabase/database.types'
import type { ServerSupabaseClient } from '@/features/operations/types'
import {
  BYREUM_IMAGE_HARNESS,
  parseByreumImageHarness,
  type ByreumImageChannel,
  type ByreumImageHarness,
} from './byreum-image-harness'

const uuidSchema = z.string().uuid()
export const BYREUM_TEST_ACCOUNT_EMAIL = 'test@example.com' as const
export const BYREUM_IMAGE_HARNESS_RULE_KEY = 'byreum-recommended-image-v1' as const
const sourceDisplayName = '바이름 추천 이미지 하네스 V1.0 원문'
const factCategory = 'image_generation_harness'
const factContent = [
  '바이름 이미지 생성은 BYREUM_RECOMMENDED_HARNESS_V1.0만 사용한다.',
  '인스타그램, 스레드, 네이버 블로그용 결과는 4:5 PNG 초안이며 글자·로고·워터마크를 넣지 않는다.',
  '21~38세의 서로 다른 합성 한국 성인, 흰색 3단 주름 마스크, 자연스러운 회갈색 눈썹, 실제 휴대전화 촬영 질감을 유지한다.',
  '실제 고객 결과나 전후 사례로 주장하지 않고 원장 승인 전 DRAFT_OWNER_APPROVAL_PENDING 상태로 둔다.',
].join(' ')

export type StoredByreumImageHarness = Readonly<{
  ruleId: string
  version: number
  harness: ByreumImageHarness
}>

export function isByreumTestAccount(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === BYREUM_TEST_ACCOUNT_EMAIL
}

export async function loadActiveByreumImageHarness(input: {
  client: ServerSupabaseClient
  workspaceId: string
  channel: ByreumImageChannel
}): Promise<StoredByreumImageHarness | null> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const result = await input.client.from('harness_rules')
    .select('id, version, structured_rule')
    .eq('workspace_id', workspaceId)
    .eq('rule_key', BYREUM_IMAGE_HARNESS_RULE_KEY)
    .eq('status', 'active')
    .contains('applies_to_channels', [input.channel])
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (result.error) throw new Error('byreum_image_harness_unavailable')
  if (!result.data) return null

  return Object.freeze({
    ruleId: uuidSchema.parse(result.data.id),
    version: z.number().int().positive().parse(result.data.version),
    harness: parseByreumImageHarness(result.data.structured_rule),
  })
}

export async function ensureByreumImageHarnessForTestWorkspace(input: {
  client: ServerSupabaseClient
  workspaceId: string
  userId: string
  email: string | null | undefined
}): Promise<StoredByreumImageHarness | null> {
  if (!isByreumTestAccount(input.email)) return null
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const userId = uuidSchema.parse(input.userId)

  const existing = await loadActiveByreumImageHarness({
    client: input.client,
    workspaceId,
    channel: 'instagram',
  })
  if (existing) return existing

  const sourceResult = await input.client.from('knowledge_sources')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('display_name', sourceDisplayName)
    .limit(1)
    .maybeSingle()
  if (sourceResult.error) throw new Error('byreum_harness_source_unavailable')
  let sourceId = sourceResult.data?.id
  if (!sourceId) {
    const inserted = await input.client.from('knowledge_sources').insert({
      workspace_id: workspaceId,
      source_type: 'manual',
      provider_mode: 'registered_only',
      display_name: sourceDisplayName,
      status: 'approved',
      version: 1,
      refresh_policy: { immutableVersion: '1.0.0', sourceDate: '2026-08-05' },
      created_by_user_id: userId,
    }).select('id').single()
    if (inserted.error || !inserted.data) throw new Error('byreum_harness_source_create_failed')
    sourceId = inserted.data.id
  }

  const candidateResult = await input.client.from('knowledge_candidates')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('knowledge_source_id', sourceId)
    .eq('category', factCategory)
    .limit(1)
    .maybeSingle()
  if (candidateResult.error) throw new Error('byreum_harness_candidate_unavailable')
  let candidateId = candidateResult.data?.id
  if (!candidateId) {
    const inserted = await input.client.from('knowledge_candidates').insert({
      workspace_id: workspaceId,
      knowledge_source_id: sourceId,
      category: factCategory,
      content: factContent,
      source_location: 'Drive 전체 자료/05. 하네스/BYREUM_RECOMMENDED_HARNESS_V1.0_2026-08-05',
      confidence: 1,
      status: 'approved',
      version: 1,
      review_reason: '사용자가 바이름 테스트 작업공간의 활성 이미지 하네스로 지정함',
      reviewed_by_user_id: userId,
      reviewed_at: new Date().toISOString(),
      created_by_user_id: userId,
    }).select('id').single()
    if (inserted.error || !inserted.data) throw new Error('byreum_harness_candidate_create_failed')
    candidateId = inserted.data.id
  }

  const factResult = await input.client.from('knowledge_facts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('source_candidate_id', candidateId)
    .limit(1)
    .maybeSingle()
  if (factResult.error) throw new Error('byreum_harness_fact_unavailable')
  let factId = factResult.data?.id
  if (!factId) {
    const now = new Date().toISOString()
    const inserted = await input.client.from('knowledge_facts').insert({
      workspace_id: workspaceId,
      category: factCategory,
      content: factContent,
      status: 'active',
      source_candidate_id: candidateId,
      approved_by_user_id: userId,
      approved_at: now,
      valid_from: now,
    }).select('id').single()
    if (inserted.error || !inserted.data) throw new Error('byreum_harness_fact_create_failed')
    factId = inserted.data.id
  }

  const now = new Date().toISOString()
  const rule = await input.client.from('harness_rules').insert({
    workspace_id: workspaceId,
    rule_key: BYREUM_IMAGE_HARNESS_RULE_KEY,
    rule_type: 'image_generation',
    title: '바이름 추천 이미지 하네스 V1.0',
    description: '인스타그램·스레드·네이버 블로그용 눈썹 이미지 생성 규칙. 실제 고객 결과가 아닌 원장 승인 전 합성 초안만 생성합니다.',
    structured_rule: BYREUM_IMAGE_HARNESS as unknown as Json,
    applies_to_channels: ['instagram', 'threads', 'naver_blog'],
    status: 'active',
    version: 1,
    source_knowledge_fact_ids: [factId],
    approved_by_user_id: userId,
    approved_at: now,
    review_reason: '사용자가 바이름 전용 이미지 하네스로 지정함',
    created_by_user_id: userId,
  }).select('id, version, structured_rule').single()
  if (rule.error || !rule.data) throw new Error('byreum_harness_rule_create_failed')

  return Object.freeze({
    ruleId: uuidSchema.parse(rule.data.id),
    version: z.number().int().positive().parse(rule.data.version),
    harness: parseByreumImageHarness(rule.data.structured_rule),
  })
}
