import 'server-only'

import { randomUUID } from 'node:crypto'
import { loadApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver'
import { createProductionTextClient } from '@/lib/ai/gemini-responses-adapter'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadNaverGenerationContext } from './naver-generation-context.server'
import {
  createSupabaseConversationArtifactGateway,
  persistConversationArtifact,
  persistConversationArtifactRetry,
} from './conversation-artifact-repository'
import {
  createConversationArtifactWorkflow,
  type ConversationArtifactWorkflowInput,
} from './conversation-artifact-generation'
import {
  regenerateSelectedSlide,
  type GeneratedImageBatch,
} from './conversation-image-batch'
import { generateConversationImageBatchViaSubrequests } from './conversation-image-subrequests'
import {
  createProductionConversationImageArtifact,
  createProductionConversationImageBatchArtifacts,
} from './conversation-image-generation.server'
import { createOpenAIInstagramDraftProvider } from './instagram-draft-provider'
import { createByreumNaverReferenceDraft } from './byreum-naver-reference-draft'
import { createProductionNaverBlogDraftProvider } from './naver-blog-draft-provider'
import {
  createExistingNaverMediaBatch,
  requestsExistingNaverMedia,
  type ReusableNaverMediaCandidate,
} from './naver-existing-media-reuse'
import type { ConversationArtifact } from './types'

function isByreumContext(context: {
  businessName?: string | null
  activeTextHarnesses?: readonly { title: string; description: string }[]
}): boolean {
  return Boolean(
    context.businessName?.includes('바이름') ||
      context.activeTextHarnesses?.some(
        (h) => h.title.includes('바이름') || h.description.includes('바이름'),
      ),
  )
}

function batchFromArtifact(artifact: ConversationArtifact): GeneratedImageBatch {
  const requestedCount = artifact.slides.length
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 20) {
    throw new Error('conversation_artifact_slide_count_invalid')
  }
  const succeededCount = artifact.slides.filter((slide) => slide.status === 'succeeded').length
  const failedCount = artifact.slides.filter((slide) => slide.status === 'failed').length
  const startedCount = succeededCount + failedCount
  const status = succeededCount === requestedCount
    ? 'ready_for_review'
    : succeededCount > 0
      ? 'partial'
      : startedCount === 0
        ? 'cancelled'
        : 'failed'
  return Object.freeze({
    idempotencyKey: artifact.idempotencyKey,
    status,
    requestedCount: requestedCount as GeneratedImageBatch['requestedCount'],
    startedCount,
    succeededCount,
    failedCount,
    slides: artifact.slides,
  })
}

async function loadReusableNaverMedia(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  workspaceId: string,
): Promise<readonly ReusableNaverMediaCandidate[]> {
  const items = await admin.from('content_items')
    .select('id, title')
    .eq('workspace_id', workspaceId)
    .limit(500)
  if (items.error || !Array.isArray(items.data)) throw new Error('NAVER_REUSABLE_MEDIA_QUERY_FAILED')
  const itemIds = items.data.map((item) => item.id)
  if (itemIds.length === 0) return []

  const versions = await admin.from('content_versions')
    .select('id, content_id, caption')
    .eq('workspace_id', workspaceId)
    .in('content_id', itemIds)
    .limit(1_000)
  if (versions.error || !Array.isArray(versions.data)) throw new Error('NAVER_REUSABLE_MEDIA_QUERY_FAILED')
  const versionIds = versions.data.map((version) => version.id)
  if (versionIds.length === 0) return []

  const placements = await admin.from('content_version_media')
    .select('version_id, media_asset_id')
    .eq('workspace_id', workspaceId)
    .in('version_id', versionIds)
    .limit(2_000)
  if (placements.error || !Array.isArray(placements.data)) throw new Error('NAVER_REUSABLE_MEDIA_QUERY_FAILED')
  const mediaIds = [...new Set(placements.data.map((placement) => placement.media_asset_id))]
  if (mediaIds.length === 0) return []

  const assets = await admin.from('media_assets')
    .select('id, created_at, rights_status')
    .eq('workspace_id', workspaceId)
    .eq('rights_status', 'confirmed')
    .in('id', mediaIds)
    .limit(2_000)
  if (assets.error || !Array.isArray(assets.data)) throw new Error('NAVER_REUSABLE_MEDIA_QUERY_FAILED')

  const itemById = new Map(items.data.map((item) => [item.id, item]))
  const versionById = new Map(versions.data.map((version) => [version.id, version]))
  const assetById = new Map(assets.data.map((asset) => [asset.id, asset]))

  return Object.freeze(placements.data.flatMap((placement) => {
    const version = versionById.get(placement.version_id)
    const item = version ? itemById.get(version.content_id) : null
    const asset = assetById.get(placement.media_asset_id)
    if (!version || !item || !asset) return []
    return [Object.freeze({
      mediaAssetId: asset.id,
      title: item.title,
      caption: version.caption,
      createdAt: asset.created_at,
    })]
  }))
}

