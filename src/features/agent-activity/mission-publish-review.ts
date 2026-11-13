import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { ActionCostQuoteEngine, STANDARD_ACTION_CREDIT_COSTS } from '@/features/credit-economy/quote-and-policy'

export interface MissionReviewScope {
  workspaceId: string
  missionId: string
  runId: string
  contentId: string
  versionId: string
}

const scopeSchema = z.object({
  workspaceId: z.string().min(1), missionId: z.string().min(1), runId: z.string().min(1),
  contentId: z.string().min(1), versionId: z.string().min(1),
})
const quoteSchema = scopeSchema.extend({
  quoteId: z.string().min(1), actionType: z.literal('SNS_DIRECT_PUBLISH'),
  requiredCredits: z.number().int().positive(), estimatedDurationMs: z.number().int().positive(),
  issuedAt: z.string().datetime(), expiresAt: z.string().datetime(), isExpired: z.literal(false),
  tripartiteClassification: z.literal('SOHEE_CREDIT'),
  reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/), executionAllowed: z.literal(false),
}).strict()
export type MissionPublishQuote = z.infer<typeof quoteSchema>
const approvalSchema = scopeSchema.extend({
  approvalId: z.string().uuid(), quoteId: z.string().min(1), reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  requiredCredits: z.number().int().positive(), decidedBy: z.string().min(1), decidedAt: z.string().datetime(),
  rightsConfirmed: z.literal(true), disclosureConfirmed: z.literal(true),
  state: z.literal('REVIEW_APPROVED'), executionAllowed: z.literal(false),
}).strict()
export interface MissionReviewConsent {
  quoteId: string
  reviewFingerprint: string
  rightsConfirmed: boolean
  disclosureConfirmed: boolean
}

export class MissionPublishReviewError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'MissionPublishReviewError' }
}

// Deliberately excludes signed media URLs and account labels: only the reviewed execution scope is hashed.
function reviewFingerprint(scope: MissionReviewScope, preview: ApprovalPreviewSnapshot) {
  return createHash('sha256').update(JSON.stringify({
    workspaceId: scope.workspaceId, missionId: scope.missionId, runId: scope.runId,
    contentId: scope.contentId, versionId: scope.versionId,
    fingerprint: preview.fingerprint, channel: preview.channel, visibility: preview.visibility ?? null,
    connectionId: preview.account.connectionId, text: preview.text, disclosure: preview.disclosure,
    naverBlocks: preview.naverBlocks ?? null,
    media: preview.media.map(media => ({ id: media.id, position: media.position, altText: media.altText,
      mimeType: media.mimeType, width: media.width ?? null, height: media.height ?? null, sizeBytes: media.sizeBytes ?? null })),
  })).digest('hex')
}

export class MissionPublishReviewService {
  constructor(
    private readonly db: any,
    private readonly getPreview: (workspaceId: string, contentId: string) => Promise<{ data?: ApprovalPreviewSnapshot | null; error?: unknown }>,
  ) {}

  private async load(scope: MissionReviewScope) {
    if (!scopeSchema.safeParse(scope).success) throw new MissionPublishReviewError('MISSION_REVIEW_CONFLICT')
    const mission = await this.db.from('marketing_missions').select('*')
      .eq('workspace_id', scope.workspaceId).eq('id', scope.missionId).maybeSingle()
    const row = mission.data
    if (mission.error || !row || row.workspace_id !== scope.workspaceId || row.id !== scope.missionId
      || row.source_conversation_job_id !== scope.runId || row.content_id !== scope.contentId
      || row.content_version_id !== scope.versionId || row.status !== 'AWAITING_APPROVAL'
      || !Number.isFinite(Date.parse(row.updated_at))) throw new MissionPublishReviewError('MISSION_REVIEW_CONFLICT')
    const run = await this.db.from('conversation_jobs').select('id,workspace_id,plan_data')
      .eq('workspace_id', scope.workspaceId).eq('id', scope.runId).maybeSingle()
    if (run.error || !run.data || run.data.workspace_id !== scope.workspaceId || run.data.id !== scope.runId
      || run.data.plan_data?.missionId !== scope.missionId) throw new MissionPublishReviewError('MISSION_REVIEW_CONFLICT')
    const preview = await this.getPreview(scope.workspaceId, scope.contentId)
    if (preview.error || !preview.data || preview.data.workspaceId !== scope.workspaceId
      || preview.data.contentId !== scope.contentId || preview.data.versionId !== scope.versionId) {
      throw new MissionPublishReviewError('MISSION_REVIEW_CONFLICT')
    }
    return { row, preview: preview.data }
  }

  private isReviewable(preview: ApprovalPreviewSnapshot) {
    return preview.issues.length === 0 && preview.account.status === 'connected' && !!preview.account.connectionId
  }

