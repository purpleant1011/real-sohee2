'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getApprovalPreview } from '@/features/approvals/approval-preview-repository'
import { generateContentImageAction } from '@/features/content/actions/generate-content-image'
import { reviseContentAction } from '@/features/content/actions/revise-content'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { DEFAULT_AI_DISCLOSURE } from '@/features/publishing/meta-content-text'
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
  scope: z.enum(['caption', 'hashtags', 'image_add', 'image_replace', 'media_reorder', 'media_limit', 'disclosure_repair', 'naver_block']),
  targetBlockIndex: z.number().int().min(0).max(79).optional(),
  instruction: z.string().trim().min(1).max(2_000),
  targetPosition: z.number().int().min(1).max(10).nullable(),
  /** 문구·삽입컷을 얹어 이미 만들어 둔 이미지를 그대로 쓸 때. 새로 생성하지 않는다. */
  existingAssetId: uuid.optional(),
  orderedMediaIds: z.array(uuid).max(10).nullable(),
}).strict()

export type PartialContentRevisionResult = Readonly<{
  preview: ApprovalPreviewSnapshot
  revisionSummary: string
  diff?: Readonly<{ blockId: string; before: string; after: string }>
}>

function failure(message: string, requestId = 'conversation-partial-revision'): ActionResult<PartialContentRevisionResult> {
  return { error: { message, requestId } }
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((id) => right.includes(id))
    && new Set(left).size === left.length
}