async function loadAttachedContentMedia(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  workspaceId: string,
  attachmentIds: readonly string[],
): Promise<readonly ReusableNaverMediaCandidate[]> {
  if (attachmentIds.length === 0 || new Set(attachmentIds).size !== attachmentIds.length) {
    throw new Error('NAVER_ATTACHED_MEDIA_INVALID')
  }
  const assets = await admin.from('media_assets')
    .select('id, workspace_id, rights_status, created_at')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'content')
    .eq('bucket_id', 'content-media')
    .eq('rights_status', 'confirmed')
    .in('id', [...attachmentIds])
    .limit(20)
  if (assets.error || !Array.isArray(assets.data)) throw new Error('NAVER_ATTACHED_MEDIA_QUERY_FAILED')
  if (assets.data.some(asset => asset.workspace_id !== workspaceId || asset.rights_status !== 'confirmed')) throw new Error('NAVER_ATTACHED_MEDIA_FORBIDDEN')
  const assetById = new Map(assets.data.map((asset) => [asset.id, asset]))
  const ordered = attachmentIds.flatMap((mediaAssetId, index) => {
    const asset = assetById.get(mediaAssetId)
    if (!asset) return []
    return [Object.freeze({
      mediaAssetId,
      title: `사용자 첨부 이미지 ${index + 1}`,
      caption: '사용자가 사용 권리를 확인한 원본 첨부 이미지',
      createdAt: asset.created_at,
    })]
  })
  if (ordered.length !== attachmentIds.length) throw new Error('NAVER_ATTACHED_MEDIA_FORBIDDEN')
  return Object.freeze(ordered)
}

