'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  normalizeOverlayTexts,
  OVERLAY_PRESETS,
  type OverlayPresetId,
} from '../overlay/overlay-template'
import { authorizeManager } from '../server/manager-auth'

const requestId = 'overlay-defaults'

const PRESET_IDS = OVERLAY_PRESETS.map((preset) => preset.id) as [OverlayPresetId, ...OverlayPresetId[]]

const inputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    preset: z.enum(PRESET_IDS),
    texts: z
      .object({
        brandLine: z.string().max(200),
        designLine: z.string().max(200),
        quote: z.string().max(2_000),
        insetLabel: z.string().max(100),
      })
      .strict(),
  })
  .strict()

function failure(message: string): ActionResult<{ saved: true }> {
  return { error: { message, requestId } }
}

export async function saveOverlayDefaultsAction(
  input: unknown,
): Promise<ActionResult<{ saved: true }>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return failure('입력 내용을 확인해 주세요.')
  }

  const { workspaceId, preset, texts } = parsed.data

  try {
    const auth = await authorizeManager(workspaceId)
    if ('message' in auth) {
      return failure(auth.message)
    }

    const normalizedTexts = normalizeOverlayTexts(texts)
    const admin = createAdminSupabaseClient()

    const { error } = await admin
      .rpc('activate_harness_rule_version', {
        p_workspace_id: workspaceId,
        p_rule_key: 'custom-overlay-v1',
        p_rule_type: 'image_generation',
        p_title: '문구·삽입컷 기본값',
        p_description: '문구 합성 기본값',
        p_structured_rule: {
          overlay: {
            preset,
            texts: normalizedTexts,
          },
        } as never,
        p_applies_to_channels: ['instagram', 'threads', 'naver_blog'],
        p_created_by_user_id: auth.userId,
        p_approved_by_user_id: auth.userId,
        p_source_knowledge_fact_ids: [],
      })
      .single()

    if (error) {
      return failure('기본 문구를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
    }

    return { data: { saved: true } }
  } catch {
    return failure('기본 문구를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