export async function partialContentRevisionAction(input: unknown): Promise<ActionResult<PartialContentRevisionResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('부분 수정 지시를 다시 확인해 주세요.')
  const value = parsed.data

  try {
    const currentResult = await getApprovalPreview(value.workspaceId, value.contentId)
    if (currentResult.error) return failure(currentResult.error.message)
    const current = currentResult.data
    if (current.versionId !== value.versionId || current.fingerprint !== value.fingerprint) {
      return failure('새 버전이 있어 다시 확인해야 해요.', 'conversation-partial-revision-stale')
    }

    if (value.scope === 'naver_block') {
      if (current.channel !== 'naver_blog' || value.targetBlockIndex === undefined) {
        return failure('수정할 네이버 문단을 선택해 주세요.')
      }
      const detailResult = await getContentDetail(value.workspaceId, value.contentId)
      if (detailResult.error) return failure(detailResult.error.message)
      const detail = detailResult.data
      const base = detail.versions.find(version => version.id === value.versionId)
      if (detail.id !== value.contentId || detail.channel !== 'naver_blog'
        || detail.currentVersionId !== value.versionId || base?.fingerprint !== value.fingerprint) {
        return failure('새 버전이 있어 다시 확인해야 해요.', 'conversation-partial-revision-stale')
      }
      const payload = channelContentSchema.safeParse(base.structuredPayload)
      if (!payload.success || payload.data.channel !== 'naver_blog') return failure('네이버 원고를 다시 확인해 주세요.')
      const block = payload.data.editorBlocks?.[value.targetBlockIndex]
      if (!block || !('text' in block)) return failure('텍스트 문단만 직접 수정할 수 있어요.')
      if (block.text === value.instruction) return failure('변경된 내용이 없어요.')
      const revisedPayload = channelContentSchema.safeParse({
        ...payload.data,
        editorBlocks: payload.data.editorBlocks!.map((part, index) => index === value.targetBlockIndex
          ? { ...part, text: value.instruction } : part),
      })
      if (!revisedPayload.success || revisedPayload.data.channel !== 'naver_blog') return failure('문단 길이와 내용을 확인해 주세요.')
      const supabase = await createServerSupabaseClient()
      if (await loadNaverRevisionReadiness(supabase) !== 'ready') return failure(NAVER_REVISION_UNAVAILABLE, 'naver-revision-unavailable')
      const facts = await loadApprovedFactSnapshot(supabase as unknown as Parameters<typeof loadApprovedFactSnapshot>[0], value.workspaceId)
      if (payload.data.factBasis && (payload.data.factBasis.workspaceId !== value.workspaceId
        || payload.data.factBasis.snapshotHash !== facts.hash)) {
        return failure('작성 뒤 가게 정보가 바뀌었어요. 최신 근거를 확인한 뒤 원고를 다시 준비해 주세요.', 'conversation-partial-revision-claims')
      }
      const qa = checkApprovedNaverDraft(value.workspaceId, {
        title: revisedPayload.data.title, editorBlocks: revisedPayload.data.editorBlocks, keywords: revisedPayload.data.keywords,
      }, facts)
      if (qa.status !== 'OK') return failure(qa.issues[0].reason, 'conversation-partial-revision-claims')
      // 원본은 DB에서 다시 읽고 행 잠금 하에 비교한다. 클라이언트가 전체 원고/근거를 덮어쓰지 않는다.
      const mutation = await supabase.rpc('create_naver_block_revision', {
        p_workspace_id: value.workspaceId, p_content_id: value.contentId,
        p_expected_base_version_id: value.versionId, p_expected_base_fingerprint: value.fingerprint,
        p_block_index: value.targetBlockIndex, p_replacement_text: value.instruction,
      })
      if (naverRevisionUnavailable(mutation.error)) return failure(NAVER_REVISION_UNAVAILABLE, 'naver-revision-unavailable')
      const newVersionId = uuid.safeParse(mutation.data)
      if (mutation.error || !newVersionId.success) {
        return failure('새 버전 저장을 확인하지 못했어요. 최신 원고를 다시 열어 주세요.', 'conversation-partial-revision-stale')
      }
      const nextResult = await getApprovalPreview(value.workspaceId, value.contentId)
      if (nextResult.error || nextResult.data.versionId !== newVersionId.data
        || nextResult.data.fingerprint === value.fingerprint || nextResult.data.approval.status !== 'unreviewed') {
        return failure('새 버전은 만들었지만 미리보기를 확인하지 못했어요. 다시 열어 주세요.')
      }
      revalidatePath('/app')
      revalidatePath('/app/work')
      revalidatePath(`/app/work/${value.contentId}`)
      return { data: Object.freeze({
        preview: nextResult.data, revisionSummary: `${value.targetBlockIndex + 1}번 문단을 수정했어요.`,
        diff: Object.freeze({ blockId: `${value.versionId}:${value.targetBlockIndex}`, before: block.text, after: value.instruction }),
      }) }
    }

    // SNS용 RPC는 네이버 전체 원고/편집 블록을 보존하지 못한다.
    if (current.channel === 'naver_blog') {
      return failure(
        '네이버 원고를 보존하는 부분 수정을 준비 중이에요. 현재 원고는 변경하지 않았어요. 수정하려면 원고를 새로 만들어 주세요.',
        'conversation-partial-revision-naver',
      )
    }

    let caption = current.caption
    let hashtags = [...current.hashtags]
    let disclosure = current.disclosure
    let mediaIds = current.media.map((media) => media.id)
    let revisionReason = value.instruction.slice(0, 500)
    let revisionSummary = ''

    if (value.scope === 'caption' || value.scope === 'hashtags') {
      const revised = await reviseContentAction({
        workspaceId: value.workspaceId,
        contentId: value.contentId,
        versionId: value.versionId,
        channel: current.channel,
        instruction: value.instruction,
        inputType: value.scope,
        currentVersionFingerprint: value.fingerprint,
        currentCaption: current.caption,
        currentHashtags: current.hashtags,
        currentDisclosure: current.disclosure,
      })
      if (revised.error) return failure(revised.error.message, revised.error.requestId)
      caption = revised.data.caption
      hashtags = [...revised.data.hashtags]
      disclosure = revised.data.disclosure.trim() || current.disclosure.trim() || DEFAULT_AI_DISCLOSURE
      revisionReason = revised.data.revisionReason.slice(0, 500)
      revisionSummary = value.scope === 'caption' ? '본문만 수정했어요.' : '해시태그만 수정했어요.'
    } else if (value.scope === 'image_add' || value.scope === 'image_replace') {
      const targetIndex = value.targetPosition === null ? -1 : value.targetPosition - 1
      if (value.scope === 'image_replace' && (targetIndex < 0 || targetIndex >= mediaIds.length)) {
        return failure('교체할 이미지 순서를 확인해 주세요.')
      }
      if (value.scope === 'image_add' && mediaIds.length >= 10) {
        return failure('한 게시물에는 이미지를 10개까지 사용할 수 있어요.')
      }
      let assetId: string
      if (value.existingAssetId) {
        const lookup = await (await createServerSupabaseClient())
          .from('media_assets')
          .select('id')
          .eq('workspace_id', value.workspaceId)
          .eq('id', value.existingAssetId)
          .eq('bucket_id', 'content-media')
          .eq('kind', 'content')
          .eq('rights_status', 'confirmed')
          .maybeSingle()
        if (lookup.error || !lookup.data) return failure('사용할 이미지를 확인하지 못했어요. 다시 만들어 주세요.')
        assetId = lookup.data.id
      } else {
        const generated = await generateContentImageAction({
          workspaceId: value.workspaceId,
          contentId: value.contentId,
          versionId: value.versionId,
          currentVersionFingerprint: value.fingerprint,
          prompt: value.instruction,
          channel: current.channel,
        })
        if (generated.error) return failure(generated.error.message, generated.error.requestId)
        assetId = generated.data.assetId
      }
      if (value.scope === 'image_add') {
        mediaIds = [...mediaIds, assetId]
        revisionSummary = value.existingAssetId
          ? `${mediaIds.length}번 이미지로 문구를 얹은 이미지를 추가했어요.`
          : `${mediaIds.length}번 이미지를 새로 추가했어요.`
      } else {
        mediaIds = mediaIds.map((id, index) => index === targetIndex ? assetId : id)
        revisionSummary = value.existingAssetId
          ? `${value.targetPosition}번 이미지를 문구를 얹은 이미지로 바꿨어요.`
          : `${value.targetPosition}번 이미지만 새 결과로 교체했어요.`
      }
    } else if (value.scope === 'media_reorder') {
      if (!value.orderedMediaIds || !sameIds(value.orderedMediaIds, mediaIds)) {
        return failure('이미지 순서에 빠지거나 중복된 항목이 있어요.')
      }
      mediaIds = [...value.orderedMediaIds]
      revisionSummary = '이미지 순서만 변경했어요.'
    } else if (value.scope === 'media_limit') {
      const targetIndex = value.targetPosition === null ? -1 : value.targetPosition - 1
      if (current.channel !== 'threads' || mediaIds.length <= 1 || targetIndex < 0 || targetIndex >= mediaIds.length) {
        return failure('Threads에 사용할 대표 이미지를 다시 선택해 주세요.')
      }
      mediaIds = [mediaIds[targetIndex]!]
      disclosure = disclosure.trim() || DEFAULT_AI_DISCLOSURE
      revisionReason = `Threads 이미지 1장 제한에 맞춰 ${value.targetPosition}번 대표 이미지를 선택했습니다.`
      revisionSummary = `${value.targetPosition}번 이미지를 Threads 대표 이미지로 선택했어요.`
    } else {
      disclosure = DEFAULT_AI_DISCLOSURE
      revisionReason = '비어 있던 게시 고지에 안전한 기본 문구를 적용했습니다.'
      revisionSummary = '안전한 게시 고지를 적용했어요.'
    }

    const supabase = await createServerSupabaseClient()
    const mutation = await supabase.rpc('create_scoped_content_revision' as never, {
      p_workspace_id: value.workspaceId,
      p_content_id: value.contentId,
      p_expected_base_version_id: value.versionId,
      p_expected_base_fingerprint: value.fingerprint,
      p_caption: caption,
      p_hashtags: hashtags,
      p_disclosure: disclosure,
      p_media_ids: mediaIds,
      p_revision_reason: revisionReason,
    } as never)
    const newVersionId = uuid.safeParse(mutation.data)
    if (mutation.error || !newVersionId.success) {
      return failure('새 버전이 있어 다시 확인해야 해요.', 'conversation-partial-revision-stale')
    }

    const nextResult = await getApprovalPreview(value.workspaceId, value.contentId)
    if (nextResult.error || nextResult.data.versionId !== newVersionId.data) {
      return failure('새 버전은 만들었지만 미리보기를 확인하지 못했어요. 다시 열어 주세요.')
    }
    revalidatePath('/app')
    revalidatePath('/app/work')
    revalidatePath(`/app/work/${value.contentId}`)
    return { data: Object.freeze({ preview: nextResult.data, revisionSummary }) }
  } catch {
    return failure('부분 수정을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