export async function createProductionConversationArtifact(
  input: ConversationArtifactWorkflowInput,
): Promise<ConversationArtifact> {
  const admin = createAdminSupabaseClient()
  const gateway = createSupabaseConversationArtifactGateway(admin)

  try {
    return await createConversationArtifactWorkflow(input, {
    loadApprovedFacts(workspaceId) {
      return loadApprovedFactSnapshot(admin as unknown as Parameters<typeof loadApprovedFactSnapshot>[0], workspaceId)
    },
    findExisting(request) {
      return gateway.findByRequest(request)
    },
    loadContext({ workspaceId, channel }) {
      return loadNaverGenerationContext(workspaceId, admin, channel)
    },
    async generateDraft(request) {
      const channel = request.channel
      if (channel === 'naver_blog') {
        if (
          !request.blogStrategyBrief &&
          requestsExistingNaverMedia(request.prompt) &&
          request.attachmentIds.length === 0 &&
          isByreumContext(request.context)
        ) {
          return createByreumNaverReferenceDraft(request.context, request.imageCount)
        }
        const provider = createProductionNaverBlogDraftProvider()
        return provider.generate({
          ...request,
          ...(request.contentBrief ? { contentBrief: request.contentBrief } : {}),
          ...(request.referenceMediaIds ? { referenceMediaIds: request.referenceMediaIds } : {}),
        })
      }
      const provider = createOpenAIInstagramDraftProvider(
        createProductionTextClient() as never,
        'gemini',
      )
      return provider.generate({
        ...request,
        channel,
        ...(request.contentBrief ? { contentBrief: request.contentBrief } : {}),
        ...(request.referenceMediaIds ? { referenceMediaIds: request.referenceMediaIds } : {}),
      })
    },
    async generateBatch(request) {
      if (request.attachmentIds.length > 0 && (request.channel === 'naver_blog' || request.generationMode === 'existing_media')) {
        const candidates = await loadAttachedContentMedia(admin, request.workspaceId, request.attachmentIds)
        return createExistingNaverMediaBatch({
          candidates,
          count: request.count,
          idempotencyKey: request.idempotencyKey,
          orderedMediaAssetIds: request.attachmentIds,
          createSlideId: () => randomUUID(),
        })
      }
      if (request.channel === 'naver_blog' && requestsExistingNaverMedia(request.prompt)) {
        const candidates = await loadReusableNaverMedia(admin, request.workspaceId)
        return createExistingNaverMediaBatch({
          candidates,
          count: request.count,
          idempotencyKey: request.idempotencyKey,
          createSlideId: () => randomUUID(),
        })
      }
      if (request.imageSubrequest) {
        return generateConversationImageBatchViaSubrequests({
          workspaceId: request.workspaceId,
          prompt: request.prompt,
          channel: request.channel,
          count: request.count,
          idempotencyKey: request.idempotencyKey,
          origin: request.imageSubrequest.origin,
          cookie: request.imageSubrequest.cookie,
          createSlideId: () => randomUUID(),
          ...(request.slidePrompts ? { slidePrompts: request.slidePrompts } : {}),
          ...(request.contentBrief ? { contentBrief: request.contentBrief } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
          ...(request.onSlideProgress ? { onSlideProgress: request.onSlideProgress } : {}),
        })
      }
      return createProductionConversationImageBatchArtifacts({
        ...request,
        ...(request.contentBrief ? { contentBrief: request.contentBrief } : {}),
        ...(request.referenceMediaIds ? { referenceMediaIds: request.referenceMediaIds } : {}),
      })
    },
    async regenerateSlide(request) {
      return regenerateSelectedSlide({
        batch: batchFromArtifact(request.artifact),
        selectedSlideId: request.selectedSlideId,
        idempotencyKey: request.idempotencyKey,
        ...(request.signal ? { signal: request.signal } : {}),
        generate: async ({ position, role }) => {
          const generated = await createProductionConversationImageArtifact({
            workspaceId: request.workspaceId,
            userId: request.userId,
            channel: request.channel,
            prompt: [
              request.prompt,
              `기존 결과물의 ${position}번 ${role} 이미지만 다시 생성하세요.`,
            ].join('\n'),
            ...(request.onUsage ? { onUsage: request.onUsage } : {}),
          })
          return Object.freeze({
            mediaAssetId: generated.id,
            altText: generated.title,
          })
        },
      })
    },
    persistFresh(request) {
      return persistConversationArtifact(request, gateway)
    },
    persistRetry(request) {
      return persistConversationArtifactRetry(request, gateway)
    },
    createId: randomUUID,
    })
  } catch (error) {
    console.error('[sohee:conversation-artifact-failed]', {
      channel: input.channel,
      count: input.count,
      reuseExistingNaverMedia: input.channel === 'naver_blog' && requestsExistingNaverMedia(input.prompt),
      safeCode: error instanceof Error ? error.message : 'UNKNOWN_CONVERSATION_ARTIFACT_ERROR',
    })
    throw error
  }
}
