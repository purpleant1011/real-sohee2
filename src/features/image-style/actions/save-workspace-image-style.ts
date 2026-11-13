'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  CUSTOM_IMAGE_STYLE_RULE_KEY,
  normalizeWorkspaceImageStyleInput,
} from '../workspace-image-style'

const requestId = 'workspace-image-style'
const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  subject: z.string().max(2_000),
  mood: z.string().max(2_000),
  setting: z.string().max(2_000),
  lookAndColor: z.string().max(2_000),
  people: z.string().max(20),
  avoid: z.string().max(4_000),
  extra: z.string().max(4_000),
  composition: z.string().max(2_000).optional(),
  guide: z.string().max(4_000).optional(),
  references: z.array(z.string().uuid()).max(8).optional(),
  referenceNotes: z.record(z.string().uuid(), z.string().max(200)).optional(),
}).strict()

function failure(message: string): ActionResult<{ version: number }> {
  return { error: { message, requestId } }
}

export async function saveWorkspaceImageStyleAction(input: unknown): Promise<ActionResult<{ version: number }>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('입력 내용을 확인해 주세요.')
  const { workspaceId, ...form } = parsed.data

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') return failure('로그인 후 다시 시도해 주세요.')

    const { data: membership, error } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error || membership?.status !== 'active' || (membership.role !== 'owner' && membership.role !== 'manager')) {
      return failure('소유자 또는 관리자만 이미지 스타일을 바꿀 수 있어요.')
    }

    const normalized = normalizeWorkspaceImageStyleInput(form)
    if (!normalized.ok) return failure(normalized.message)

    const admin = createAdminSupabaseClient()
    const referenceIds = normalized.style.referenceAssetIds
    if (referenceIds.length > 0) {
      const owned = await admin
        .from('media_assets')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('rights_status', 'confirmed')
        .in('id', referenceIds)
      if (owned.error || !Array.isArray(owned.data) || owned.data.length !== referenceIds.length) return failure('기준 사진을 다시 확인해 주세요. 이 작업공간의 사진만 쓸 수 있어요.')
    }

    const { data, error: saveError } = await admin
      .rpc('activate_harness_rule_version', {
        p_workspace_id: workspaceId,
        p_rule_key: CUSTOM_IMAGE_STYLE_RULE_KEY,
        p_rule_type: 'image_generation',
        p_title: '우리 매장 이미지 스타일',
        p_description: normalized.style.subject || normalized.style.mood || '사장님이 등록한 이미지 스타일',
        p_structured_rule: { custom: normalized.style } as never,
        p_applies_to_channels: ['instagram', 'threads', 'naver_blog'],
        p_created_by_user_id: userId,
        p_approved_by_user_id: userId,
        p_source_knowledge_fact_ids: [],
      })
      .single()
    const version = (data as { version?: unknown } | null)?.version
    if (saveError || typeof version !== 'number') return failure('이미지 스타일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')

    revalidatePath('/app/account/knowledge')
    return { data: { version } }
  } catch {
    return failure('이미지 스타일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
