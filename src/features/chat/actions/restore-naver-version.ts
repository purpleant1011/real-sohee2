'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getApprovalPreview } from '@/features/approvals/approval-preview-repository'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getContentDetail } from '@/features/content/repository'
import { channelContentSchema } from '@/features/content/channel-content-schema'
import { loadApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver'
import { checkApprovedNaverDraft } from '@/features/channel-studio/naver/approved-draft-qa'
import { loadNaverRevisionReadiness, NAVER_REVISION_UNAVAILABLE, naverRevisionUnavailable } from '@/features/content/naver-revision-readiness'

const uuid = z.string().uuid()
const inputSchema = z.object({
  workspaceId: uuid,
  contentId: uuid,
  versionId: uuid,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceVersionId: uuid,
}).strict()

export type RestoreNaverVersionResult = Readonly<{ preview: ApprovalPreviewSnapshot; summary: string }>

function failure(message: string, requestId = 'conversation-restore-naver'): ActionResult<RestoreNaverVersionResult> {
  return { error: { message, requestId } }
}

/** 지난 버전을 되돌리는 것이 아니라 그 내용을 새 최신 버전으로 복사한다. 승인은 이어받지 않는다. */
export async function restoreNaverVersionAction(input: unknown): Promise<ActionResult<RestoreNaverVersionResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('복원할 버전을 다시 확인해 주세요.')
  const value = parsed.data
  if (value.sourceVersionId === value.versionId) return failure('이미 최신 버전이에요.')

  try {
    const detailResult = await getContentDetail(value.workspaceId, value.contentId)
    if (detailResult.error) return failure(detailResult.error.message)
    const detail = detailResult.data
    const base = detail.versions.find(version => version.id === value.versionId)
    const source = detail.versions.find(version => version.id === value.sourceVersionId)
    if (detail.id !== value.contentId || detail.channel !== 'naver_blog'
      || detail.currentVersionId !== value.versionId || base?.fingerprint !== value.fingerprint) {
      return failure('새 버전이 있어 다시 확인해야 해요.', 'conversation-restore-naver-stale')
    }
    if (!source) return failure('복원할 버전을 찾지 못했어요.')
    const payload = channelContentSchema.safeParse(source.structuredPayload)
    if (!payload.success || payload.data.channel !== 'naver_blog') return failure('복원할 수 있는 네이버 원고가 아니에요.')

    const supabase = await createServerSupabaseClient()
    if (await loadNaverRevisionReadiness(supabase) !== 'ready') return failure(NAVER_REVISION_UNAVAILABLE, 'naver-revision-unavailable')
    const facts = await loadApprovedFactSnapshot(supabase as unknown as Parameters<typeof loadApprovedFactSnapshot>[0], value.workspaceId)
    if (payload.data.factBasis && (payload.data.factBasis.workspaceId !== value.workspaceId
      || payload.data.factBasis.snapshotHash !== facts.hash)) {
      return failure('그 버전을 쓴 뒤 가게 정보가 바뀌었어요. 최신 근거로 원고를 다시 준비해 주세요.', 'conversation-restore-naver-claims')
    }
    const qa = checkApprovedNaverDraft(value.workspaceId, {
      title: payload.data.title, editorBlocks: payload.data.editorBlocks, keywords: payload.data.keywords,
    }, facts)
    if (qa.status !== 'OK') return failure(qa.issues[0].reason, 'conversation-restore-naver-claims')

    const mutation = await supabase.rpc('restore_naver_version', {
      p_workspace_id: value.workspaceId, p_content_id: value.contentId,
      p_expected_base_version_id: value.versionId, p_expected_base_fingerprint: value.fingerprint,
      p_source_version_id: value.sourceVersionId,
    })
    if (naverRevisionUnavailable(mutation.error)) return failure(NAVER_REVISION_UNAVAILABLE, 'naver-revision-unavailable')
    const newVersionId = uuid.safeParse(mutation.data)
    if (mutation.error || !newVersionId.success) {
      return failure('새 버전 저장을 확인하지 못했어요. 최신 원고를 다시 열어 주세요.', 'conversation-restore-naver-stale')
    }
    const nextResult = await getApprovalPreview(value.workspaceId, value.contentId)
    if (nextResult.error || nextResult.data.versionId !== newVersionId.data
      || nextResult.data.fingerprint === value.fingerprint || nextResult.data.approval.status !== 'unreviewed') {
      return failure('새 버전은 만들었지만 미리보기를 확인하지 못했어요. 다시 열어 주세요.')
    }
    revalidatePath('/app')
    revalidatePath('/app/work')
    revalidatePath(`/app/work/${value.contentId}`)
    return { data: Object.freeze({ preview: nextResult.data, summary: `v${source.versionNumber} 내용을 새 버전으로 복원했어요.` }) }
  } catch {
    return failure('버전을 복원하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
