'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { normalizeNaverPublicCopy, normalizeNaverPublicText } from '../channel-content-schema'
import { versionSchema } from '../version-schema'

const requestId = 'content-version'
const versionIdSchema = z.string().uuid()
const versionNumberRowSchema = z
  .object({
    version_number: z.number().int().positive(),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/i),
  })
  .strict()

export type CreatedVersion = Readonly<{ versionId: string; versionNumber: number }>
export type CreatedVersionWithFingerprint = Readonly<{
  versionId: string
  versionNumber: number
  fingerprint: string
}>

function failure(message: string): ActionResult<never> {
  return { error: { message, requestId } }
}

export async function createVersionWithClient(
  supabase: Pick<SupabaseClient<Database>, 'auth' | 'from' | 'rpc'>,
  input: unknown,
): Promise<ActionResult<CreatedVersionWithFingerprint>> {
  const parsed = versionSchema.safeParse(input)
  if (!parsed.success) return failure('새 버전 입력 내용을 확인해 주세요.')

  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData?.user?.id

  if (userError || typeof userId !== 'string' || userId.length === 0) {
    return failure('로그인 후 다시 시도해 주세요.')
  }

  const { data: membership, error: membershipError } = await supabase
    .from('workspace_members')
    .select('role, status')
    .eq('workspace_id', parsed.data.workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  if (
    membershipError ||
    membership?.status !== 'active' ||
    (membership.role !== 'owner' &&
      membership.role !== 'manager' &&
      membership.role !== 'reviewer')
  ) {
    return failure('이 작업공간에서는 콘텐츠를 수정할 수 없습니다.')
  }

  const { data: versionId, error: rpcError } = await supabase.rpc(
    'create_content_version',
    {
      p_workspace_id: parsed.data.workspaceId,
      p_content_id: parsed.data.contentId,
      p_caption: parsed.data.caption,
      p_hashtags: parsed.data.hashtags,
      p_disclosure: parsed.data.structuredPayload?.channel === 'naver_blog'
        && parsed.data.structuredPayload.visibility !== 'private'
        && parsed.data.structuredPayload.visibility !== undefined
        ? normalizeNaverPublicText(parsed.data.disclosure)
        : parsed.data.disclosure,
      p_metadata: {
        rightsConfirmed: true,
        generationEvidenceConfirmed: true,
        mediaIds: parsed.data.mediaIds,
        knowledgeIds: parsed.data.knowledgeIds,
        harnessRuleIds: parsed.data.harnessRuleIds,
        structuredPayload: parsed.data.structuredPayload
          ? normalizeNaverPublicCopy(parsed.data.structuredPayload)
          : undefined,
        revisionReason: parsed.data.revisionReason,
      },
    },
  )

  const parsedVersionId = versionIdSchema.safeParse(versionId)
  if (rpcError || !parsedVersionId.success) {
    return failure(
      '새 버전을 저장하지 못했습니다. 미디어와 권리 확인 상태를 다시 확인해 주세요.',
    )
  }

  const { data: versionRow, error: versionError } = await supabase
    .from('content_versions')
    .select('version_number, fingerprint')
    .eq('workspace_id', parsed.data.workspaceId)
    .eq('content_id', parsed.data.contentId)
    .eq('id', parsedVersionId.data)
    .maybeSingle()
  const parsedVersionRow = versionNumberRowSchema.safeParse(versionRow)

  if (versionError || !parsedVersionRow.success) {
    return failure('새 버전은 저장했지만 번호를 확인하지 못했습니다. 대화 결과 목록을 새로 열어 주세요.')
  }

  return {
    data: {
      versionId: parsedVersionId.data,
      versionNumber: parsedVersionRow.data.version_number,
      fingerprint: parsedVersionRow.data.fingerprint,
    },
  }
}

export async function createVersionAction(input: unknown): Promise<ActionResult<CreatedVersion>> {
  try {
    const supabase = await createServerSupabaseClient()
    const result = await createVersionWithClient(supabase, input)
    if (result.data) {
      const parsed = versionSchema.safeParse(input)
      revalidatePath('/app/work')
      if (parsed.success) {
        revalidatePath(`/app/work/${parsed.data.contentId}`)
      }
      return {
        data: {
          versionId: result.data.versionId,
          versionNumber: result.data.versionNumber,
        },
      }
    }
    return result
  } catch {
    return failure('새 버전을 저장하지 못했습니다. 미디어와 권리 확인 상태를 다시 확인해 주세요.')
  }
}
