import type { OpenAIImageClient } from '@/features/creative/openai-image-client'
import type { MediaItem } from '@/features/vault/channel-spec'
import { generateAndStoreQuickImage } from '@/features/quick-start/quick-image'
import { createSupabaseConsumerGate, validateLearningResult } from '@/features/channel-learning/consumer-gate'

export interface StudioImageOptionContext {
  businessName: string
  industry: string
  location?: string | null
  summary?: string | null
  brandVoice?: string | null
}

export interface MaybeGenerateStudioImageParams {
  includeImage: boolean
  admin: any
  workspaceId: string
  userId: string
  topic: string
  context: StudioImageOptionContext
  imageClient?: OpenAIImageClient
}

export interface StudioImageOptionResult {
  imageIds: string[]
  notice: string | null
  media: MediaItem[]
  providerAttempted?: boolean
  needsReconciliation?: boolean
  providerRequestId?: string
  quarantineFailed?: boolean
}

export const STUDIO_IMAGE_FALLBACK_NOTICE =
  '이미지는 만들지 못해서 글만 보여드려요. 나중에 다시 시도할 수 있어요.'

export interface CleanupQuarantineMediaAssetParams {
  admin: any
  workspaceId: string
  assetId: string
  objectPath: string
  isReplay?: boolean
  sourceType?: string
}

export interface CleanupQuarantineResult {
  quarantined: boolean
  storageRemoved: boolean
  dbDeleted: boolean
  success: boolean
  errors: Error[]
}

/**
 * Safely cleans up or quarantines freshly generated workspace-owned media asset
 * when source gate validation fails after provider generation.
 * Never touches external SNS original media, shared assets, or replay assets.
 */
export async function cleanupQuarantineQuickImage(
  params: CleanupQuarantineMediaAssetParams,
): Promise<CleanupQuarantineResult> {
  const { admin, workspaceId, assetId, objectPath, isReplay, sourceType } = params
  const errors: Error[] = []

  // Guard: Never touch replay assets or non-generated external original media
  if (isReplay) {
    return {
      quarantined: false,
      storageRemoved: false,
      dbDeleted: false,
      success: false,
      errors: [new Error('REPLAY_ASSET_PROTECTED')],
    }
  }

  if (sourceType && sourceType !== 'GENERATED_OPENAI') {
    return {
      quarantined: false,
      storageRemoved: false,
      dbDeleted: false,
      success: false,
      errors: [new Error('NON_GENERATED_ORIGINAL_PROTECTED')],
    }
  }

  if (!admin || !workspaceId || !assetId || !objectPath) {
    return {
      quarantined: false,
      storageRemoved: false,
      dbDeleted: false,
      success: false,
      errors: [new Error('INVALID_CLEANUP_PARAMS')],
    }
  }

  let quarantined = false
  let storageRemoved = false
  let dbDeleted = false

  // 1. First: Block the asset immediately by setting publish_eligibility=false and lifecycle_status='QUARANTINED'
  // generation_metadata(model, providerRequestId) must NEVER be overwritten to preserve evidence and CHECK constraints.
  try {
    if (admin.from && typeof admin.from === 'function') {
      const { error: quarantineDbErr } = await admin
        .from('media_assets')
        .update({
          publish_eligibility: false,
          lifecycle_status: 'QUARANTINED',
        })
        .eq('id', assetId)
        .eq('workspace_id', workspaceId)

      if (quarantineDbErr) {
        const err = new Error(quarantineDbErr.message || 'Quarantine update failed')
        errors.push(err)
        console.warn('[cleanupQuarantineQuickImage] Quarantine update error:', quarantineDbErr)
      } else {
        quarantined = true
      }
    }
  } catch (err: any) {
    const errorObj = err instanceof Error ? err : new Error(String(err))
    errors.push(errorObj)
    console.warn('[cleanupQuarantineQuickImage] Quarantine update exception:', err)
  }

  // 2. Second: Remove bytes from private storage
  try {
    if (admin.storage && typeof admin.storage.from === 'function') {
      const { error: storageErr } = await admin.storage.from('content-media').remove([objectPath])
      if (storageErr) {
        const err = new Error(storageErr.message || 'Storage remove failed')
        errors.push(err)
        console.warn('[cleanupQuarantineQuickImage] Storage removal error:', storageErr)
      } else {
        storageRemoved = true
      }
    }
  } catch (err: any) {
    const errorObj = err instanceof Error ? err : new Error(String(err))
    errors.push(errorObj)
    console.warn('[cleanupQuarantineQuickImage] Storage removal exception:', err)
  }

  // 3. Third: Delete media asset record scoped strictly to id and workspace_id
  try {
    if (admin.from && typeof admin.from === 'function') {
      const { error: dbErr } = await admin
        .from('media_assets')
        .delete()
        .eq('id', assetId)
        .eq('workspace_id', workspaceId)

      if (dbErr) {
        const err = new Error(dbErr.message || 'DB deletion failed')
        errors.push(err)
        console.warn('[cleanupQuarantineQuickImage] DB deletion error:', dbErr)
      } else {
        dbDeleted = true
      }
    }
  } catch (err: any) {
    const errorObj = err instanceof Error ? err : new Error(String(err))
    errors.push(errorObj)
    console.warn('[cleanupQuarantineQuickImage] DB deletion exception:', err)
  }

  // If both DB isolation/deletion and storage removal failed, log a critical error and do not claim safety
  const success = dbDeleted || (quarantined && storageRemoved)
  if (!dbDeleted && !quarantined && !storageRemoved) {
    console.error(
      '[cleanupQuarantineQuickImage] CRITICAL: Both DB isolation/deletion and storage removal failed; asset safety cannot be guaranteed',
      { assetId, workspaceId, errors: errors.map((e) => e.message) },
    )
  }

  return {
    quarantined,
    storageRemoved,
    dbDeleted,
    success,
    errors,
  }
}

