import { z } from 'zod'
import { generateChannelVariants } from '@/features/vault/transform/generator'
import type { TextGenerator } from '@/features/vault/transform/ports/text-generator'
import type { BaseDraftBuilder, ChannelDraftRepository, ClaimChecker, KnowledgeContextLoader, SaveChannelDraftInput } from './ports'
import { STUDIO_IMAGE_FALLBACK_NOTICE, type MaybeGenerateStudioImageParams, type StudioImageOptionResult } from './image-option'
import type { StudioCredits } from './studio-credits'
import { ChannelDraftError, STUDIO_CHANNELS, type ChannelDraftRequest, type ChannelDraftResult, type StudioChannel, type VariantStatus } from './types'

const inputSchema = z.object({
  topic: z.string().trim().min(1).max(300),
  requestKey: z.string().uuid(),
})

const text = z.string().trim().min(1)
const initialResponseSchema = z.object({
  instagram: z.object({ caption: text }),
  threads: z.object({ text }),
  naver_blog: z.object({ title: text, blocks: z.array(z.object({ text })).min(1) }),
  daangn_business: z.object({ text }),
})

const RETRY_PAYLOADS: Record<StudioChannel, z.ZodType> = {
  instagram: z.object({ caption: text }),
  threads: z.object({ text }),
  naver_blog: z.object({ title: text, text: text.optional(), blocks: z.array(z.object({ text })).min(1).optional() }).refine((value) => !!value.text || !!value.blocks),
  daangn_business: z.object({ text }),
}