  private validQuote(scope: MissionReviewScope, row: any, preview: ApprovalPreviewSnapshot): MissionPublishQuote | null {
    const parsed = quoteSchema.safeParse(row.metadata?.missionPublishQuote)
    if (!parsed.success || !this.isReviewable(preview)) return null
    const quote = parsed.data
    const policy = STANDARD_ACTION_CREDIT_COSTS.SNS_DIRECT_PUBLISH
    if (quote.workspaceId !== scope.workspaceId || quote.missionId !== scope.missionId || quote.runId !== scope.runId
      || quote.contentId !== scope.contentId || quote.versionId !== scope.versionId
      || quote.requiredCredits !== policy.cost || quote.estimatedDurationMs !== policy.durationMs
      || Date.parse(quote.issuedAt) > Date.now() || Date.parse(quote.expiresAt) <= Date.now()
      || Date.parse(quote.expiresAt) - Date.parse(quote.issuedAt) !== 15 * 60 * 1000
      || quote.reviewFingerprint !== reviewFingerprint(scope, preview)) return null
    return quote
  }

  private async save(scope: MissionReviewScope, row: any, metadata: Record<string, unknown>, code: string) {
    // Ensure a strictly newer CAS token even if two requests arrive in the same millisecond.
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(row.updated_at) + 1)).toISOString()
    try {
      const saved = await this.db.from('marketing_missions').update({ metadata, updated_at: updatedAt })
        .eq('workspace_id', scope.workspaceId).eq('id', scope.missionId)
        .eq('source_conversation_job_id', scope.runId).eq('content_id', scope.contentId)
        .eq('content_version_id', scope.versionId).eq('status', 'AWAITING_APPROVAL')
        .eq('updated_at', row.updated_at).select('id').maybeSingle()
      if (saved.error || saved.data?.id !== scope.missionId) throw new Error(code)
      const readback = await this.load(scope)
      if (!isDeepStrictEqual(readback.row.metadata?.missionPublishQuote, metadata.missionPublishQuote)
        || !isDeepStrictEqual(readback.row.metadata?.missionPublishApproval, metadata.missionPublishApproval)
        || !this.validQuote(scope, readback.row, readback.preview)) throw new Error(code)
      return readback
    } catch { throw new MissionPublishReviewError(code) }
  }

  async issue(scope: MissionReviewScope): Promise<MissionPublishQuote> {
    const { row, preview } = await this.load(scope)
    if (!this.isReviewable(preview)) throw new MissionPublishReviewError('MISSION_REVIEW_BLOCKED')
    const quote: MissionPublishQuote = {
      ...new ActionCostQuoteEngine().createQuote({ workspaceId: scope.workspaceId, actionType: 'SNS_DIRECT_PUBLISH' }),
      ...scope, actionType: 'SNS_DIRECT_PUBLISH', isExpired: false,
      reviewFingerprint: reviewFingerprint(scope, preview), executionAllowed: false,
    }
    await this.save(scope, row, { ...row.metadata, missionPublishQuote: quote, missionPublishApproval: null }, 'MISSION_QUOTE_SAVE_UNCONFIRMED')
    return quote
  }

  async read(scope: MissionReviewScope): Promise<MissionPublishQuote | null> {
    const { row, preview } = await this.load(scope)
    return this.validQuote(scope, row, preview)
  }

  async snapshot(scope: MissionReviewScope, quoteId: string): Promise<{ quote: MissionPublishQuote; preview: ApprovalPreviewSnapshot }> {
    const { row, preview } = await this.load(scope)
    const quote = this.validQuote(scope, row, preview)
    if (!quote || quote.quoteId !== quoteId) throw new MissionPublishReviewError('MISSION_EXACT_REVIEW_REQUIRED')
    return { quote, preview }
  }

  async approve(scope: MissionReviewScope, consent: MissionReviewConsent, actorId: string) {
    const { row, preview } = await this.load(scope)
    const quote = this.validQuote(scope, row, preview)
    if (!actorId?.trim() || !quote || quote.quoteId !== consent.quoteId || quote.reviewFingerprint !== consent.reviewFingerprint
      || consent.rightsConfirmed !== true || consent.disclosureConfirmed !== true) {
      throw new MissionPublishReviewError('MISSION_EXACT_REVIEW_REQUIRED')
    }
    if (row.metadata?.missionPublishApproval != null) {
      const parsed = approvalSchema.safeParse(row.metadata.missionPublishApproval)
      const existing = parsed.success ? parsed.data : null
      if (!existing || existing.workspaceId !== scope.workspaceId || existing.missionId !== scope.missionId
        || existing.runId !== scope.runId || existing.contentId !== scope.contentId || existing.versionId !== scope.versionId
        || existing.quoteId !== quote.quoteId || existing.reviewFingerprint !== quote.reviewFingerprint
        || existing.requiredCredits !== quote.requiredCredits || existing.decidedBy !== actorId
        || Date.parse(existing.decidedAt) < Date.parse(quote.issuedAt) || Date.parse(existing.decidedAt) > Date.now()) {
        throw new MissionPublishReviewError('MISSION_EXACT_REVIEW_REQUIRED')
      }
      return existing
    }
    // This is a durable review decision, not content/bundle publication approval or execution admission.
    const decision = { ...scope, approvalId: randomUUID(), quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint,
      requiredCredits: quote.requiredCredits, decidedBy: actorId, decidedAt: new Date().toISOString(),
      rightsConfirmed: true, disclosureConfirmed: true, state: 'REVIEW_APPROVED' as const, executionAllowed: false as const }
    await this.save(scope, row, { ...row.metadata, missionPublishApproval: decision }, 'MISSION_REVIEW_SAVE_UNCONFIRMED')
    return decision
  }
}