/**
 * Conditionally generates and persists one studio image using OpenAI Image model.
 * If includeImage is false, no external calls are made.
 * If generation or storage fails, degrades gracefully to text-only with an owner-friendly Korean notice.
 */
export async function maybeGenerateStudioImage(
  params: MaybeGenerateStudioImageParams
): Promise<StudioImageOptionResult> {
  if (!params.includeImage) {
    return {
      imageIds: [],
      notice: null,
      media: [],
    }
  }

  let providerAttempted = false

  try {
    // 1. Authoritative learning image style query (only approved visual style with receipt)
    let learnedStyle: string | null = null
    let learningEpoch = 1
    const learningDependencies: Array<{ workspaceId: string; sourceId: string; revision: number }> = []

    const isChannelLearningFlagEnabled = process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1'

    if (isChannelLearningFlagEnabled && params.admin && typeof params.admin.rpc === 'function') {
      try {
        const { data: rpcData, error: rpcError } = await params.admin.rpc('get_approved_learning_context', {
          p_workspace_id: params.workspaceId,
          p_purpose: 'image',
          p_max_facts: 32,
          p_query: '',
        })
        if (!rpcError && rpcData) {
          const rawItems = Array.isArray(rpcData.items) ? rpcData.items : Array.isArray(rpcData) ? rpcData : []
          // Strictly exclude channel-derived facts when flag is off (double-guard parity with knowledge-context.ts)
          const items = isChannelLearningFlagEnabled
            ? rawItems
            : rawItems.filter((item: any) => item.source_type !== 'channel')

          learningEpoch = Number(rpcData.epoch ?? items[0]?.epoch ?? 1)
          const visualItem = items.find((item: any) => item.category === 'visual' && item.content)
          if (visualItem) {
            const isChannelSource = visualItem.source_type === 'channel'
            if (!isChannelSource || isChannelLearningFlagEnabled) {
              learnedStyle = String(visualItem.content)
              // Flatten all leaf dependencies
              const rawDeps = visualItem.dependencies
              if (Array.isArray(rawDeps) && rawDeps.length > 0) {
                for (const dep of rawDeps) {
                  const sId = dep.sourceId || dep.source_id || dep.id
                  if (sId) {
                    learningDependencies.push({
                      workspaceId: dep.workspaceId || dep.workspace_id || params.workspaceId,
                      sourceId: String(sId),
                      revision: Number(dep.revision || dep.source_revision || 1),
                    })
                  }
                }
              } else if (visualItem.source_id) {
                learningDependencies.push({
                  workspaceId: params.workspaceId,
                  sourceId: String(visualItem.source_id),
                  revision: Number(visualItem.source_revision ?? 1),
                })
              }
            }
          }
        }
      } catch {
        // safe fallback
      }
    }

    const summaryWithLearnedStyle = learnedStyle
      ? `${params.context.summary ? params.context.summary + '. ' : ''}[학습된 매장 시각 가이드: ${learnedStyle}]`
      : params.context.summary || undefined

    // Provider call imminent: mark providerAttempted=true before calling generateAndStoreQuickImage
    // so any post-provider failure (storage timeout/upload failure/record failure) preserves hold for reconciliation.
    providerAttempted = true

    const persisted = await generateAndStoreQuickImage({
      admin: params.admin,
      workspaceId: params.workspaceId,
      userId: params.userId,
      context: {
        businessName: params.context.businessName,
        industry: params.context.industry,
        location: params.context.location || undefined,
        summary: summaryWithLearnedStyle,
        topic: params.topic,
      },
      imageClient: params.imageClient,
    })

    // 2. Post-generation gate check: verify that channel sources were not revoked during image generation
    if (learningDependencies.length > 0 && params.admin) {
      const consumerGate = createSupabaseConsumerGate(params.admin, 'image')
      const valid = await validateLearningResult(
        {
          workspaceId: params.workspaceId,
          epoch: learningEpoch,
          dependencies: learningDependencies,
          purpose: 'image',
        },
        consumerGate,
      )
      if (!valid) {
        // Revoked or expired mid-generation: clean up / quarantine stored asset to prevent leak (F6)
        const cleanupResult = await cleanupQuarantineQuickImage({
          admin: params.admin,
          workspaceId: params.workspaceId,
          assetId: persisted.assetId,
          objectPath: persisted.objectPath,
          sourceType: 'GENERATED_OPENAI',
        })
        const quarantineFailed = !cleanupResult?.success
        if (quarantineFailed) {
          console.error(
            '[maybeGenerateStudioImage] Post-gate quarantine cleanup failed; asset may remain exposed',
            {
              workspaceId: params.workspaceId,
              assetId: persisted.assetId,
              cleanupResult,
            },
          )
        }
        // Signal needsReconciliation so provider hold is preserved rather than auto-refunded.
        return {
          imageIds: [],
          notice: STUDIO_IMAGE_FALLBACK_NOTICE,
          media: [],
          providerAttempted: true,
          needsReconciliation: true,
          quarantineFailed: quarantineFailed ? true : undefined,
        }
      }
    }

    return {
      imageIds: [persisted.assetId],
      notice: null,
      media: [{ type: 'image', mimeType: persisted.mimeType, fileSizeBytes: persisted.sizeBytes }],
      providerAttempted: true,
      needsReconciliation: false,
    }
  } catch (error: any) {
    const providerRequestId = error?.providerRequestId
    if (providerRequestId) {
      console.warn(
        `[channel-studio] image provider succeeded (requestId: ${providerRequestId}) but storage/DB persistence failed; hold retained for operator reconciliation`,
      )
    }
    return {
      imageIds: [],
      notice: STUDIO_IMAGE_FALLBACK_NOTICE,
      media: [],
      providerAttempted,
      needsReconciliation: providerAttempted,
      providerRequestId,
    }
  }
}
