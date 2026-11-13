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
import { normalizeHashtags } from '@/features/channel-studio/naver/generate-naver-post'

const uuid = z.string().uuid()
const inputSchema = z.object({
  workspaceId: uuid,
  contentId: uuid,
  versionId: uuid,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  title: z.string().trim().min(1).max(200),
  keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
}).strict()

export type NaverMetaRevisionResult = Readonly<{ preview: ApprovalPreviewSnapshot; summary: string }>

function failure(message: string, requestId = 'conversation-naver-meta'): ActionResult<NaverMetaRevisionResult> {
  return { error: { message, requestId } }
}

/** 제목·태그만 새 버전으로 저장한다. 본문 블록, 사진, 근거는 그대로 보존된다. */
export async function naverMetaRevisionAction(input: unknown): Promise<ActionResult<NaverMetaRevisionResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('제목과 태그를 다시 확인해 주세요.')
  const value = parsed.data
  // 태그는 '#'를 떼고 공백·중복을 정리한다. 정규화 뒤 비면 거절한다.
  const hashtags = [...new Set(normalizeHashtags(value.keywords))]
  const keywords = hashtags.map(tag => tag.slice(1))
  if (keywords.length === 0 || keywords.length > 30 || keywords.some(keyword => keyword.length > 100)) {
    return failure('태그를 다시 확인해 주세요.')
  }

  try {
    const detailResult = await getContentDetail(value.workspaceId, value.contentId)
    if (detailResult.error) return failure(detailResult.error.message)
    const detail = detailResult.data
    const base = detail.versions.find(version => version.id === value.versionId)
    if (detail.id !== value.contentId || detail.channel !== 'naver_blog'
      || detail.currentVersionId !== value.versionId || base?.fingerprint !== value.fingerprint) {
      return failure('새 버전이 있어 다시 확인해야 해요.', 'conversation-naver-meta-stale')
    }
    const payload = channelContentSchema.safeParse(base.structuredPayload)
    if (!payload.success || payload.data.channel !== 'naver_blog') return failure('네이버 원고를 다시 확인해 주세요.')
    if (payload.data.title === value.title
      && payload.data.keywords.length === keywords.length
      && payload.data.keywords.every((keyword, index) => keyword === keywords[index])) {
      return failure('변경된 내용이 없어요.')
    }
    const revised = channelContentSchema.safeParse({ ...payload.data, title: value.title, keywords })
    if (!revised.success || revised.data.channel !== 'naver_blog') return failure('제목과 태그 길이를 확인해 주세요.')

    const supabase = await createServerSupabaseClient()
    if (await loadNaverRevisionReadiness(supabase) !== 'ready') return failure(NAVER_REVISION_UNAVAILABLE, 'naver-revision-unavailable')
    const facts = await loadApprovedFactSnapshot(supabase as unknown as Parameters<typeof loadApprovedFactSnapshot>[0], value.workspaceId)
    if (payload.data.factBasis && (payload.data.factBasis.workspaceId !== value.workspaceId
      || payload.data.factBasis.snapshotHash !== facts.hash)) {
      return failure('작성 뒤 가게 정보가 바뀌었어요. 최신 근거를 확인한 뒤 원고를 다시 준비해 주세요.', 'conversation-naver-meta-claims')
    }
    const qa = checkApprovedNaverDraft(value.workspaceId, {
      title: revised.data.title, editorBlocks: revised.data.editorBlocks, keywords: revised.data.keywords,
    }, facts)
    if (qa.status !== 'OK') return failure(qa.issues[0].reason, 'conversation-naver-meta-claims')

    const mutation = await supabase.rpc('create_naver_meta_revision', {
      p_workspace_id: value.workspaceId, p_content_id: value.contentId,
      p_expected_base_version_id: value.versionId, p_expected_base_fingerprint: value.fingerprint,
      p_title: value.title, p_keywords: keywords, p_hashtags: hashtags,
    })
    if (naverRevisionUnavailable(mutation.error)) return failure(NAVER_REVISION_UNAVAILABLE, 'naver-revision-unavailable')
    const newVersionId = uuid.safeParse(mutation.data)
    if (mutation.error || !newVersionId.success) {
      return failure('새 버전 저장을 확인하지 못했어요. 최신 원고를 다시 열어 주세요.', 'conversation-naver-meta-stale')
    }
    const nextResult = await getApprovalPreview(value.workspaceId, value.contentId)
    if (nextResult.error || nextResult.data.versionId !== newVersionId.data
      || nextResult.data.fingerprint === value.fingerprint || nextResult.data.approval.status !== 'unreviewed') {
      return failure('새 버전은 만들었지만 미리보기를 확인하지 못했어요. 다시 열어 주세요.')
    }
    revalidatePath('/app')
    revalidatePath('/app/work')
    revalidatePath(`/app/work/${value.contentId}`)
    return { data: Object.freeze({ preview: nextResult.data, summary: '제목과 태그를 새 버전으로 저장했어요.' }) }
  } catch {
    return failure('제목·태그를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
