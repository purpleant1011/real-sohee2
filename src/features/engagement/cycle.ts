import type { TextGenerator } from '@/features/vault/transform/ports/text-generator'
import type { GroundedBusinessContext } from '@/features/channel-studio/types'
import type { MetaFetch } from '@/lib/providers/meta-api'
import { classifyComment } from './classify'
import { generateCommentReplyDraft, computeApprovalFingerprint } from './draft'
import { generateCommentToneOptions } from './comment-tones'
import { decideAutoReply } from './policy'
import { sendCommentReply } from './send'
import type { EngagementRepository } from './repository'
import type { EngagementPolicy, SocialChannel } from './types'

export interface EngagementCycleDependencies {
  repo: EngagementRepository
  textGenerator: TextGenerator
  loadContext: (workspaceId: string) => Promise<GroundedBusinessContext>
  getChannelCredential: (workspaceId: string, channelConnectionId: string, channel: SocialChannel) => Promise<{
    accessToken: string
    externalAccountId?: string
    grantedScopes?: readonly string[]
  }>
  fetcher?: MetaFetch
  adminClient?: any
  now?: Date
  maxClassifyAndDraft?: number
  maxSends?: number
}

export interface EngagementCycleResult {
  workspaceId: string
  classifiedCount: number
  draftedCount: number
  autoSentCount: number
  skippedCount: number
}

const DEFAULT_POLICY = (workspaceId: string, channel: SocialChannel): EngagementPolicy => ({
  id: '00000000-0000-0000-0000-000000000000',
  workspace_id: workspaceId,
  channel,
  auto_reply_enabled: false,
  is_paused: false,
  allowed_classes: ['THANKS', 'GREETING'],
  min_confidence: 0.85,
  daily_cap: 5,
  quiet_hours_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
  max_comment_age_days: 7,
  autonomy_level: 'L1_MANUAL',
  default_tone: 'friendly',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})

export async function runEngagementCycle(
  workspaceId: string,
  deps: EngagementCycleDependencies
): Promise<EngagementCycleResult> {
  const {
    repo,
    textGenerator,
    loadContext,
    now = new Date(),
    maxClassifyAndDraft = 20, // Invariant 9: max 20 new comments classified+drafted per workspace
    maxSends = 5,             // Invariant 9: max 5 sends per cycle
  } = deps

  let classifiedCount = 0
  let draftedCount = 0
  let autoSentCount = 0
  let skippedCount = 0

  // 1. Load grounded business context (fail-closed if context unavailable)
  let context: GroundedBusinessContext
  try {
    context = await loadContext(workspaceId)
  } catch (ctxErr) {
    console.warn(`[runEngagementCycle] Could not load business context for workspace ${workspaceId}:`, ctxErr)
    return {
      workspaceId,
      classifiedCount: 0,
      draftedCount: 0,
      autoSentCount: 0,
      skippedCount: 0,
    }
  }

  // 2. Fetch unprocessed comments up to cost cap (20)
  const comments = await repo.listUnprocessedComments(workspaceId, maxClassifyAndDraft)
  if (comments.length === 0) {
    return {
      workspaceId,
      classifiedCount: 0,
      draftedCount: 0,
      autoSentCount: 0,
      skippedCount: 0,
    }
  }

  // Cache policy & quota per channel for this workspace
  const policyCache = new Map<SocialChannel, EngagementPolicy>()
  const sentTodayCache = new Map<SocialChannel, number>()

  for (const comment of comments) {
    // A. Classification (if not classified)
    if (!comment.classification) {
      const classRes = await classifyComment(comment.comment_text, textGenerator)
      await repo.updateCommentClassification(workspaceId, comment.id, classRes.classification, classRes.confidence)
      comment.classification = classRes.classification
      comment.confidence = classRes.confidence
      classifiedCount++
    }

    // Cache policy per channel for this workspace
    if (!policyCache.has(comment.channel)) {
      const loaded = await repo.findPolicy(workspaceId, comment.channel)
      policyCache.set(comment.channel, loaded ?? DEFAULT_POLICY(workspaceId, comment.channel))
    }
    const policy = policyCache.get(comment.channel)!

    // B. Drafting (if draft not yet created)
    let draft = await repo.findDraftByCommentId(workspaceId, comment.id)
    if (!draft) {
      const draftRes = await generateCommentReplyDraft({
        workspaceId,
        commentId: comment.id,
        commentText: comment.comment_text,
        channel: comment.channel,
        authorHandle: comment.author_handle,
        context,
        generator: textGenerator,
      })

      let finalDraftText = draftRes.draftText
      if (policy.default_tone && policy.default_tone !== 'friendly') {
        const toneOptions = generateCommentToneOptions({
          commentText: comment.comment_text,
          authorHandle: comment.author_handle,
          baseDraftText: draftRes.draftText,
          businessName: context.businessName,
        })
        const matched = toneOptions.find((t) => t.key === policy.default_tone)
        if (matched) {
          finalDraftText = matched.text
        }
      }

      const fingerprint = computeApprovalFingerprint(workspaceId, comment.id, finalDraftText)
      draft = await repo.saveDraft(workspaceId, comment.id, finalDraftText, fingerprint)
      draftedCount++
    }

    // C. Auto-reply decision
    if (!sentTodayCache.has(comment.channel)) {
      const count = await repo.countAutoRepliesSentToday(workspaceId, comment.channel, now)
      sentTodayCache.set(comment.channel, count)
    }

    const currentSentToday = sentTodayCache.get(comment.channel)!

    const decision = decideAutoReply({
      policy,
      comment,
      sentCountToday: currentSentToday,
      now,
    })

    if (decision.shouldAutoReply && autoSentCount < maxSends) {
      const fp = draft.approved_fingerprint || computeApprovalFingerprint(workspaceId, comment.id, draft.draft_text)

      // Auto-approve draft
      await repo.approveDraft(
        workspaceId,
        comment.id,
        fp,
        null,
        true
      )

      // Send reply
      const sendRes = await sendCommentReply(
        comment,
        { type: 'system', isAuto: true },
        deps
      )

      if (sendRes.sent) {
        autoSentCount++
        sentTodayCache.set(comment.channel, currentSentToday + 1)
      } else {
        skippedCount++
      }
    } else {
      skippedCount++
    }
  }

  return {
    workspaceId,
    classifiedCount,
    draftedCount,
    autoSentCount,
    skippedCount,
  }
}