function parseModelOutput(raw: string, retryChannel?: StudioChannel): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?/iu, '').replace(/```$/u, '').trim())
  } catch {
    throw new ChannelDraftError('글 생성 결과를 읽을 수 없어요. 다시 시도해 주세요.', 'MODEL_OUTPUT_INVALID', 502)
  }
  const schema = retryChannel ? RETRY_PAYLOADS[retryChannel] : initialResponseSchema
  const payload = retryChannel && parsed && typeof parsed === 'object' && retryChannel in parsed
    ? (parsed as Record<string, unknown>)[retryChannel] : parsed
  if (!schema.safeParse(payload).success) {
    throw new ChannelDraftError('글 생성 결과가 올바르지 않아요. 다시 시도해 주세요.', 'MODEL_OUTPUT_INVALID', 502)
  }
}

/** Shared by generation and the CTA so 'ready' always means generation will not fail with KNOWLEDGE_MISSING. */
export function hasUsableFacts(ctx: { facts?: Array<{ kind: string; label: string; value: string }> } | null | undefined): boolean {
  return !!ctx && Array.isArray(ctx.facts) && ctx.facts.some((fact) =>
    fact.value.trim() && !(fact.kind === 'profile' && ['상호', '업종', '지역'].includes(fact.label))
      && !(fact.kind === 'identity' && ['상호', '가게 종류', '지역'].includes(fact.label)))
}

export interface ChannelDraftDependencies {
  loadContext: KnowledgeContextLoader
  buildBaseDraft: BaseDraftBuilder
  checkClaims: ClaimChecker
  text: TextGenerator
  image: (params: Omit<MaybeGenerateStudioImageParams, 'admin'>) => Promise<StudioImageOptionResult>
  repo: ChannelDraftRepository
  /** FinOps hold around provider calls. Omitted only by dev demos and unit tests that never call a paid provider. */
  credits?: StudioCredits
  /** Validates that channel-derived knowledge dependencies remain unrevoked and current after provider completion. */
  validateLearning?: (input: {
    workspaceId: string
    epoch: number
    dependencies: Array<{ workspaceId: string; sourceId: string; revision: number }>
    purpose?: 'content' | 'conversation' | 'image'
  }) => Promise<boolean>
}

/** Generates drafts with an optional image; never publishes to SNS. */
export async function generateChannelDraft(req: ChannelDraftRequest, deps: ChannelDraftDependencies): Promise<ChannelDraftResult> {
  const validated = inputSchema.safeParse({ topic: req.topic, requestKey: req.requestKey })
  if (!validated.success) throw new ChannelDraftError('주제와 요청 정보를 확인해 주세요.', 'VALIDATION_FAILED', 400)
  const { topic, requestKey } = validated.data

  let existing: ChannelDraftResult | null
  try {
    existing = await deps.repo.findByRequestKey(req.workspaceId, requestKey)
  } catch {
    throw new ChannelDraftError('저장된 글을 확인하지 못했어요. 다시 시도해 주세요.', 'PERSISTENCE_FAILED', 503)
  }
  if (existing) {
    if (existing.variants.length > 0) return existing
    throw new ChannelDraftError('글을 준비하고 있어요. 잠시 후 다시 시도해 주세요.', 'PERSISTENCE_FAILED', 409)
  }

  let ctx: Awaited<ReturnType<KnowledgeContextLoader>>
  try {
    ctx = await deps.loadContext(req.workspaceId)
  } catch (error) {
    if (error instanceof ChannelDraftError) throw error
    throw new ChannelDraftError('가게 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'KNOWLEDGE_UNAVAILABLE', 503)
  }
  if (!hasUsableFacts(ctx)) {
    throw new ChannelDraftError('확인된 가게 정보가 없어요. 나의 지식에서 정보를 확인해 주세요.', 'KNOWLEDGE_MISSING', 422)
  }

  const factLabels = [...new Set(ctx.facts.map((fact) => fact.label))]
  const basisNotes = [`지식 v${ctx.knowledgeVersion} 기준`, ...(factLabels.length ? [`사용한 정보: ${factLabels.join(', ')}`] : []), ...ctx.warnings]
  let reservation: Awaited<ReturnType<ChannelDraftRepository['reserve']>>
  try {
    reservation = await deps.repo.reserve({
      workspaceId: req.workspaceId, userId: req.userId, requestKey, topic,
      knowledgeVersion: ctx.knowledgeVersion, basisNotes, imageNotice: null,
    })
  } catch {
    throw new ChannelDraftError('글을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.', 'PERSISTENCE_FAILED', 503)
  }
  if (reservation.kind === 'limit') throw new ChannelDraftError('하루에 만들 수 있는 글 10개를 모두 사용했어요.', 'DAILY_LIMIT_REACHED', 429)
  if (reservation.kind === 'existing') return reservation.result
  if (reservation.kind === 'pending') throw new ChannelDraftError('글을 준비하고 있어요. 잠시 후 다시 시도해 주세요.', 'PERSISTENCE_FAILED', 409)

  let textHold: Awaited<ReturnType<StudioCredits['reserve']>> | null = null
  let imageHold: Awaited<ReturnType<StudioCredits['reserve']>> | null = null
  let imageTask: Promise<StudioImageOptionResult> | null = null
  let textProviderAttempted = false
  try {
    // quote → reserve before any paid provider call; one text charge covers all four channels.
    if (deps.credits) textHold = await deps.credits.reserve(req.workspaceId, requestKey, 'text')
    const result = await createReservedDraft()
    if (textHold) await settleQuietly(textHold)
    return result
  } catch (error) {
    // A model failure can happen while the optional image is still being generated.
    let imageResult: StudioImageOptionResult | null = null
    if (imageTask) {
      try {
        imageResult = await imageTask
      } catch (err: any) {
        imageResult = {
          imageIds: [],
          notice: STUDIO_IMAGE_FALLBACK_NOTICE,
          media: [],
          providerAttempted: Boolean(err?.providerAttempted ?? (imageHold !== null)),
          needsReconciliation: Boolean(err?.needsReconciliation ?? err?.providerAttempted ?? (imageHold !== null)),
        }
      }
    }
    // Once provider execution was attempted or completed, no auto-refund (retain hold for reconciliation).
    // Auto-release only when there is definitive proof provider was never called.
    if (!textProviderAttempted) {
      if (textHold) await releaseQuietly(textHold)
    } else {
      console.warn('[channel-studio] text provider was attempted; hold retained for reconciliation instead of auto-refund')
    }

    if (imageHold) {
      const imageAttempted = Boolean(
        imageResult?.providerAttempted ||
        imageResult?.needsReconciliation ||
        (imageResult?.imageIds && imageResult.imageIds.length > 0)
      )
      if (!imageAttempted) {
        await releaseQuietly(imageHold)
      } else {
        console.warn('[channel-studio] image provider was attempted; hold retained for reconciliation instead of auto-refund')
      }
    }
    try { await deps.repo.release(req.workspaceId, requestKey, req.userId) } catch { /* preserve the original sanitized error */ }
    throw error
  }

  // A settle/release failure keeps the hold reserved for reconciliation; it never hides a stored draft.
  async function settleQuietly(hold: NonNullable<typeof textHold>) {
    try { await deps.credits!.settle(req.workspaceId, hold) } catch { console.error('[channel-studio] credit settle pending reconciliation') }
  }
  async function releaseQuietly(hold: NonNullable<typeof textHold>) {
    try { await deps.credits!.release(req.workspaceId, hold) } catch { console.error('[channel-studio] credit release pending reconciliation') }
  }

  async function createReservedDraft(): Promise<ChannelDraftResult> {
  // Start the optional image alongside text; catch synchronously so text errors never leave
  // an in-flight image rejection unhandled or disclose provider details.
  const imagePromise: Promise<StudioImageOptionResult> = req.includeImage === true
    ? (async () => {
        imageHold = deps.credits ? await deps.credits.reserve(req.workspaceId, requestKey, 'image') : null
        return deps.image({
          includeImage: true, workspaceId: req.workspaceId, userId: req.userId, topic,
          context: { businessName: ctx.businessName, industry: ctx.industry, location: ctx.location, brandVoice: ctx.tone.brandVoice },
        })
      })().catch((err) => {
        const attempted = Boolean(err?.providerAttempted ?? (imageHold !== null))
        return {
          imageIds: [],
          notice: STUDIO_IMAGE_FALLBACK_NOTICE,
          media: [],
          providerAttempted: attempted,
          needsReconciliation: Boolean(err?.needsReconciliation ?? attempted),
        }
      })
    : Promise.resolve({ imageIds: [], notice: null, media: [], providerAttempted: false, needsReconciliation: false })
  imageTask = imagePromise

  // The legacy transformer swallows retry errors and retains the original failed variant.
  // Only the initial response is essential: retries are best-effort and must not erase four valid drafts.
  let call = 0
  const guardedText: TextGenerator = {
    async generateText(prompt, options) {
      textProviderAttempted = true
      const retryChannel = call++ > 0 ? STUDIO_CHANNELS.find((channel) => prompt.includes(`이전에 생성한 ${channel} 채널의 결과물`)) : undefined
      try {
        const response = await deps.text.generateText(prompt, options)
        parseModelOutput(response, retryChannel)
        return response
      } catch (error) {
        const failure = error instanceof ChannelDraftError
          ? error
          : new ChannelDraftError('글을 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', 'MODEL_FAILED', 503)
        // The transformer catches retries, preserving the previous evaluated payload.
        throw failure
      }
    },
  }

  let generated: Awaited<ReturnType<typeof generateChannelVariants>>
  try {
    generated = await generateChannelVariants({
      topic, baseDraft: deps.buildBaseDraft(ctx, topic), tonePreset: ctx.tone.presetKey ?? 'friendly',
      channels: [...STUDIO_CHANNELS], generator: guardedText,
      media: imagePromise.then((image) => image.media),
    })
  } catch (error) {
    if (error instanceof ChannelDraftError) throw error
    throw new ChannelDraftError('글을 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', 'MODEL_FAILED', 503)
  }

  const variants: SaveChannelDraftInput['variants'] = STUDIO_CHANNELS.map((channel) => {
    const variant = generated.variants[channel]
    if (!variant) throw new ChannelDraftError('일부 채널의 글이 빠졌어요. 다시 시도해 주세요.', 'MODEL_OUTPUT_INVALID', 502)
    const claim = deps.checkClaims(channel, variant.payload, ctx)
    const failed = variant.evaluation.checks.filter((check) => check.status === 'FAIL')
    const uncertain = variant.evaluation.checks.filter((check) => check.status === 'UNKNOWN')
    const status: VariantStatus = failed.length ? 'NEEDS_FIX' : claim.status === 'UNKNOWN' || uncertain.length ? 'NEEDS_CHECK' : 'READY'
    const issues = [
      ...failed.map((check) => check.userMessage),
      ...claim.issues,
      ...uncertain.map((check) => check.userMessage),
    ]
    const statusLabel = status === 'READY' ? '보관할 수 있어요' : status === 'NEEDS_FIX' ? '수정이 필요해요' : '사실 확인이 필요해요'
    return {
      channel, payload: variant.payload, status, statusLabel, issues,
      savableReason: status === 'READY' ? null : issues.join(' ') || statusLabel,
    }
  })
  const image = await imagePromise

  // Re-validate channel dependencies right before storing the draft in the vault & delivering.
  // If a channel source was revoked or revision changed mid-generation, strictly fail-closed.
  if (deps.validateLearning && ctx.dependencies && ctx.dependencies.length > 0) {
    const valid = await deps.validateLearning({
      workspaceId: req.workspaceId,
      epoch: ctx.epoch ?? 1,
      dependencies: ctx.dependencies,
      purpose: 'content',
    })
    if (!valid) {
      throw new ChannelDraftError('가게 정보가 변경되어 글을 저장할 수 없어요. 다시 시도해 주세요.', 'KNOWLEDGE_UNAVAILABLE', 503)
    }
  }

  let stored: ChannelDraftResult
  try {
    stored = await deps.repo.save({
      workspaceId: req.workspaceId, userId: req.userId, requestKey, topic,
      knowledgeVersion: ctx.knowledgeVersion, basisNotes,
      imageNotice: image.notice, imageIds: image.imageIds, variants,
    })
  } catch {
    throw new ChannelDraftError('글을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', 'PERSISTENCE_FAILED', 503)
  }
  if (imageHold) {
    const storedImageIds = new Set(stored.variants.flatMap(variant => {
      const media = variant.payload.media
      return Array.isArray(media) ? media.map(item => {
        const src = item && typeof item === 'object' ? (item as { src?: unknown }).src : null
        return typeof src === 'string' ? src : ''
      }) : []
    }))
    const committed = image.imageIds.length > 0 && image.imageIds.every(id => storedImageIds.has(`/api/workspaces/${req.workspaceId}/media/${id}`))
    if (committed) {
      await settleQuietly(imageHold)
    } else if (image.needsReconciliation) {
      // Once image provider was executed with ambiguous outcome or gate revocation, retain hold for reconciliation
      console.warn('[channel-studio] image provider needs reconciliation; hold retained instead of auto-refund')
    } else {
      await releaseQuietly(imageHold)
    }
    imageHold = null
  }
  return stored
  }
}
