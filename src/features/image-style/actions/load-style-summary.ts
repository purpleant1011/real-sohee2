'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  CUSTOM_IMAGE_STYLE_RULE_KEY,
  pickWorkspaceImageStyle,
} from '../workspace-image-style'
import {
  EMPTY_STYLE_SUMMARY,
  summarizeStyle,
  type WorkspaceStyleSummary,
} from '../style-summary'

const requestId = 'workspace-style-summary'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
}).strict()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function loadWorkspaceStyleSummaryAction(
  input: unknown,
): Promise<ActionResult<WorkspaceStyleSummary>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: { message: '입력 내용을 확인해 주세요.', requestId } }
  }
  const { workspaceId } = parsed.data

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') {
      return { error: { message: '이 작업공간을 볼 수 없어요.', requestId } }
    }

    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (memberError || membership?.status !== 'active') {
      return { error: { message: '이 작업공간을 볼 수 없어요.', requestId } }
    }

    try {
      const [imageResult, textResult] = await Promise.all([
        supabase
          .from('harness_rules')
          .select('rule_key, structured_rule')
          .eq('workspace_id', workspaceId)
          .eq('rule_type', 'image_generation')
          .eq('status', 'active'),
        supabase
          .from('harness_rules')
          .select('structured_rule')
          .eq('workspace_id', workspaceId)
          .eq('rule_type', 'text_generation')
          .eq('status', 'active')
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (imageResult.error || textResult.error) {
        return { data: EMPTY_STYLE_SUMMARY }
      }

      const imageRows = Array.isArray(imageResult.data) ? imageResult.data : []
      const customStyle = imageRows.some((row) => row.rule_key === CUSTOM_IMAGE_STYLE_RULE_KEY)
      const style = pickWorkspaceImageStyle(imageRows)

      const overlayRow = imageRows.find((row) => row.rule_key === 'custom-overlay-v1')
      const overlayRule = isRecord(overlayRow?.structured_rule)
        ? (overlayRow.structured_rule as { overlay?: unknown })
        : null

      const textRuleStructured = isRecord(textResult.data?.structured_rule)
        ? textResult.data.structured_rule
        : null
      const textRule = textRuleStructured ? { brandVoice: textRuleStructured.brandVoice } : null

      const data = summarizeStyle({
        workspaceId,
        style,
        customStyle,
        textRule,
        overlayRule,
      })

      return { data }
    } catch {
      return { data: EMPTY_STYLE_SUMMARY }
    }
  } catch {
    return { error: { message: '이 작업공간을 볼 수 없어요.', requestId } }
  }
}
